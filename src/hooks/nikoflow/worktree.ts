/**
 * Nikoflow per-ticket worktree isolation.
 *
 * Execute-phase code is written by an EXECUTOR SUBAGENT in a dedicated git
 * worktree, never in the main thread's tree — so (a) the main thread's context
 * stays clean (it only orchestrates), and (b) a ticket's diff is quarantined
 * until the reviewer/QA gate approves it, then merged into the branch. Rejected
 * work stays in the worktree to iterate; it never lands on the branch unreviewed.
 *
 * These are pure path/command helpers. The actual git operations run as shell
 * commands (executed by the model / a subagent), so the Stop hook never mutates
 * git itself — it only tells the model where the worktree is and what to run.
 */

import { join } from "path";

/** Relative location (under the repo) for a ticket's isolated worktree. */
export function ticketWorktreeRelPath(ticketId: string): string {
  const safe = ticketId.replace(/[^A-Za-z0-9_-]/g, "_");
  return join(".omc", "worktrees", safe);
}

/** Absolute worktree path for a ticket. */
export function ticketWorktreePath(directory: string, ticketId: string): string {
  return join(directory, ticketWorktreeRelPath(ticketId));
}

/** Branch name a ticket's worktree checks out. */
export function ticketWorktreeBranch(ticketId: string): string {
  const safe = ticketId.replace(/[^A-Za-z0-9_/-]/g, "-");
  return `nikoflow/${safe}`;
}

/** Shell to create the ticket worktree off the current HEAD (idempotent-ish). */
export function ticketWorktreeCreateCmd(directory: string, ticketId: string): string {
  const path = ticketWorktreeRelPath(ticketId);
  const branch = ticketWorktreeBranch(ticketId);
  // -B resets the branch to HEAD if it already exists; harmless on a fresh ticket.
  return `git -C "${directory}" worktree add -q -B ${branch} "${path}" HEAD 2>/dev/null || git -C "${directory}" worktree add -q "${path}" ${branch}`;
}

/** Shell to merge an APPROVED ticket worktree's branch into the current branch. */
export function ticketWorktreeMergeCmd(directory: string, ticketId: string): string {
  const branch = ticketWorktreeBranch(ticketId);
  // Commit any WIP in the worktree first, then merge its branch (no-ff so the
  // ticket is a visible unit), then remove the worktree.
  const path = ticketWorktreeRelPath(ticketId);
  return (
    `git -C "${join(directory, path)}" add -A && ` +
    `git -C "${join(directory, path)}" commit -q -m "nikoflow ${ticketId}" 2>/dev/null; ` +
    `git -C "${directory}" merge --no-ff -q ${branch} -m "nikoflow: merge ${ticketId}" && ` +
    `git -C "${directory}" worktree remove --force "${path}"`
  );
}

/** Shell to discard a ticket worktree (on cancel / abandon). */
export function ticketWorktreeRemoveCmd(directory: string, ticketId: string): string {
  const path = ticketWorktreeRelPath(ticketId);
  const branch = ticketWorktreeBranch(ticketId);
  return (
    `git -C "${directory}" worktree remove --force "${path}" 2>/dev/null; ` +
    `git -C "${directory}" branch -D ${branch} 2>/dev/null || true`
  );
}
