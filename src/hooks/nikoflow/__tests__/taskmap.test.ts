import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from "fs";
import { execSync } from "child_process";
import { tmpdir } from "os";
import { join } from "path";
import {
  NIKOFLOW_TASK_STATUS,
  computeTaskBoardDrift,
  readTaskBoardTasks,
  readTaskmapSidecar,
  writeTaskmapSidecar,
  clearTaskmapSidecar,
  createNikoflowLoopHook,
  readNikoflowState,
  setNikoflowDepth,
  advanceNikoflowPhase,
  clearNikoflowState,
  writeTickets,
  type NikoflowTicketsFile,
  type TaskBoardTask,
  type TaskmapSidecar,
} from "../index.js";
import { sweepNikoflowRoots } from "../loop.js";
import { resolveSessionStatePath, getOmcRoot } from "../../../lib/worktree-paths.js";
import { handleNikoflowExecute, checkNikoflowLoop } from "../../persistent-mode/index.js";

const file = (tickets: NikoflowTicketsFile["tickets"]): NikoflowTicketsFile => ({
  version: 1,
  tickets,
});

const ticket = (
  id: string,
  status: NikoflowTicketsFile["tickets"][number]["status"],
  title = "t",
) => ({ id, title, acceptance: [], blocked_by: [], status });

const task = (id: string, subject: string, status: string): TaskBoardTask => ({
  id,
  subject,
  status,
});

describe("NIKOFLOW_TASK_STATUS mapping", () => {
  it("maps all five ticket statuses onto the native task statuses", () => {
    expect(NIKOFLOW_TASK_STATUS.todo).toBe("pending");
    expect(NIKOFLOW_TASK_STATUS.red).toBe("in_progress");
    expect(NIKOFLOW_TASK_STATUS.green).toBe("in_progress");
    expect(NIKOFLOW_TASK_STATUS.review).toBe("in_progress");
    expect(NIKOFLOW_TASK_STATUS.done).toBe("completed");
  });
});

describe("computeTaskBoardDrift (pure)", () => {
  const RUN = "run-1234";

  it("instructs a create for an unmirrored ticket (with the target status)", () => {
    const { line, nextSidecar } = computeTaskBoardDrift(
      file([ticket("TSK-004", "red", "wire the parser")]),
      [],
      null,
      RUN,
    );
    expect(line).toContain('TaskCreate "TSK-004 — wire the parser"');
    expect(line).toContain("in_progress");
    expect(line).toContain("tickets.json is the source of truth");
    expect(nextSidecar.map["TSK-004"]).toBeUndefined(); // nothing pinned yet
    expect(nextSidecar.run_id).toBe(RUN);
  });

  it("omits the status hint when the target is pending", () => {
    const { line } = computeTaskBoardDrift(
      file([ticket("TSK-001", "todo", "a")]),
      [],
      null,
      RUN,
    );
    expect(line).toContain('TaskCreate "TSK-001 — a"');
    expect(line).not.toContain("TaskUpdate");
  });

  it("instructs an update when the mapped task's status drifted", () => {
    const { line, nextSidecar } = computeTaskBoardDrift(
      file([ticket("TSK-002", "done")]),
      [task("t-9", "TSK-002 — b", "in_progress")],
      null,
      RUN,
    );
    expect(line).toContain("TaskUpdate t-9 → completed for TSK-002");
    expect(nextSidecar.map["TSK-002"]).toEqual({
      task_id: "t-9",
      last_projected_status: "completed",
    });
  });

  it("re-converges a manually-completed task whose ticket is not done (downward authority)", () => {
    const { line } = computeTaskBoardDrift(
      file([ticket("TSK-003", "red")]),
      [task("t-1", "TSK-003 — c", "completed")],
      null,
      RUN,
    );
    expect(line).toContain("TaskUpdate t-1 → in_progress for TSK-003");
  });

  it("emits no line when the board matches the tickets", () => {
    const { line } = computeTaskBoardDrift(
      file([ticket("TSK-001", "todo"), ticket("TSK-002", "done")]),
      [task("t-1", "TSK-001 — a", "pending"), task("t-2", "TSK-002 — b", "completed")],
      null,
      RUN,
    );
    expect(line).toBeNull();
  });

  it("keeps the pinned task and instructs deleting a duplicate prefix", () => {
    const sidecar: TaskmapSidecar = {
      version: 1,
      run_id: RUN,
      map: { "TSK-001": { task_id: "t-1", last_projected_status: "pending" } },
      updated_at: new Date().toISOString(),
    };
    const { line, nextSidecar } = computeTaskBoardDrift(
      file([ticket("TSK-001", "todo")]),
      [task("t-2", "TSK-001 — copy", "pending"), task("t-1", "TSK-001 — a", "pending")],
      sidecar,
      RUN,
    );
    expect(nextSidecar.map["TSK-001"].task_id).toBe("t-1"); // pin kept
    expect(line).toContain("TaskUpdate t-2 → deleted (duplicate of TSK-001)");
    expect(line).not.toContain("TaskCreate");
  });

  it("tolerates a subject rename on the pinned task (joins by pinned id)", () => {
    const sidecar: TaskmapSidecar = {
      version: 1,
      run_id: RUN,
      map: { "TSK-001": { task_id: "t-1", last_projected_status: "pending" } },
      updated_at: new Date().toISOString(),
    };
    const { line, nextSidecar } = computeTaskBoardDrift(
      file([ticket("TSK-001", "todo")]),
      [task("t-1", "renamed subject", "pending")],
      sidecar,
      RUN,
    );
    expect(line).toBeNull(); // still mapped, status matches
    expect(nextSidecar.map["TSK-001"].task_id).toBe("t-1");
  });

  it("does not confuse TSK-001 with TSK-0011 (prefix boundary)", () => {
    const { line } = computeTaskBoardDrift(
      file([ticket("TSK-001", "todo")]),
      [task("t-x", "TSK-0011 — other", "pending")],
      null,
      "r",
    );
    expect(line).toContain('TaskCreate "TSK-001'); // the other task is not a candidate
  });

  it("discards the old map on run_id mismatch (restarted run never adopts old pins)", () => {
    const sidecar: TaskmapSidecar = {
      version: 1,
      run_id: "old-run",
      map: { "TSK-001": { task_id: "ghost", last_projected_status: "completed" } },
      updated_at: new Date().toISOString(),
    };
    const { nextSidecar } = computeTaskBoardDrift(
      file([ticket("TSK-001", "todo")]),
      [],
      sidecar,
      "new-run",
    );
    expect(nextSidecar.run_id).toBe("new-run");
    expect(nextSidecar.map).toEqual({}); // ghost pin not carried over
  });

  it("drops pins for tickets that no longer exist", () => {
    const sidecar: TaskmapSidecar = {
      version: 1,
      run_id: "r",
      map: { "TSK-099": { task_id: "t-old", last_projected_status: "pending" } },
      updated_at: new Date().toISOString(),
    };
    const { nextSidecar } = computeTaskBoardDrift(file([ticket("TSK-001", "todo")]), [], sidecar, "r");
    expect(nextSidecar.map["TSK-099"]).toBeUndefined();
  });
});

describe("taskmap IO edges", () => {
  let dir: string;
  const sid = "sess-taskmap";
  const savedConfig = process.env.CLAUDE_CONFIG_DIR;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "nikoflow-tm-"));
    process.env.CLAUDE_CONFIG_DIR = join(dir, "claude");
  });
  afterEach(() => {
    if (savedConfig === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = savedConfig;
    rmSync(dir, { recursive: true, force: true });
  });

  it("readTaskBoardTasks: invalid session id → null (projection disabled, no throw)", () => {
    expect(readTaskBoardTasks("../evil")).toBeNull();
    expect(readTaskBoardTasks("")).toBeNull();
  });

  it("readTaskBoardTasks: missing dir → [] (normal early state)", () => {
    expect(readTaskBoardTasks(sid)).toEqual([]);
  });

  it("readTaskBoardTasks: unreadable task dir (a file, not a dir) → null", () => {
    mkdirSync(join(dir, "claude", "tasks"), { recursive: true });
    writeFileSync(join(dir, "claude", "tasks", sid), "not a directory");
    expect(readTaskBoardTasks(sid)).toBeNull();
  });

  it("readTaskBoardTasks: parses valid tasks, skips .lock/junk/deleted", () => {
    const taskDir = join(dir, "claude", "tasks", sid);
    mkdirSync(taskDir, { recursive: true });
    writeFileSync(join(taskDir, "1.json"), JSON.stringify({ id: "1", subject: "TSK-001 — a", status: "pending" }));
    writeFileSync(join(taskDir, "2.json"), JSON.stringify({ id: "2", subject: "TSK-002 — b", status: "deleted" }));
    writeFileSync(join(taskDir, "junk.json"), "{corrupt");
    writeFileSync(join(taskDir, ".lock"), "");
    const tasks = readTaskBoardTasks(sid)!;
    expect(tasks).toHaveLength(1);
    expect(tasks[0].id).toBe("1");
  });

  it("sidecar roundtrip + corrupt sidecar reads as null (treated empty)", () => {
    const sc: TaskmapSidecar = {
      version: 1,
      run_id: "r1",
      map: { "TSK-001": { task_id: "t-1", last_projected_status: "pending" } },
      updated_at: new Date().toISOString(),
    };
    expect(writeTaskmapSidecar(dir, sc, sid)).toBe(true);
    expect(readTaskmapSidecar(dir, sid)!.map["TSK-001"].task_id).toBe("t-1");

    const p = resolveSessionStatePath("nikoflow-taskmap", sid, dir);
    writeFileSync(p, "{corrupt json");
    expect(readTaskmapSidecar(dir, sid)).toBeNull();
    // atomic rewrite over the corrupt file works
    expect(writeTaskmapSidecar(dir, sc, sid)).toBe(true);
    expect(readTaskmapSidecar(dir, sid)).not.toBeNull();

    clearTaskmapSidecar(dir, sid);
    expect(existsSync(p)).toBe(false);
  });

  it("clearNikoflowState removes the taskmap sidecar", () => {
    createNikoflowLoopHook(dir).startLoop(sid, "x");
    writeTaskmapSidecar(
      dir,
      { version: 1, run_id: "r", map: {}, updated_at: new Date().toISOString() },
      sid,
    );
    const p = resolveSessionStatePath("nikoflow-taskmap", sid, dir);
    expect(existsSync(p)).toBe(true);
    clearNikoflowState(dir, sid);
    expect(existsSync(p)).toBe(false);
  });

  it("sweepNikoflowRoots sweeps nikoflow-taskmap-state.json", () => {
    const registry = join(dir, "roots.json");
    const savedRoots = process.env.OMC_NIKOFLOW_ROOTS_FILE;
    process.env.OMC_NIKOFLOW_ROOTS_FILE = registry;
    try {
      const root = getOmcRoot(dir);
      writeFileSync(registry, JSON.stringify({ roots: [root] }));
      writeTaskmapSidecar(
        dir,
        { version: 1, run_id: "r", map: {}, updated_at: new Date().toISOString() },
        sid,
      );
      const p = resolveSessionStatePath("nikoflow-taskmap", sid, dir);
      expect(existsSync(p)).toBe(true);
      sweepNikoflowRoots(sid);
      expect(existsSync(p)).toBe(false);
    } finally {
      if (savedRoots === undefined) delete process.env.OMC_NIKOFLOW_ROOTS_FILE;
      else process.env.OMC_NIKOFLOW_ROOTS_FILE = savedRoots;
    }
  });
});

describe("execute integration: advisory drift line (non-gating)", () => {
  let dir: string;
  const sid = "sess-taskmap-exec";
  const savedConfig = process.env.CLAUDE_CONFIG_DIR;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "nikoflow-tmx-"));
    // git-init so resolveToWorktreeRoot (inside checkNikoflowLoop) resolves here.
    execSync("git init -q", { cwd: dir });
    process.env.CLAUDE_CONFIG_DIR = join(dir, "claude");
    createNikoflowLoopHook(dir).startLoop(sid, "build");
    setNikoflowDepth(dir, "standard", sid);
    advanceNikoflowPhase(dir, sid); // adr
    advanceNikoflowPhase(dir, sid); // prd
    advanceNikoflowPhase(dir, sid); // tickets
    advanceNikoflowPhase(dir, sid); // execute
    writeTickets(
      dir,
      file([ticket("TSK-001", "todo", "first"), ticket("TSK-002", "todo", "second")]),
      sid,
    );
  });
  afterEach(() => {
    if (savedConfig === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = savedConfig;
    rmSync(dir, { recursive: true, force: true });
  });

  const run = () => handleNikoflowExecute(dir, sid, readNikoflowState(dir, sid)!, undefined);

  it("appends the drift line to the per-ticket prompt (board seeding)", () => {
    const r = run();
    expect(r.shouldBlock).toBe(true);
    expect(r.message).toContain("Task board (mirror only");
    expect(r.message).toContain('TaskCreate "TSK-001 — first"');
    expect(r.message).toContain('TaskCreate "TSK-002 — second"');
  });

  it("with the task dir unreadable, the result is byte-identical except the absent line", () => {
    // Unreadable lane: tasks/{sid} is a FILE → readdir throws → projection disabled.
    mkdirSync(join(dir, "claude", "tasks"), { recursive: true });
    writeFileSync(join(dir, "claude", "tasks", sid), "not a dir");
    const disabled = run();
    expect(disabled.message).not.toContain("Task board");
    const stallAfterDisabled = readNikoflowState(dir, sid)!.execute_stall;

    // Readable lane (empty board) on the SAME gate/request-id.
    rmSync(join(dir, "claude", "tasks", sid));
    const enabled = run();
    expect(enabled.shouldBlock).toBe(disabled.shouldBlock);
    expect(enabled.mode).toBe(disabled.mode);
    // identical message except the one appended line
    expect(enabled.message.startsWith(disabled.message)).toBe(true);
    const extra = enabled.message.slice(disabled.message.length);
    expect(extra).toMatch(/^\nTask board \(mirror only/);
    // stall counter advanced by exactly one per Stop — drift adds no bumps
    expect(readNikoflowState(dir, sid)!.execute_stall).toBe((stallAfterDisabled ?? 0) + 1);
  });

  it("mirrored board with no drift appends nothing", () => {
    run(); // seeds sidecar (empty board → create instructions)
    const taskDir = join(dir, "claude", "tasks", sid);
    mkdirSync(taskDir, { recursive: true });
    writeFileSync(join(taskDir, "1.json"), JSON.stringify({ id: "1", subject: "TSK-001 — first", status: "pending" }));
    writeFileSync(join(taskDir, "2.json"), JSON.stringify({ id: "2", subject: "TSK-002 — second", status: "pending" }));
    const r = run();
    expect(r.message).not.toContain("Task board");
    // sidecar pinned both tickets
    const sc = readTaskmapSidecar(dir, sid)!;
    expect(sc.map["TSK-001"].task_id).toBe("1");
    expect(sc.map["TSK-002"].task_id).toBe("2");
    expect(sc.run_id).toBe(readNikoflowState(dir, sid)!.run_id);
  });

  it("completion prompt carries the board-cleanup line", async () => {
    // Drive the state to complete (past the last phase) and let checkNikoflowLoop emit it.
    advanceNikoflowPhase(dir, sid); // verify
    advanceNikoflowPhase(dir, sid); // → complete
    const r = await checkNikoflowLoop(sid, dir, false, undefined);
    expect(r?.message).toContain('phase="complete"');
    expect(r?.message).toContain("mark them all completed");
  });

  it("drift never mutates gate correlation (request-id untouched)", () => {
    run(); // mints execute:TSK-001 rid + writes sidecar
    const rid = readNikoflowState(dir, sid)!.request_id;
    run();
    expect(readNikoflowState(dir, sid)!.request_id).toBe(rid);
  });
});
