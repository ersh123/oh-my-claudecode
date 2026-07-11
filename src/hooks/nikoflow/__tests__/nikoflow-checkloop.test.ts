import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { execSync } from "child_process";
import { tmpdir } from "os";
import { join } from "path";
import {
  createNikoflowLoopHook,
  readNikoflowState,
  recordNikoflowUserPrompt,
  writeTickets,
} from "../index.js";
import { checkNikoflowLoop } from "../../persistent-mode/index.js";

// Orchestration-level tests for checkNikoflowLoop — the function that carries the
// human-gate anti-self-approval enforcement. Guards against the mutation Fable
// flagged: dropping the `humanOk` check would let a model self-confirm a human
// gate with zero user turn, and NOTHING below this file exercised that path.

function writeTranscript(path: string, text: string): void {
  writeFileSync(
    path,
    JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text }] } }) + "\n",
  );
}
const gate = (rid: string, depth = "standard") =>
  `<nikoflow-gate phase="depth" depth="${depth}" request-id="${rid}">CONFIRMED</nikoflow-gate>`;
const interviewGate = (rid: string, mode?: "approval-gated" | "autonomous") =>
  `<nikoflow-gate phase="interview"${mode ? ` mode="${mode}"` : ""} request-id="${rid}">CONFIRMED</nikoflow-gate>`;

describe("checkNikoflowLoop human-gate enforcement (anti-self-approval)", () => {
  let dir: string;
  const sid = "sess-checkloop";
  let transcript: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "nikoflow-cl-"));
    // git-init so resolveToWorktreeRoot (inside checkNikoflowLoop) and mode-state-io
    // both resolve to the same root — matching how the hook runs in a real repo.
    execSync("git init -q", { cwd: dir });
    transcript = join(dir, "t.jsonl");
    writeFileSync(transcript, "");
    createNikoflowLoopHook(dir).startLoop(sid, "build a feature");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const run = () => checkNikoflowLoop(sid, dir, false, transcript);

  it("blocks at depth-selection on first Stop and mints a request-id", async () => {
    const r = await run();
    expect(r?.mode).toBe("nikoflow");
    expect(r?.message).toContain("depth not yet chosen");
    expect(readNikoflowState(dir, sid)!.request_id).toBeTruthy();
    expect(readNikoflowState(dir, sid)!.depth).toBeNull();
  });

  it("does NOT advance a human gate when the tag has NO user turn after the mint", async () => {
    await run(); // mint depth rid
    const rid = readNikoflowState(dir, sid)!.request_id!;
    // model self-emits the confirmation with NO recordNikoflowUserPrompt
    writeTranscript(transcript, gate(rid));
    await run();
    // depth stays null → gate did not pass (this is the mutation-1 guard)
    expect(readNikoflowState(dir, sid)!.depth).toBeNull();
    // and the premature tag's request-id was rotated
    expect(readNikoflowState(dir, sid)!.request_id).not.toBe(rid);
  });

  it("advances the human gate ONLY after a real user turn + correlated tag", async () => {
    await run(); // mint
    // premature self-emit → rotation (no user turn)
    writeTranscript(transcript, gate(readNikoflowState(dir, sid)!.request_id!));
    await run();
    // now a genuine user turn (sidecar), then the model re-emits with the fresh rid
    await new Promise((r) => setTimeout(r, 3));
    recordNikoflowUserPrompt(dir, sid);
    const freshRid = readNikoflowState(dir, sid)!.request_id!;
    writeTranscript(transcript, gate(freshRid));
    await run();
    const s = readNikoflowState(dir, sid)!;
    expect(s.depth).toBe("standard");
    expect(s.phases).toContain("interview");
  });

  it("keeps legacy interview gates human-gated when no autonomy mode was selected", async () => {
    createNikoflowLoopHook(dir).startLoop(sid, "nikoflow:standard build feature");
    await run(); // mint interview rid
    const rid = readNikoflowState(dir, sid)!.request_id!;
    writeTranscript(transcript, interviewGate(rid));
    await run();
    const s = readNikoflowState(dir, sid)!;
    expect(s.phase_index).toBe(0);
    expect(s.request_id).not.toBe(rid);
  });

  it("lets autonomous mode advance interview without per-step user approval", async () => {
    createNikoflowLoopHook(dir).startLoop(sid, "nikoflow:standard build feature --auto");
    await run(); // mint interview rid
    const rid = readNikoflowState(dir, sid)!.request_id!;
    writeTranscript(transcript, interviewGate(rid));
    await run();
    const s = readNikoflowState(dir, sid)!;
    expect(s.autonomy_mode).toBe("autonomous");
    expect(s.phase_index).toBe(1);
  });

  it("records autonomy mode chosen on the interview gate", async () => {
    createNikoflowLoopHook(dir).startLoop(sid, "nikoflow:standard build feature");
    await run(); // mint interview rid
    await new Promise((r) => setTimeout(r, 3));
    recordNikoflowUserPrompt(dir, sid);
    const rid = readNikoflowState(dir, sid)!.request_id!;
    writeTranscript(transcript, interviewGate(rid, "autonomous"));
    await run();
    const s = readNikoflowState(dir, sid)!;
    expect(s.autonomy_mode).toBe("autonomous");
    expect(s.phase_index).toBe(1);
  });

  it("stays inactive-safe: no state → returns null (does not block)", async () => {
    const r = await checkNikoflowLoop("other-session", dir, false, transcript);
    expect(r).toBeNull();
  });
});

describe("checkNikoflowLoop PRD/ADR coverage gate", () => {
  let dir: string;
  const sid = "sess-coverage";
  let transcript: string;

  const adrRecorded = (rid: string, ids?: string) =>
    `<nikoflow-gate phase="adr"${ids !== undefined ? ` decision-ids="${ids}"` : ""} request-id="${rid}">RECORDED</nikoflow-gate>`;
  const adrSkipped = (rid: string) =>
    `<nikoflow-gate phase="adr" skip="trivial" request-id="${rid}">SKIPPED</nikoflow-gate>`;
  const prdGate = (rid: string, stories?: string) =>
    `<nikoflow-gate phase="prd"${stories !== undefined ? ` stories="${stories}"` : ""} request-id="${rid}">SEAMS_CONFIRMED</nikoflow-gate>`;
  const ticketsGate = (rid: string) =>
    `<nikoflow-gate phase="tickets" request-id="${rid}">APPROVED</nikoflow-gate>`;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "nikoflow-cov-"));
    execSync("git init -q", { cwd: dir });
    transcript = join(dir, "t.jsonl");
    writeFileSync(transcript, "");
    // Autonomous standard tier: interview/prd/tickets gates need no user turn,
    // so the test can drive the phases with correlated tags alone.
    createNikoflowLoopHook(dir).startLoop(sid, "nikoflow:standard build feature --auto");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const run = () => checkNikoflowLoop(sid, dir, false, transcript);
  const rid = () => readNikoflowState(dir, sid)!.request_id!;
  const emit = async (tag: string) => {
    writeFileSync(
      transcript,
      JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: tag }] } }) + "\n",
    );
    return run();
  };
  const passInterview = async () => {
    await run(); // mint interview rid
    await emit(`<nikoflow-gate phase="interview" request-id="${rid()}">CONFIRMED</nikoflow-gate>`);
    expect(readNikoflowState(dir, sid)!.phases[readNikoflowState(dir, sid)!.phase_index]).toBe("adr");
  };
  const writeCovTickets = (tickets: Array<Record<string, unknown>>) => {
    writeTickets(dir, { version: 1, tickets } as never, sid);
  };

  it("prd gate with stories persists prd_story_ids; adr RECORDED persists decision ids", async () => {
    await passInterview();
    await emit(adrRecorded(rid(), "ADR-0001"));
    expect(readNikoflowState(dir, sid)!.adr_decision_ids).toEqual(["ADR-0001"]);
    await emit(prdGate(rid(), "ST-001,ST-002"));
    const s = readNikoflowState(dir, sid)!;
    expect(s.prd_story_ids).toEqual(["ST-001", "ST-002"]);
    expect(s.phases[s.phase_index]).toBe("tickets");
  });

  it("adr SKIPPED persists [] (nothing trackable, unknown ids still block later)", async () => {
    await passInterview();
    await emit(adrSkipped(rid()));
    expect(readNikoflowState(dir, sid)!.adr_decision_ids).toEqual([]);
  });

  it("tickets gate blocks on a coverage gap AND rotates the request-id", async () => {
    await passInterview();
    await emit(adrSkipped(rid()));
    await emit(prdGate(rid(), "ST-001,ST-002"));
    // ST-002 has no covering ticket → gap.
    writeCovTickets([
      { id: "TSK-001", story_id: "ST-001", title: "a", acceptance: ["a"], blocked_by: [], status: "todo" },
    ]);
    const ticketsRid = rid();
    const r = await emit(ticketsGate(ticketsRid));
    expect(r?.message).toContain("ticket coverage gap");
    expect(r?.message).toContain("PRD story ST-002 has no covering ticket");
    const s = readNikoflowState(dir, sid)!;
    expect(s.phases[s.phase_index]).toBe("tickets"); // did not advance
    expect(s.request_id).not.toBe(ticketsRid); // approval rotated — gap fix needs re-approval
  });

  it("full coverage advances the tickets gate to execute", async () => {
    await passInterview();
    await emit(adrRecorded(rid(), "ADR-0001"));
    await emit(prdGate(rid(), "ST-001"));
    writeCovTickets([
      { id: "TSK-001", story_id: "ST-001", decision_ids: ["ADR-0001"], title: "a", acceptance: ["a"], blocked_by: [], status: "todo" },
    ]);
    await emit(ticketsGate(rid()));
    const s = readNikoflowState(dir, sid)!;
    expect(s.phases[s.phase_index]).toBe("execute");
  });

  it("legacy flow without coverage attrs advances the tickets gate as before", async () => {
    await passInterview();
    await emit(adrRecorded(rid())); // no decision-ids attr → untracked
    await emit(prdGate(rid())); // no stories attr → untracked
    const s0 = readNikoflowState(dir, sid)!;
    expect(s0.prd_story_ids).toBeUndefined();
    expect(s0.adr_decision_ids).toBeUndefined();
    writeCovTickets([
      { id: "TSK-001", title: "a", acceptance: ["a"], blocked_by: [], status: "todo" },
    ]);
    await emit(ticketsGate(rid()));
    const s = readNikoflowState(dir, sid)!;
    expect(s.phases[s.phase_index]).toBe("execute");
  });
});
