/**
 * Nikoflow tickets model.
 *
 * The Ticketization phase decomposes the PRD into atomic vertical-slice tickets
 * (TSK-001…) with acceptance criteria + blocked-by dependencies. This module
 * owns the tickets.json shape, normalization (reject junk), DAG validation
 * (cycles + dangling refs), and deterministic next-ticket selection consumed by
 * the Execute phase (TSK-005).
 */

import { existsSync, readFileSync, unlinkSync } from "fs";
import { atomicWriteJsonSync } from "../../lib/atomic-write.js";
import {
  resolveSessionStatePath,
  ensureSessionStateDir,
  getOmcRoot,
} from "../../lib/worktree-paths.js";
import { join } from "path";

export type TicketStatus = "todo" | "red" | "green" | "review" | "done";
const TICKET_STATUSES: readonly TicketStatus[] = [
  "todo",
  "red",
  "green",
  "review",
  "done",
];

export interface NikoflowTicket {
  /** Stable id, e.g. "TSK-001". */
  id: string;
  /** Optional originating PRD story id. */
  story_id?: string;
  /** ADR decision ids (e.g. "ADR-0001") this ticket helps implement. */
  decision_ids?: string[];
  title: string;
  /** Acceptance criteria (checkbox lines). */
  acceptance: string[];
  /** Ids of tickets that must be done before this one can start. */
  blocked_by: string[];
  /** How to independently verify this slice. */
  self_verify?: string;
  /** Whether this ticket owes property-based tests (deep tier). */
  pbt_required?: boolean;
  status: TicketStatus;
  /** Evidence collected during execution/review. */
  evidence?: Record<string, unknown>;
}

/** One recorded test run. Model-written: shape-checked, never executed. */
export interface TddRunEvidence {
  command: string;          // non-empty
  exit_code: number;        // integer; red != 0, green === 0
  head_sha: string;         // /^[0-9a-f]{7,40}$/i — forensic, not ordered
  recorded_at: string;      // ISO; ordering source of truth
}
export interface TddRedEvidence extends TddRunEvidence {
  expected_failure: string; // non-empty one-liner: why it fails pre-change
}
export interface TddEvidence {
  red?: TddRedEvidence;
  green?: TddRunEvidence;
  /** Docs-only / no-runtime-surface escape hatch. */
  waived?: { reason: string };
}

export interface NikoflowTicketsFile {
  version: 1;
  tickets: NikoflowTicket[];
}

export interface DagValidation {
  ok: boolean;
  /** Human-readable reasons the DAG is invalid. */
  errors: string[];
}

const TICKETS_STATE_KEY = "nikoflow-tickets";

function ticketsPath(directory: string, sessionId?: string): string {
  if (sessionId) {
    return resolveSessionStatePath(TICKETS_STATE_KEY, sessionId, directory);
  }
  return join(getOmcRoot(directory), `${TICKETS_STATE_KEY}.json`);
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.length > 0);
}

/**
 * Normalize an untrusted parsed object into a tickets file, dropping anything
 * that does not fit the shape. Returns null if it is not a tickets file at all.
 */
export function normalizeTicketsFile(raw: unknown): NikoflowTicketsFile | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.tickets)) return null;

  const tickets: NikoflowTicket[] = [];
  for (const t of obj.tickets) {
    if (!t || typeof t !== "object") continue;
    const rec = t as Record<string, unknown>;
    // Same id grammar as lintTicketsRaw — normalize output must stay lint-clean.
    if (typeof rec.id !== "string" || !TICKET_ID_PATTERN.test(rec.id)) continue;
    if (typeof rec.title !== "string") continue;

    const status =
      typeof rec.status === "string" &&
      (TICKET_STATUSES as readonly string[]).includes(rec.status)
        ? (rec.status as TicketStatus)
        : "todo";

    tickets.push({
      id: rec.id,
      ...(typeof rec.story_id === "string" ? { story_id: rec.story_id } : {}),
      ...(Array.isArray(rec.decision_ids)
        ? { decision_ids: asStringArray(rec.decision_ids) }
        : {}),
      title: rec.title,
      acceptance: asStringArray(rec.acceptance),
      blocked_by: asStringArray(rec.blocked_by),
      ...(typeof rec.self_verify === "string"
        ? { self_verify: rec.self_verify }
        : {}),
      ...(typeof rec.pbt_required === "boolean"
        ? { pbt_required: rec.pbt_required }
        : {}),
      status,
      ...(rec.evidence && typeof rec.evidence === "object"
        ? { evidence: rec.evidence as Record<string, unknown> }
        : {}),
    });
  }

  return { version: 1, tickets };
}

/**
 * Lint the RAW parsed tickets object for shape problems that normalization
 * would silently launder into a valid-but-wrong graph (e.g. `blocked_by` given
 * as a bare string, a mistyped status, a non-string acceptance entry). The
 * tickets gate surfaces these instead of quietly dropping data.
 */
/** Strict ticket id grammar. Also what keeps worktree path/branch names
 *  (derived from the id) collision-free without a separate sanitize check. */
export const TICKET_ID_PATTERN = /^TSK-\d{1,5}$/;

export function lintTicketsRaw(raw: unknown): string[] {
  const warnings: string[] = [];
  if (!raw || typeof raw !== "object") {
    return ["tickets.json is not an object"];
  }
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.tickets)) {
    return ["tickets.json has no 'tickets' array"];
  }
  if ("version" in obj && obj.version !== 1) {
    warnings.push(`unsupported tickets.json version ${JSON.stringify(obj.version)} (expected 1)`);
  }
  obj.tickets.forEach((t, i) => {
    const label = `ticket #${i + 1}`;
    if (!t || typeof t !== "object") {
      warnings.push(`${label}: not an object`);
      return;
    }
    const rec = t as Record<string, unknown>;
    const id = typeof rec.id === "string" ? rec.id : label;
    if (typeof rec.id !== "string" || !rec.id) {
      warnings.push(`${label}: missing string id`);
    } else if (!TICKET_ID_PATTERN.test(rec.id)) {
      warnings.push(`${label}: id ${JSON.stringify(rec.id)} must match TSK-NNN`);
    }
    if (typeof rec.title !== "string") warnings.push(`${id}: missing string title`);
    // Coverage ids feed the tickets-gate coverage check — a mistyped shape
    // would be silently dropped by normalization and skip coverage unnoticed.
    if ("story_id" in rec && typeof rec.story_id !== "string") {
      warnings.push(`${id}: story_id must be a string, not ${typeof rec.story_id}`);
    }
    if ("decision_ids" in rec && !Array.isArray(rec.decision_ids)) {
      warnings.push(`${id}: decision_ids must be an array of ids, not ${typeof rec.decision_ids}`);
    }
    if (Array.isArray(rec.decision_ids)) {
      rec.decision_ids.forEach((d, j) => {
        if (typeof d !== "string" || !d) {
          warnings.push(`${id}: decision_ids[${j}] must be a non-empty decision id, got ${JSON.stringify(d)}`);
        }
      });
    }
    if ("blocked_by" in rec && !Array.isArray(rec.blocked_by)) {
      warnings.push(`${id}: blocked_by must be an array of ids, not ${typeof rec.blocked_by}`);
    }
    if ("acceptance" in rec && !Array.isArray(rec.acceptance)) {
      warnings.push(`${id}: acceptance must be an array`);
    }
    // Non-string/empty ARRAY ELEMENTS would be silently dropped by
    // normalization — a malformed dependency like blocked_by: [42] must fail
    // the gate loudly, not lint clean and vanish before DAG validation.
    if (Array.isArray(rec.blocked_by)) {
      rec.blocked_by.forEach((d, j) => {
        if (typeof d !== "string" || !d) {
          warnings.push(`${id}: blocked_by[${j}] must be a non-empty ticket id, got ${JSON.stringify(d)}`);
        }
      });
    }
    if (Array.isArray(rec.acceptance)) {
      rec.acceptance.forEach((a, j) => {
        if (typeof a !== "string" || !a) {
          warnings.push(`${id}: acceptance[${j}] must be a non-empty string, got ${JSON.stringify(a)}`);
        }
      });
    }
    if (
      "status" in rec &&
      !(typeof rec.status === "string" &&
        (TICKET_STATUSES as readonly string[]).includes(rec.status))
    ) {
      warnings.push(`${id}: invalid status ${JSON.stringify(rec.status)}`);
    }
  });
  return warnings;
}

/** Same sha grammar gitRevParse accepts (persistent-mode/index.ts gitRevParse). */
export const TDD_SHA_PATTERN = /^[0-9a-f]{7,40}$/i;

function lintTddRun(
  run: Record<string, unknown>,
  label: "red" | "green",
  errors: string[],
): void {
  if (typeof run.command !== "string" || !run.command.trim()) {
    errors.push(`${label}.command must be a non-empty string`);
  }
  if (typeof run.exit_code !== "number" || !Number.isInteger(run.exit_code)) {
    errors.push(`${label}.exit_code must be an integer`);
  } else if (label === "red" && run.exit_code === 0) {
    errors.push("red run exited 0 — a passing test is not RED proof");
  } else if (label === "green" && run.exit_code !== 0) {
    errors.push(`green.exit_code must be 0, got ${run.exit_code}`);
  }
  if (typeof run.head_sha !== "string" || !TDD_SHA_PATTERN.test(run.head_sha)) {
    errors.push(`${label}.head_sha must be a 7-40 char hex sha, got ${JSON.stringify(run.head_sha)}`);
  }
  if (
    typeof run.recorded_at !== "string" ||
    !Number.isFinite(new Date(run.recorded_at).getTime())
  ) {
    errors.push(`${label}.recorded_at must be a parseable ISO timestamp`);
  }
}

/** Lint the COMPLETE per-ticket TDD obligation at reviewer-gate time.
 *  Empty array = satisfiable. Pure: no fs, no git, no command execution —
 *  anti-sloppiness, not anti-forgery (evidence is model-written; fabrication
 *  is the reviewer's cross-check against the diff). Unknown extra fields are
 *  tolerated (evidence rides through tickets.json as an opaque object). */
export function lintTddEvidence(raw: unknown): string[] {
  if (!raw || typeof raw !== "object") {
    return ["evidence.tdd is missing — record red/green runs or waive with a reason"];
  }
  const obj = raw as Record<string, unknown>;
  const errors: string[] = [];

  if ("waived" in obj && obj.waived !== undefined) {
    const w = obj.waived;
    if (
      w &&
      typeof w === "object" &&
      typeof (w as Record<string, unknown>).reason === "string" &&
      ((w as Record<string, unknown>).reason as string).trim()
    ) {
      // Valid waiver satisfies the whole obligation — red/green ignored.
      return [];
    }
    errors.push("waived.reason must be a non-empty string");
  }

  const red = obj.red;
  if (!red || typeof red !== "object") {
    errors.push("red run is missing — record the failing run before the change");
  } else {
    lintTddRun(red as Record<string, unknown>, "red", errors);
    const rf = (red as Record<string, unknown>).expected_failure;
    if (typeof rf !== "string" || !rf.trim()) {
      errors.push("red.expected_failure must be a non-empty one-liner (why it fails pre-change)");
    }
  }

  const green = obj.green;
  if (!green || typeof green !== "object") {
    errors.push("green run is missing — record the passing run after the change");
  } else {
    lintTddRun(green as Record<string, unknown>, "green", errors);
  }

  // Ordering by recorded_at (NOT sha ancestry: both runs normally share an
  // uncommitted HEAD in the worktree flow, ancestry is meaningless there).
  if (red && typeof red === "object" && green && typeof green === "object") {
    const rt = new Date(String((red as Record<string, unknown>).recorded_at)).getTime();
    const gt = new Date(String((green as Record<string, unknown>).recorded_at)).getTime();
    if (Number.isFinite(rt) && Number.isFinite(gt) && rt > gt) {
      errors.push("red must be recorded before green");
    }
  }

  return errors;
}

/** Read + lint the raw tickets file (before normalization). */
export function lintTicketsFile(directory: string, sessionId?: string): string[] {
  const path = ticketsPath(directory, sessionId);
  if (!existsSync(path)) return ["tickets.json not found"];
  try {
    return lintTicketsRaw(JSON.parse(readFileSync(path, "utf-8")));
  } catch {
    return ["tickets.json is not valid JSON"];
  }
}

export function readTickets(
  directory: string,
  sessionId?: string,
): NikoflowTicketsFile | null {
  const path = ticketsPath(directory, sessionId);
  if (!existsSync(path)) return null;
  try {
    return normalizeTicketsFile(JSON.parse(readFileSync(path, "utf-8")));
  } catch {
    return null;
  }
}

export function writeTickets(
  directory: string,
  file: NikoflowTicketsFile,
  sessionId?: string,
): boolean {
  const path = ticketsPath(directory, sessionId);
  try {
    if (sessionId) {
      ensureSessionStateDir(sessionId, directory);
    }
    // Atomic write (temp + rename) so a hook killed mid-write can't leave a torn
    // tickets.json that fails the next lint/DAG gate (Fable QA R5).
    atomicWriteJsonSync(path, file);
    return true;
  } catch {
    return false;
  }
}

export function clearTickets(directory: string, sessionId?: string): boolean {
  const path = ticketsPath(directory, sessionId);
  if (!existsSync(path)) return true;
  try {
    unlinkSync(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate the ticket dependency graph: every blocked_by id must exist, ids must
 * be unique, and there must be no dependency cycle. Returns all problems found.
 */
export function validateTicketDag(file: NikoflowTicketsFile): DagValidation {
  const errors: string[] = [];
  const ids = new Set<string>();
  const dup = new Set<string>();
  for (const t of file.tickets) {
    if (ids.has(t.id)) dup.add(t.id);
    ids.add(t.id);
  }
  for (const d of dup) errors.push(`duplicate ticket id: ${d}`);

  if (file.tickets.length === 0) {
    errors.push("no tickets defined");
  }

  const byId = new Map(file.tickets.map((t) => [t.id, t]));
  for (const t of file.tickets) {
    for (const dep of t.blocked_by) {
      if (dep === t.id) errors.push(`${t.id} is blocked by itself`);
      else if (!byId.has(dep)) errors.push(`${t.id} blocked_by unknown ticket: ${dep}`);
    }
  }

  // Cycle detection via DFS (white/grey/black colouring).
  const colour = new Map<string, 0 | 1 | 2>(); // 0=unseen,1=in-stack,2=done
  const cyclePath: string[] = [];
  let cycleFound: string | null = null;

  const visit = (id: string): void => {
    if (cycleFound) return;
    colour.set(id, 1);
    cyclePath.push(id);
    const node = byId.get(id);
    for (const dep of node?.blocked_by ?? []) {
      if (dep === id) continue; // self-block already reported above
      if (!byId.has(dep)) continue; // dangling handled above
      const c = colour.get(dep) ?? 0;
      if (c === 1) {
        cycleFound = dep;
        break;
      }
      if (c === 0) visit(dep);
      if (cycleFound) break;
    }
    if (!cycleFound) {
      colour.set(id, 2);
      cyclePath.pop();
    }
  };

  for (const t of file.tickets) {
    if ((colour.get(t.id) ?? 0) === 0) visit(t.id);
    if (cycleFound) break;
  }
  if (cycleFound) {
    const start = cyclePath.indexOf(cycleFound);
    const loop = [...cyclePath.slice(start), cycleFound].join(" → ");
    errors.push(`dependency cycle: ${loop}`);
  }

  return { ok: errors.length === 0, errors };
}

/** Coverage inputs recorded at the PRD/ADR gates. Undefined dimension = untracked (legacy) → skipped. */
export interface NikoflowCoverage {
  story_ids?: string[];
  decision_ids?: string[];
}

/**
 * PRD/ADR coverage: every recorded story/decision id must be claimed by ≥1
 * ticket, and every id a ticket claims must have been recorded at its gate.
 * A dimension left undefined (legacy state, tactical tier, attr omitted)
 * contributes nothing — the gate behaves exactly as before. Ids are compared
 * verbatim (they were user-confirmed as written).
 */
export function validateTicketCoverage(
  file: NikoflowTicketsFile,
  cov: NikoflowCoverage,
): string[] {
  const errors: string[] = [];

  if (cov.story_ids !== undefined) {
    const claimed = new Map<string, string[]>(); // story id → ticket ids
    for (const t of file.tickets) {
      if (t.story_id) {
        claimed.set(t.story_id, [...(claimed.get(t.story_id) ?? []), t.id]);
      }
    }
    const recorded = new Set(cov.story_ids);
    for (const sid of recorded) {
      if (!claimed.has(sid)) errors.push(`PRD story ${sid} has no covering ticket`);
    }
    for (const [sid, tids] of claimed) {
      if (!recorded.has(sid)) {
        errors.push(`${tids.join(", ")} references unknown story id ${sid} (not recorded at the PRD gate)`);
      }
    }
  }

  if (cov.decision_ids !== undefined) {
    const claimed = new Map<string, string[]>(); // decision id → ticket ids
    for (const t of file.tickets) {
      for (const did of t.decision_ids ?? []) {
        claimed.set(did, [...(claimed.get(did) ?? []), t.id]);
      }
    }
    const recorded = new Set(cov.decision_ids);
    for (const did of recorded) {
      if (!claimed.has(did)) errors.push(`ADR decision ${did} has no covering ticket`);
    }
    for (const [did, tids] of claimed) {
      if (!recorded.has(did)) {
        errors.push(`${tids.join(", ")} references unknown decision id ${did} (not recorded at the ADR gate)`);
      }
    }
  }

  return errors;
}

/**
 * The next ticket to work: the first (document-order) ticket that is not done
 * and whose every blocker is done. Returns null when all are done or all
 * remaining are blocked.
 */
export function getNextTicket(
  file: NikoflowTicketsFile,
): NikoflowTicket | null {
  const byId = new Map(file.tickets.map((t) => [t.id, t]));
  for (const t of file.tickets) {
    if (t.status === "done") continue;
    const blockersDone = t.blocked_by.every(
      (d) => byId.get(d)?.status === "done",
    );
    if (blockersDone) return t;
  }
  return null;
}

export function allTicketsDone(file: NikoflowTicketsFile): boolean {
  return file.tickets.length > 0 && file.tickets.every((t) => t.status === "done");
}

/**
 * Set a ticket's status (read-modify-write). Optionally merge evidence.
 * Returns false if the file or ticket is missing.
 */
export function markTicketStatus(
  directory: string,
  ticketId: string,
  status: TicketStatus,
  sessionId?: string,
  evidence?: Record<string, unknown>,
): boolean {
  const file = readTickets(directory, sessionId);
  if (!file) return false;
  const ticket = file.tickets.find((t) => t.id === ticketId);
  if (!ticket) return false;
  ticket.status = status;
  if (evidence) {
    ticket.evidence = { ...(ticket.evidence ?? {}), ...evidence };
  }
  return writeTickets(directory, file, sessionId);
}

/**
 * Execute-phase health: is the ticket graph currently deadlocked — i.e. not all
 * done, yet no ticket is startable (every remaining ticket is blocked). This is
 * distinct from "all done" and must be surfaced as an error, not completion.
 */
export function isTicketDeadlock(file: NikoflowTicketsFile): boolean {
  return !allTicketsDone(file) && getNextTicket(file) === null;
}
