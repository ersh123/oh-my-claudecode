import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  lintTicketsRaw,
  normalizeTicketsFile,
  writeTickets,
  readTickets,
  validateTicketDag,
  validateTicketCoverage,
  type NikoflowTicketsFile,
} from "../index.js";

/**
 * These cover the artifact-validation logic behind the tickets-gate precondition
 * (nikoflowGatePrecondition in persistent-mode): a gate must not advance while
 * tickets.json is missing, mis-shaped, or an invalid DAG. The end-to-end Stop-hook
 * wiring (rotation on precondition-fail) is exercised by the TSK-009 dogfood, where
 * mode-state paths resolve against a real git worktree.
 */
describe("nikoflow tickets-gate precondition logic (TSK-004)", () => {
  describe("lint surfaces laundered shape errors that normalization would hide", () => {
    it("flags blocked_by given as a bare string", () => {
      const w = lintTicketsRaw({
        tickets: [{ id: "TSK-001", title: "a", acceptance: ["a"], blocked_by: "TSK-000", status: "todo" }],
      });
      expect(w.join()).toContain("blocked_by must be an array");
    });
    it("flags a mistyped status", () => {
      const w = lintTicketsRaw({
        tickets: [{ id: "TSK-001", title: "a", blocked_by: [], status: "Done" }],
      });
      expect(w.join()).toContain("invalid status");
    });
    it("flags a non-object / missing tickets array", () => {
      expect(lintTicketsRaw(null).join()).toContain("not an object");
      expect(lintTicketsRaw({ foo: 1 }).join()).toContain("no 'tickets' array");
    });
    it("passes a clean file", () => {
      const w = lintTicketsRaw({
        tickets: [{ id: "TSK-001", title: "a", acceptance: ["a"], blocked_by: [], status: "todo" }],
      });
      expect(w).toEqual([]);
    });
  });

  describe("artifact round-trip + DAG validation via the real state path", () => {
    let dir: string;
    const sid = "sess-tg";
    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), "nikoflow-tg-"));
    });
    afterEach(() => rmSync(dir, { recursive: true, force: true }));

    it("a written invalid (cyclic) tickets file reads back and fails the DAG gate", () => {
      const cyclic: NikoflowTicketsFile = {
        version: 1,
        tickets: [
          { id: "A", title: "a", acceptance: [], blocked_by: ["B"], status: "todo" },
          { id: "B", title: "b", acceptance: [], blocked_by: ["A"], status: "todo" },
        ],
      };
      expect(writeTickets(dir, cyclic, sid)).toBe(true);
      const read = readTickets(dir, sid);
      expect(read).not.toBeNull();
      expect(validateTicketDag(read!).ok).toBe(false);
    });

    it("a valid tickets file passes the DAG gate", () => {
      const valid: NikoflowTicketsFile = {
        version: 1,
        tickets: [
          { id: "TSK-001", title: "a", acceptance: ["a"], blocked_by: [], status: "todo" },
          { id: "TSK-002", title: "b", acceptance: ["b"], blocked_by: ["TSK-001"], status: "todo" },
        ],
      };
      writeTickets(dir, valid, sid);
      expect(validateTicketDag(readTickets(dir, sid)!).ok).toBe(true);
    });

    it("a missing tickets file reads as null (gate would block)", () => {
      expect(readTickets(dir, sid)).toBeNull();
    });
  });
});

describe("PRD/ADR coverage validation (coverage gate)", () => {
  const file = (tickets: NikoflowTicketsFile["tickets"]): NikoflowTicketsFile => ({
    version: 1,
    tickets,
  });
  const tk = (id: string, extra: Partial<NikoflowTicketsFile["tickets"][number]> = {}) => ({
    id,
    title: id,
    acceptance: ["a"],
    blocked_by: [],
    status: "todo" as const,
    ...extra,
  });

  it("undefined dimensions contribute nothing (legacy state = today's behavior)", () => {
    const f = file([tk("TSK-001", { story_id: "ST-009", decision_ids: ["ADR-9"] })]);
    expect(validateTicketCoverage(f, {})).toEqual([]);
  });

  it("blocks a recorded PRD story with no covering ticket", () => {
    const f = file([tk("TSK-001", { story_id: "ST-001" })]);
    const errs = validateTicketCoverage(f, { story_ids: ["ST-001", "ST-002"] });
    expect(errs.join()).toContain("PRD story ST-002 has no covering ticket");
  });

  it("blocks a ticket referencing an unknown story id", () => {
    const f = file([tk("TSK-003", { story_id: "ST-009" })]);
    const errs = validateTicketCoverage(f, { story_ids: [] });
    expect(errs.join()).toContain("TSK-003 references unknown story id ST-009");
  });

  it("passes when a decision is covered by multiple tickets", () => {
    const f = file([
      tk("TSK-001", { story_id: "ST-001", decision_ids: ["ADR-0001"] }),
      tk("TSK-002", { story_id: "ST-001", decision_ids: ["ADR-0001"] }),
    ]);
    expect(
      validateTicketCoverage(f, { story_ids: ["ST-001"], decision_ids: ["ADR-0001"] }),
    ).toEqual([]);
  });

  it("blocks a ticket claiming a decision when ADR recorded none ([] = skipped)", () => {
    const f = file([tk("TSK-001", { decision_ids: ["ADR-0001"] })]);
    const errs = validateTicketCoverage(f, { decision_ids: [] });
    expect(errs.join()).toContain("TSK-001 references unknown decision id ADR-0001");
  });

  it("lint flags a non-string story_id and a non-array / dirty decision_ids", () => {
    const w = lintTicketsRaw({
      tickets: [
        { id: "TSK-001", title: "a", acceptance: ["a"], blocked_by: [], status: "todo", story_id: 7 },
        { id: "TSK-002", title: "b", acceptance: ["b"], blocked_by: [], status: "todo", decision_ids: "ADR-0001" },
        { id: "TSK-003", title: "c", acceptance: ["c"], blocked_by: [], status: "todo", decision_ids: ["ADR-0001", 42, ""] },
      ],
    });
    expect(w.join()).toContain("TSK-001: story_id must be a string");
    expect(w.join()).toContain("TSK-002: decision_ids must be an array");
    expect(w.join()).toContain("TSK-003: decision_ids[1] must be a non-empty decision id");
    expect(w.join()).toContain("TSK-003: decision_ids[2] must be a non-empty decision id");
  });

  it("normalization round-trips decision_ids", () => {
    const norm = normalizeTicketsFile({
      version: 1,
      tickets: [
        { id: "TSK-001", title: "a", acceptance: [], blocked_by: [], status: "todo", decision_ids: ["ADR-0001", "ADR-0002"] },
      ],
    });
    expect(norm!.tickets[0].decision_ids).toEqual(["ADR-0001", "ADR-0002"]);
  });
});
