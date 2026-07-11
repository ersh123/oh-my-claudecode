import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { execSync } from "child_process";
import { tmpdir } from "os";
import { join } from "path";

// Count actual nikoflow-state.json writes (perf F1): the whole Stop must be ONE
// state transaction. Mocking at the mode-state-io seam intercepts every write
// path (loop.ts wrappers AND the orchestrator's flush) without touching fs.
vi.mock("../../../lib/mode-state-io.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../../../lib/mode-state-io.js")>();
  return { ...mod, writeModeState: vi.fn(mod.writeModeState) };
});

import { writeModeState } from "../../../lib/mode-state-io.js";
import {
  createNikoflowLoopHook,
  readNikoflowState,
  setNikoflowDepth,
  advanceNikoflowPhase,
  getCurrentPhase,
} from "../index.js";
import { checkNikoflowLoop } from "../../persistent-mode/index.js";

const writeSpy = vi.mocked(writeModeState);

const nikoflowWrites = () =>
  writeSpy.mock.calls.filter((call) => call[0] === "nikoflow");

const reviewerResult = (toolUseId: string, text: string) => [
  { type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id: toolUseId, name: "Task", input: { subagent_type: "code-reviewer" } }] } },
  { type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: toolUseId, content: [{ type: "text", text }] }] } },
];

describe("nikoflow single state write per Stop (perf F1)", () => {
  let dir: string;
  const sid = "sess-coalesce";
  let transcript: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "nikoflow-w1-"));
    execSync("git init -q", { cwd: dir });
    transcript = join(dir, "t.jsonl");
    writeFileSync(transcript, "");
    createNikoflowLoopHook(dir).startLoop(sid, "build");
    setNikoflowDepth(dir, "standard", sid);
    for (let i = 0; i < 5; i++) advanceNikoflowPhase(dir, sid); // → verify
    expect(getCurrentPhase(readNikoflowState(dir, sid)!)).toBe("verify");
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    writeSpy.mockClear();
  });

  it("a sub-threshold verify Stop performs exactly ONE state write and persists the post-rotation id", async () => {
    await checkNikoflowLoop(sid, dir, false, transcript); // mint the verify rid
    const rid = readNikoflowState(dir, sid)!.request_id!;
    writeFileSync(
      transcript,
      reviewerResult("tu-1", `<nikoflow-gate phase="verify" score="8.0" request-id="${rid}">VERIFIED</nikoflow-gate>`)
        .map((e) => JSON.stringify(e))
        .join("\n") + "\n",
    );

    writeSpy.mockClear();
    await checkNikoflowLoop(sid, dir, false, transcript);

    // Exactly one nikoflow-state write for the whole Stop (iteration bump +
    // verify-pass record + request-id rotation coalesced).
    const writes = nikoflowWrites();
    expect(writes.length).toBe(1);

    // The persisted request-id is the POST-rotation id — the stale sub-threshold
    // review can never re-satisfy the next pass (Fable QA R2).
    const persisted = readNikoflowState(dir, sid)!;
    expect(persisted.request_id).toBeTruthy();
    expect(persisted.request_id).not.toBe(rid);
    expect(persisted.verify_pass).toBe(1);
    expect(getCurrentPhase(persisted)).toBe("verify");
    // And the single write carried that same post-rotation id.
    const written = writes[0][1] as { request_id?: string };
    expect(written.request_id).toBe(persisted.request_id);
  });

  it("an idle Stop (no verdict) also performs exactly ONE state write", async () => {
    await checkNikoflowLoop(sid, dir, false, transcript); // mint
    writeSpy.mockClear();
    await checkNikoflowLoop(sid, dir, false, transcript);
    expect(nikoflowWrites().length).toBe(1);
    // no-verdict counter still advanced within that single write (both idle
    // Stops bumped it: 1 on the minting Stop, 2 on the measured one)
    expect(readNikoflowState(dir, sid)!.verify_no_verdict).toBe(2);
  });
});
