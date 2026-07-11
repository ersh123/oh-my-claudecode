/**
 * Nikoflow per-ticket worktree isolation.
 *
 * Execute-phase code is written by an EXECUTOR SUBAGENT in a dedicated git
 * worktree, never in the main thread's tree — so (a) the main thread's context
 * stays clean (it only orchestrates), and (b) a ticket's diff is quarantined
 * until the reviewer/QA gate approves it, then merged into the branch. Rejected
 * work stays in the worktree to iterate; it never lands on the branch unreviewed.
 *
 * Paths and branches are scoped by the flow's immutable run_id: ticket ids
 * restart at TSK-001 every run, so without the scope two runs in one repo (or a
 * cancel+restart) would silently share `.omc/worktrees/TSK-001` and could adopt
 * each other's stale diffs (audit F-03). A missing runId falls back to the
 * legacy unscoped names so pre-run_id state keeps working.
 *
 * These are pure path/command helpers. The actual git operations run as shell
 * commands (executed by the model / a subagent), so the Stop hook never mutates
 * git itself — it only tells the model where the worktree is and what to run.
 */

import { join } from "path";

function safeSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, "_");
}

function scopedName(ticketId: string, runId?: string): string {
  const ticket = safeSegment(ticketId);
  return runId ? `${safeSegment(runId)}-${ticket}` : ticket;
}

/** Relative location (under the repo) for a ticket's isolated worktree. */
export function ticketWorktreeRelPath(ticketId: string, runId?: string): string {
  return join(".omc", "worktrees", scopedName(ticketId, runId));
}

/** Absolute worktree path for a ticket. */
export function ticketWorktreePath(
  directory: string,
  ticketId: string,
  runId?: string,
): string {
  return join(directory, ticketWorktreeRelPath(ticketId, runId));
}

/** Branch name a ticket's worktree checks out. */
export function ticketWorktreeBranch(ticketId: string, runId?: string): string {
  const ticket = ticketId.replace(/[^A-Za-z0-9_/-]/g, "-");
  return runId
    ? `nikoflow/${safeSegment(runId)}/${ticket}`
    : `nikoflow/${ticket}`;
}

/** Single-quote a value for safe shell interpolation (handles embedded quotes). */
function shq(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

/**
 * Shell to create the ticket worktree. Prunes stale metadata first, reuses the
 * ticket branch if it already exists (preserves WIP — retry-safe), and only
 * creates a fresh branch off HEAD when there is none. No -B (which would discard
 * committed WIP on a retry).
 */
export function ticketWorktreeCreateCmd(
  directory: string,
  ticketId: string,
  runId?: string,
): string {
  const path = ticketWorktreeRelPath(ticketId, runId);
  const branch = ticketWorktreeBranch(ticketId, runId);
  const d = shq(directory);
  const p = shq(path);
  return (
    `git -C ${d} worktree prune; ` +
    `if [ -d ${shq(join(directory, path))} ]; then :; ` +
    `elif git -C ${d} show-ref --verify --quiet refs/heads/${branch}; then git -C ${d} worktree add -q ${p} ${branch}; ` +
    `else git -C ${d} worktree add -q -b ${branch} ${p} HEAD; fi`
  );
}

/**
 * Shell to merge an APPROVED ticket worktree into the current branch. Commits WIP
 * only when there is something to commit (a commit *failure* — gpg/hooks/identity
 * — breaks the chain and is NOT swallowed), merges --no-ff, and removes the
 * worktree WITHOUT --force so a still-dirty tree refuses removal rather than
 * silently destroying an unmerged diff (audit F1). Deletes the merged branch.
 */
export function ticketWorktreeMergeCmd(
  directory: string,
  ticketId: string,
  runId?: string,
): string {
  const path = ticketWorktreeRelPath(ticketId, runId);
  const branch = ticketWorktreeBranch(ticketId, runId);
  const d = shq(directory);
  const w = shq(join(directory, path));
  const p = shq(path);
  const msg = shq(`nikoflow: ${branch}`);
  return (
    `git -C ${w} add -A && ` +
    `{ git -C ${w} diff --cached --quiet || git -C ${w} commit -q -m ${msg}; } && ` +
    `git -C ${d} merge --no-ff -q ${branch} -m ${msg} && ` +
    `[ -z "$(git -C ${w} status --porcelain)" ] && ` +
    `git -C ${d} worktree remove ${p} && ` +
    `git -C ${d} branch -d ${branch}`
  );
}

/** Shell to discard a ticket worktree (on cancel / abandon). */
export function ticketWorktreeRemoveCmd(
  directory: string,
  ticketId: string,
  runId?: string,
): string {
  const path = ticketWorktreeRelPath(ticketId, runId);
  const branch = ticketWorktreeBranch(ticketId, runId);
  const d = shq(directory);
  return (
    `git -C ${d} worktree remove --force ${shq(path)} 2>/dev/null; ` +
    `git -C ${d} branch -D ${branch} 2>/dev/null; git -C ${d} worktree prune; true`
  );
}
