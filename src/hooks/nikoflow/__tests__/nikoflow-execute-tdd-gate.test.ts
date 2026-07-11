/**
 * TDD-evidence gate precondition: a reviewer-approved TICKET_DONE is accepted
 * only when the ticket carries complete evidence.tdd (red/green runs or a
 * waiver). Evidence is model-written — the hook checks shape/ordering only
 * (anti-sloppiness, not anti-forgery); the request-id is deliberately KEPT on
 * evidence failure so the in-transcript reviewer approval re-matches once
 * evidence lands.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  createNikoflowLoopHook,
  readNikoflowState,
  writeNikoflowState,
  setNikoflowDepth,
  advanceNikoflowPhase,
  getCurrentPhase,
  writeTickets,
  readTickets,
  NIKOFLOW_EXECUTE_ABORT_STALL,
  type NikoflowTicketsFile,
} from "../index.js";
import { handleNikoflowExecute } from "../../persistent-mode/index.js";

const tickets: NikoflowTicketsFile = {
  version: 1,
  tickets: [
    { id: "TSK-001", title: "first", acceptance: ["a"], blocked_by: [], status: "todo" },
  ],
};

function writeEntries(path: string, entries: unknown[]): void {
  writeFileSync(path, entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
}

const reviewerResult = (toolUseId: string, text: string) => [
  {
    type: "assistant",
    message: { role: "assistant", content: [{ type: "tool_use", id: toolUseId, name: "Task", input: { subagent_type: "code-reviewer" } }] },
  },
  {
    type: "user",
    message: { role: "user", content: [{ type: "tool_result", tool_use_id: toolUseId, content: [{ type: "text", text }] }] },
  },
];

const APPROVED_VERDICT = `<nikoflow-verdict spec="pass" quality="approved">none</nikoflow-verdict>`;

const VALID_TDD = {
  red: {
    command: "npx vitest run x.test.ts",
    exit_code: 1,
    expected_failure: "feature not implemented yet",
    head_sha: "abc1234",
    recorded_at: "2026-07-10T10:00:00Z",
  },
  green: {
    command: "npx vitest run x.test.ts",
    exit_code: 0,
    head_sha: "abc1234",
    recorded_at: "2026-07-10T10:05:00Z",
  },
};

describe("nikoflow execute TDD-evidence gate", () => {
  let dir: string;
  const sid = "sess-tdd-gate";
  let transcript: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "nikoflow-tdd-"));
    transcript = join(dir, "t.jsonl");
    writeFileSync(transcript, "");
    createNikoflowLoopHook(dir).startLoop(sid, "build");
    setNikoflowDepth(dir, "standard", sid);
    advanceNikoflowPhase(dir, sid); // adr
    advanceNikoflowPhase(dir, sid); // prd
    advanceNikoflowPhase(dir, sid); // tickets
    advanceNikoflowPhase(dir, sid); // execute
    expect(getCurrentPhase(readNikoflowState(dir, sid)!)).toBe("execute");
    writeTickets(dir, tickets, sid);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const run = () => handleNikoflowExecute(dir, sid, readNikoflowState(dir, sid)!, transcript);

  const setTdd = (tdd: unknown) => {
    const file = readTickets(dir, sid)!;
    file.tickets[0].evidence = { ...(file.tickets[0].evidence ?? {}), tdd };
    writeTickets(dir, file, sid);
  };

  const approve = () => {
    const rid = readNikoflowState(dir, sid)!.request_id!;
    writeEntries(transcript, reviewerResult(
      "tu-1",
      `${APPROVED_VERDICT}\n<nikoflow-gate phase="execute:TSK-001" request-id="${rid}">TICKET_DONE</nikoflow-gate>`,
    ));
  };

  it("rejects an approved TICKET_DONE without evidence.tdd, keeps the request-id, bumps stall", () => {
    run(); // mint rid
    approve();
    const before = readNikoflowState(dir, sid)!;
    const r = run();
    expect(readTickets(dir, sid)!.tickets[0].status).toBe("todo");
    expect(r.message).toContain("evidence.tdd");
    const after = readNikoflowState(dir, sid)!;
    expect(after.request_id).toBe(before.request_id); // NOT rotated
    expect(after.execute_stall ?? 0).toBeGreaterThan(before.execute_stall ?? 0);
  });

  it("advances once valid evidence.tdd is recorded (same reviewer approval re-matches)", () => {
    run();
    approve();
    run(); // blocked on evidence
    setTdd(VALID_TDD);
    run(); // same transcript, evidence now valid → accept
    expect(readTickets(dir, sid)!.tickets[0].status).toBe("done");
  });

  it("advances with a valid waiver", () => {
    run();
    approve();
    setTdd({ waived: { reason: "docs-only ticket, no runtime surface" } });
    run();
    expect(readTickets(dir, sid)!.tickets[0].status).toBe("done");
  });

  it("hard-aborts (bounded) when evidence stays invalid for the abort budget", () => {
    run();
    approve();
    const st = readNikoflowState(dir, sid)!;
    st.execute_stall = NIKOFLOW_EXECUTE_ABORT_STALL - 1;
    st.execute_stall_ticket = "TSK-001";
    writeNikoflowState(dir, st, sid);
    const r = run();
    expect(r.message).toContain("NIKOFLOW ABORTED");
    expect(readNikoflowState(dir, sid)!.active).toBe(false);
  });

  it("preserves tdd alongside hook-merged evidence keys after acceptance", () => {
    run();
    approve();
    setTdd(VALID_TDD);
    run();
    const t = readTickets(dir, sid)!.tickets[0];
    expect(t.status).toBe("done");
    expect(t.evidence?.tdd).toEqual(VALID_TDD);
    // Non-git tmpdir → no ticket branch → the hook records worktree_used:false.
    expect(t.evidence?.worktree_used).toBe(false);
  });
});
