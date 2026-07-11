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

  it("completes the ticket once the reviewed commit is an ancestor of HEAD", () => {
    const sha = makeWorktreeCommit();
    const file = readTickets(dir, SID)!;
    file.tickets[0].evidence = { reviewed_sha: sha, tdd: VALID_TDD };
    writeTickets(dir, file, SID);

    sh(ticketWorktreeMergeCmd(dir, "TSK-001", RUN));
    expect(git(dir, "merge-base", "--is-ancestor", sha, "HEAD")).toBe("");

    const res = handleNikoflowExecute(dir, SID, baseState(dir));
    expect(readTickets(dir, SID)!.tickets[0].status).toBe("done");
    // Single ticket done → phase advances out of execute.
    expect(res.shouldBlock).toBe(true);
    expect(res.message).not.toContain("NOT MERGED");
  });

  it("hard-aborts (deactivates) instead of wedging forever once stall reaches the abort cap", () => {
    const sha = makeWorktreeCommit();
    const file = readTickets(dir, SID)!;
    file.tickets[0].evidence = { reviewed_sha: sha };
    writeTickets(dir, file, SID);
    // Simulate a run that already burned the abort budget on this ticket.
    const st = baseState(dir);
    st.execute_stall = 29;
    st.execute_stall_ticket = "TSK-001";
    writeNikoflowState(dir, st, SID);

    const res = handleNikoflowExecute(dir, SID, st);
    expect(res.shouldBlock).toBe(true);
    expect(res.message).toContain("NIKOFLOW ABORTED");
    // The loop must be inactive so the NEXT Stop passes through.
    const after = JSON.parse(
      execFileSync("cat", [join(dir, ".omc", "state", "sessions", SID, "nikoflow-state.json")], { encoding: "utf-8" }),
    ) as { active: boolean };
    expect(after.active).toBe(false);
  });

  it("rejects a forged review+valid-ancestor sha when the hook's review mark is absent", () => {
    // Forger writes status:"review" with reviewed_sha pointing at an EXISTING
    // ancestor (HEAD itself) plus valid tdd — ancestry passes, but the state's
    // hook-owned review_marks has no entry for this ticket.
    const headSha = git(dir, "rev-parse", "HEAD");
    const file = readTickets(dir, SID)!;
    file.tickets[0].evidence = { reviewed_sha: headSha, tdd: VALID_TDD };
    writeTickets(dir, file, SID);
    const st = baseState(dir);
    st.review_marks = {}; // initialized (non-legacy) state, no mark recorded
    writeNikoflowState(dir, st, SID);

    const res = handleNikoflowExecute(dir, SID, st);
    expect(readTickets(dir, SID)!.tickets[0].status).toBe("review"); // not completed
    expect(res.shouldBlock).toBe(true);
    expect(res.message).toContain("review record");
  });

  it("completes a review ticket whose sha matches the hook's review mark", () => {
    const sha = makeWorktreeCommit();
    const file = readTickets(dir, SID)!;
    file.tickets[0].evidence = { reviewed_sha: sha, tdd: VALID_TDD };
    writeTickets(dir, file, SID);
    sh(ticketWorktreeMergeCmd(dir, "TSK-001", RUN));
    const st = baseState(dir);
    st.review_marks = { "TSK-001": sha };
    writeNikoflowState(dir, st, SID);

    handleNikoflowExecute(dir, SID, st);
    expect(readTickets(dir, SID)!.tickets[0].status).toBe("done");
  });

  it("rejects a review status without reviewed_sha (hand-forged status must not auto-complete)", () => {
    // The hook only ever writes status "review" together with reviewed_sha, so
    // review-without-sha is externally written. The old fail-open here was the
    // cheapest full-gate bypass: forge status:"review" → done with no reviewer,
    // no verdict, no TDD evidence (workflow verify pass).
    const res = handleNikoflowExecute(dir, SID, baseState(dir));
    expect(readTickets(dir, SID)!.tickets[0].status).toBe("review"); // unchanged
    expect(res.shouldBlock).toBe(true);
    expect(res.message).toContain("reviewed_sha");
    expect(res.message).not.toContain("NOT MERGED");
  });

  it("blocks a merged review ticket whose evidence.tdd is missing (post-approval evidence wipe)", () => {
    const sha = makeWorktreeCommit();
    const file = readTickets(dir, SID)!;
    file.tickets[0].evidence = { reviewed_sha: sha }; // no tdd
    writeTickets(dir, file, SID);
    sh(ticketWorktreeMergeCmd(dir, "TSK-001", RUN));

    const res = handleNikoflowExecute(dir, SID, baseState(dir));
    expect(readTickets(dir, SID)!.tickets[0].status).toBe("review");
    expect(res.shouldBlock).toBe(true);
    expect(res.message).toContain("evidence.tdd");
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
