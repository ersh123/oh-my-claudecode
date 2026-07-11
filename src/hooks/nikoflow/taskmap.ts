/**
 * Nikoflow tickets → native Task-UI projection (one-way, advisory-only).
 *
 * tickets.json stays the ONLY authority. The hook never writes
 * ~/.claude/tasks/** (undocumented format, Claude Code holds its own .lock);
 * instead the phase prompts instruct the model to mirror ticket status via its
 * native TaskCreate/TaskUpdate tools, and the Stop hook validates drift
 * READ-ONLY and re-instructs with one short line. Drift must NEVER gate:
 * it never blocks phase advance, never bumps stall counters, never touches
 * gate detection or request-id rotation.
 *
 * The mapping sidecar is HOOK-authored only (never model-written — model
 * writing hook state would be an injection surface). It lives in a DEDICATED
 * file (like the user-turn sidecar, Fable QA R2) so no RMW on
 * nikoflow-state.json can resurrect a rotated request-id.
 */

import { existsSync, readdirSync, readFileSync, unlinkSync } from "fs";
import { join } from "path";
import { atomicWriteJsonSync } from "../../lib/atomic-write.js";
import {
  resolveSessionStatePath,
  ensureSessionStateDir,
} from "../../lib/worktree-paths.js";
import { getTaskDirectory, isValidTask } from "../todo-continuation/index.js";
import {
  TICKET_ID_PATTERN,
  type NikoflowTicketsFile,
  type TicketStatus,
} from "./tickets.js";

/** Statuses the native Task UI accepts (todo-continuation validates the same set). */
export type TaskBoardStatus = "pending" | "in_progress" | "completed";

/** One-way ticket→task status mapping (F-11). */
export const NIKOFLOW_TASK_STATUS: Record<TicketStatus, TaskBoardStatus> = {
  todo: "pending",
  red: "in_progress",
  green: "in_progress",
  review: "in_progress",
  done: "completed",
};

/** Minimal structural view of a native task file (subset of Task). */
export interface TaskBoardTask {
  id: string;
  subject: string;
  status: string;
}

export interface TaskmapEntry {
  /** First-seen native task id pinned to this ticket. */
  task_id: string;
  /** The status the projection last asked the board to show. */
  last_projected_status: TaskBoardStatus;
}

export interface TaskmapSidecar {
  version: 1;
  /** Run scoping: a restarted run never adopts the old board's pins. */
  run_id?: string;
  map: Record<string, TaskmapEntry>;
  updated_at: string;
}

const TASKMAP_STATE_KEY = "nikoflow-taskmap";

function taskmapPath(directory: string, sessionId: string): string {
  return resolveSessionStatePath(TASKMAP_STATE_KEY, sessionId, directory);
}

/**
 * Read the session's native task files (read-only observation of the board).
 * Returns null when projection must be DISABLED for this Stop: invalid/missing
 * session id, or an unreadable task directory. A missing directory is normal
 * early state (no tasks created yet) and returns []. 'deleted' tasks are
 * treated as nonexistent.
 */
export function readTaskBoardTasks(sessionId: string): TaskBoardTask[] | null {
  let dir: string;
  try {
    dir = getTaskDirectory(sessionId);
  } catch {
    return null;
  }
  if (!dir) return null; // invalid session id → projection disabled
  if (!existsSync(dir)) return [];
  let files: string[];
  try {
    files = readdirSync(dir);
  } catch {
    return null; // unreadable → projection disabled, never gate
  }
  const tasks: TaskBoardTask[] = [];
  for (const file of files) {
    if (!file.endsWith(".json") || file === ".lock") continue;
    try {
      const parsed = JSON.parse(readFileSync(join(dir, file), "utf-8"));
      if (isValidTask(parsed) && parsed.status !== "deleted") {
        tasks.push({ id: parsed.id, subject: parsed.subject, status: parsed.status });
      }
    } catch {
      /* skip unparseable task file */
    }
  }
  return tasks;
}

/** Read the hook-authored mapping sidecar. Corrupt/missing ⇒ null (treated as empty). */
export function readTaskmapSidecar(
  directory: string,
  sessionId: string,
): TaskmapSidecar | null {
  try {
    const p = taskmapPath(directory, sessionId);
    if (!existsSync(p)) return null;
    const raw = JSON.parse(readFileSync(p, "utf-8")) as Record<string, unknown>;
    if (!raw || typeof raw !== "object" || raw.version !== 1) return null;
    if (!raw.map || typeof raw.map !== "object" || Array.isArray(raw.map)) return null;
    return raw as unknown as TaskmapSidecar;
  } catch {
    return null;
  }
}

/** Persist the sidecar atomically (same rationale as the user-turn sidecar). */
export function writeTaskmapSidecar(
  directory: string,
  sidecar: TaskmapSidecar,
  sessionId: string,
): boolean {
  try {
    ensureSessionStateDir(sessionId, directory);
    atomicWriteJsonSync(taskmapPath(directory, sessionId), sidecar);
    return true;
  } catch {
    return false;
  }
}

/** Delete the sidecar (state cleanup). Best-effort. */
export function clearTaskmapSidecar(directory: string, sessionId: string): void {
  try {
    const p = taskmapPath(directory, sessionId);
    if (existsSync(p)) unlinkSync(p);
  } catch {
    /* best-effort */
  }
}

export interface TaskBoardDrift {
  /** One short steering line naming only the drifted entries, or null. */
  line: string | null;
  nextSidecar: TaskmapSidecar;
}

/**
 * Pure drift computer: compare the ticket authority against the observed task
 * board and produce (a) one instruction line for the drifted entries and
 * (b) the next sidecar. Join key: task subject prefix "TSK-NNN". Projection is
 * authoritative downward — a manually-completed task whose ticket isn't done
 * re-converges to the ticket status. run_id mismatch ⇒ the old map is discarded.
 */
export function computeTaskBoardDrift(
  ticketsFile: NikoflowTicketsFile,
  tasks: TaskBoardTask[],
  sidecar: TaskmapSidecar | null,
  runId: string | undefined,
): TaskBoardDrift {
  const map: Record<string, TaskmapEntry> =
    sidecar && sidecar.version === 1 && sidecar.run_id === runId
      ? { ...sidecar.map }
      : {};

  // Group live tasks by their ticket-id subject prefix.
  const byPrefix = new Map<string, TaskBoardTask[]>();
  for (const task of tasks) {
    const m = task.subject.match(/^(TSK-\d{1,5})(?!\d)/);
    if (!m || !TICKET_ID_PATTERN.test(m[1])) continue;
    byPrefix.set(m[1], [...(byPrefix.get(m[1]) ?? []), task]);
  }
  const byTaskId = new Map(tasks.map((t) => [t.id, t]));

  const actions: string[] = [];
  const liveTickets = new Set<string>();
  for (const ticket of ticketsFile.tickets) {
    liveTickets.add(ticket.id);
    const target = NIKOFLOW_TASK_STATUS[ticket.status];
    const candidates = byPrefix.get(ticket.id) ?? [];

    // Keep the pinned task by id even if its subject was renamed; otherwise
    // pin the first-seen candidate (duplicate detection keys off the pin).
    let pinned = map[ticket.id] ? byTaskId.get(map[ticket.id].task_id) : undefined;
    if (!pinned) pinned = candidates[0];

    if (!pinned) {
      delete map[ticket.id]; // stale pin (task vanished/deleted)
      actions.push(
        `TaskCreate "${ticket.id} — ${ticket.title}"` +
          (target !== "pending" ? ` then TaskUpdate it → ${target}` : ""),
      );
      continue;
    }

    map[ticket.id] = { task_id: pinned.id, last_projected_status: target };
    if (pinned.status !== target) {
      actions.push(`TaskUpdate ${pinned.id} → ${target} for ${ticket.id}`);
    }
    for (const extra of candidates) {
      if (extra.id !== pinned.id) {
        actions.push(`TaskUpdate ${extra.id} → deleted (duplicate of ${ticket.id})`);
      }
    }
  }

  // Drop pins for tickets that no longer exist in the authority file.
  for (const key of Object.keys(map)) {
    if (!liveTickets.has(key)) delete map[key];
  }

  return {
    line: actions.length
      ? `Task board (mirror only — tickets.json is the source of truth): ${actions.join("; ")}.`
      : null,
    nextSidecar: {
      version: 1,
      ...(runId !== undefined ? { run_id: runId } : {}),
      map,
      updated_at: new Date().toISOString(),
    },
  };
}
