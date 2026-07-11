/**
 * Merge gate: reviewer approval alone must not complete a ticket — the
 * approved worktree commit has to actually land on the branch (be an ancestor
 * of HEAD) before status moves review → done (audit F-03). Real-git tests.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleNikoflowExecute } from "../../persistent-mode/index.js";
import { writeNikoflowState, type NikoflowState } from "../loop.js";
import { writeTickets, readTickets } from "../tickets.js";
import {
  ticketWorktreeRelPath,
  ticketWorktreeBranch,
  ticketWorktreeCreateCmd,
  ticketWorktreeMergeCmd,
} from "../worktree.js";

const SID = "merge-gate-session";
const RUN = "cafe0123";

function git(dir: string, ...args: string[]): string {
  return execFileSync("git", ["-C", dir, ...args], { encoding: "utf-8" }).trim();
}

function sh(cmd: string): void {
  execFileSync("sh", ["-c", cmd], { stdio: "ignore" });
}

function baseState(dir: string): NikoflowState {
  return {
    active: true,
    run_id: RUN,
    iteration: 1,
    started_at: new Date().toISOString(),
    prompt: "task",
    session_id: SID,
    project_path: dir,
    depth: "standard",
    phases: ["interview", "adr", "prd", "tickets", "execute", "verify"],
    phase_index: 4, // execute
  };
}

describe("nikoflow review→merged→done gate (real git)", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "nikoflow-merge-gate-"));
    git(dir, "init", "-q");
    git(dir, "config", "user.email", "t@t");
    git(dir, "config", "user.name", "t");
    writeFileSync(join(dir, "base.txt"), "base\n");
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", "base");
    writeNikoflowState(dir, baseState(dir), SID);
    writeTickets(
      dir,
      {
        version: 1,
        tickets: [
          {
            id: "TSK-001",
            title: "one",
            acceptance: ["a"],
            blocked_by: [],
            status: "review",
            evidence: {},
          },
        ],
      },
      SID,
    );
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function makeWorktreeCommit(): string {
    sh(ticketWorktreeCreateCmd(dir, "TSK-001", RUN));
    const wt = join(dir, ticketWorktreeRelPath("TSK-001", RUN));
    writeFileSync(join(wt, "feature.txt"), "feature\n");
    git(wt, "add", "-A");
    git(wt, "commit", "-q", "-m", "feature");
    return git(dir, "rev-parse", `refs/heads/${ticketWorktreeBranch("TSK-001", RUN)}`);
  }

  it("blocks a reviewer-approved ticket whose commit is NOT on the branch", () => {
    const sha = makeWorktreeCommit();
    const file = readTickets(dir, SID)!;
    file.tickets[0].evidence = { reviewed_sha: sha };
    writeTickets(dir, file, SID);

    const res = handleNikoflowExecute(dir, SID, baseState(dir));
    expect(res.shouldBlock).toBe(true);
    expect(res.message).toContain("NOT MERGED");
    expect(res.message).toContain(sha.slice(0, 10));
    // Status must stay "review" — not silently completed.
    expect(readTickets(dir, SID)!.tickets[0].status).toBe("review");
  });

  it("completes the ticket once the reviewed commit is an ancestor of HEAD", () => {
    const sha = makeWorktreeCommit();
    const file = readTickets(dir, SID)!;
    file.tickets[0].evidence = { reviewed_sha: sha };
    writeTickets(dir, file, SID);

    sh(ticketWorktreeMergeCmd(dir, "TSK-001", RUN));
    expect(git(dir, "merge-base", "--is-ancestor", sha, "HEAD")).toBe("");

    const res = handleNikoflowExecute(dir, SID, baseState(dir));
    expect(readTickets(dir, SID)!.tickets[0].status).toBe("done");
    // Single ticket done → phase advances out of execute.
    expect(res.shouldBlock).toBe(true);
    expect(res.message).not.toContain("NOT MERGED");
  });

  it("legacy review state without reviewed_sha completes (fail-open, no false lock)", () => {
    const res = handleNikoflowExecute(dir, SID, baseState(dir));
    expect(readTickets(dir, SID)!.tickets[0].status).toBe("done");
    expect(res.shouldBlock).toBe(true);
  });
});

describe("worktree run-id scoping", () => {
  it("two runs never share a path or branch for the same ticket id", () => {
    expect(ticketWorktreeRelPath("TSK-001", "run1")).not.toBe(
      ticketWorktreeRelPath("TSK-001", "run2"),
    );
    expect(ticketWorktreeBranch("TSK-001", "run1")).not.toBe(
      ticketWorktreeBranch("TSK-001", "run2"),
    );
  });

  it("falls back to legacy unscoped names without a runId", () => {
    expect(ticketWorktreeRelPath("TSK-001")).toBe(join(".omc", "worktrees", "TSK-001"));
    expect(ticketWorktreeBranch("TSK-001")).toBe("nikoflow/TSK-001");
  });
});
