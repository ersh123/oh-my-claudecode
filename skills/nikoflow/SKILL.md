---
name: nikoflow
description: Phase-gated Niko Flow v2.1 methodology loop (Grilling → ADR → PRD → Ticketization → TDD → Verification) with Tactical/Standard/Deep depth tiers and hard quality gates
argument-hint: "[nikoflow:tactical|standard|deep] [--auto|--approval-gated] [--exec=sonnet] [--qa=fable|codex] [--panel=fable+gpt-5.5] <task description>"
level: 4
---

[NIKOFLOW — Niko Flow v2.1 — ITERATION {{ITERATION}}]

Your previous attempt did not complete the active phase's gate. Continue driving the methodology.

<Purpose>
Nikoflow is an enforced, phase-gated persistence loop for non-trivial work. Unlike ralph
("keep going until done"), nikoflow enforces a *sequence of quality gates*: each phase must
pass a hard checkpoint before the next begins. It is the sibling of ralph — same Stop-hook
persistence — plus an explicit methodology dimension.
</Purpose>

<Use_When>
- A change is non-trivial and deserves discipline (new feature, refactor, architectural change).
- The user says "nikoflow" / "niko flow" / "никофлоу" / "нико флоу", or asks for the full grilling → PRD → tickets → TDD → verify cycle.
- You want gates that block premature "done" claims: shared-understanding, seam-confirmed PRD,
  approved ticket breakdown, red-before-green TDD, and independent-reviewer verification.
</Use_When>

<Depth_Tiers>
Pick the smallest tier that fits; if not given explicitly (`nikoflow:deep`), propose one during
Grilling and confirm with the user.
- 🟢 Tactical (1-file bugfix): Grilling → Execute → Verification.
- 🟡 Standard (new feature): Grilling → ADR → PRD → Ticketization → TDD → Verification (no PBT).
- 🔴 Deep (architectural change): full cycle + property-based tests + evidence artifacts.
</Depth_Tiers>

<Phases>
1. 🔥 Grilling — one question at a time; interrogate why, why this way, alternatives, risks, depth.
   If a question can be answered by reading the code, read instead of asking. Before shared
   understanding is recorded, write an acceptance contract: 3-5 observable pass/fail criteria plus one
   primary signal (user-visible behavior/runtime output) and the secondary signals (tests/build/lint) —
   no edits before it exists. GATE: user confirms shared understanding before any code.
2. 📋 ADR — record an architecture decision ONLY when it is hard-to-reverse AND surprising-without-context
   AND the result of a real trade-off (all three). Otherwise record a skip. 2+ options + rationale + consequences.
3. 📄 PRD — "[Actor] can [capability]", no implementation detail. User Stories with Given/When/Then
   acceptance criteria. Sketch the test seams (prefer the highest, fewest seams) and GATE on user confirmation.
4. 🎫 Ticketization — split the PRD into atomic vertical-slice tickets (TSK-001…) that each cut through
   all layers and are demoable on their own, with acceptance criteria + blocked-by dependencies +
   a self-verification step. GATE: iterate until the user approves the breakdown.
5. 🔴🟢♻️ TDD — test only at pre-agreed seams; RED before GREEN (a failing test first, then the minimum
   code to pass); one vertical slice at a time. Refactoring belongs to the review step, not the loop.
   Deep tier: add property-based tests (invariants/round-trips/metamorphic) per ticket touching pure logic.
   BASE RULE — delegate + isolate (convention, prompt-enforced — the Stop hook does not run git, so the
   flow depends on you following it): the main thread ORCHESTRATES, it does NOT write code. Each ticket's
   code is written by an executor subagent (on the executor model, e.g. sonnet or gpt-5.5) inside a
   DEDICATED worktree (`.omc/worktrees/<ticket>`); keep edits inside that worktree so the diff is held
   off the branch until the reviewer/QA gate approves it — only then merge the worktree into the branch.
   Keeps the main context clean and unreviewed code off the branch. Per ticket, machine-checkable
   TDD evidence (`evidence.tdd`: red/green runs or a waiver) is recorded in tickets.json and gate-checked.
   Change-surface: a slice touching a contract/schema/route/query must check producers, consumers, and
   serializers on both sides; a one-file fix for a cross-layer bug is suspicious — fix the owning layer.
6. ✅ Verification — spawn a fresh, context-isolated independent reviewer; iterate fix → re-review until
   local validation (tests/lint/build) is green AND the reviewer scores the changed surface ≥ 9.5/10 or
   reports no actionable findings. Never accept a passing score while validation is red.
   Completion report: state primary signal status (met/not met/partial) and secondary signal status
   (exact checks run and results). Not done if the symptom is gone but the same mechanic stays
   inconsistent across directly coupled layers.
</Phases>

<Gates_and_tags>
Each phase advances only when the Stop hook sees the exact gate tag it is waiting for, carrying
the `request-id` that the phase prompt gives you. Emit each tag on its own line.

- Depth (during Grilling): `<nikoflow-gate phase="depth" depth="tactical|standard|deep" request-id="…">CONFIRMED</nikoflow-gate>`
- Interview: `<nikoflow-gate phase="interview" request-id="…">CONFIRMED</nikoflow-gate>`
- ADR: `<nikoflow-gate phase="adr" decision="docs/adr/NNNN-slug.md" decision-ids="ADR-NNNN" request-id="…">RECORDED</nikoflow-gate>` or `<nikoflow-gate phase="adr" skip="reason" request-id="…">SKIPPED</nikoflow-gate>` — each id in `decision-ids` must later be carried by ≥1 ticket's `decision_ids`.
- PRD: `<nikoflow-gate phase="prd" stories="ST-001,ST-002" request-id="…">SEAMS_CONFIRMED</nikoflow-gate>` — list every User Story id in `stories`; the Tickets gate enforces that each is covered by ≥1 ticket's `story_id`.
- Tickets: `<nikoflow-gate phase="tickets" request-id="…">APPROVED</nikoflow-gate>` — also requires a valid `tickets.json` (see below).
- Execute (per ticket): the reviewer emits BOTH a structured verdict and the gate — a bare gate does not count:
  `<nikoflow-verdict spec="pass" quality="approved">findings with file:line / none</nikoflow-verdict>` then
  `<nikoflow-gate phase="execute:TSK-NNN" request-id="…">TICKET_DONE</nikoflow-gate>`.
  Spec compliance and code quality are separate judgments; `spec="fail"` or `quality="needs_fixes"` rejects.
  After reviewer approval the ticket is `review`, NOT done — it completes only once the approved worktree
  commit is merged onto the branch (the Stop hook verifies ancestry with read-only git).
  TICKET_DONE is additionally accepted only when the ticket's `evidence.tdd` is complete:
  `red {command, exit_code≠0, expected_failure, head_sha, recorded_at}` recorded before
  `green {command, exit_code=0, head_sha, recorded_at}`, or `waived {reason}` for docs-only tickets.
  Shape/ordering is hook-checked; honesty is reviewer-checked (evidence is model-recorded —
  anti-sloppiness, not anti-forgery).
- Verify: the reviewer emits `<nikoflow-gate phase="verify" score="9.6" request-id="…">VERIFIED</nikoflow-gate>` (a real numeric `score` in 1–10, ≥ 9.5 to pass) or `<nikoflow-gate phase="verify" request-id="…">NO_ACTIONABLE_FINDINGS</nikoflow-gate>`. A VERIFIED without a valid numeric score is treated as a failed pass.

Anti-self-approval — the gates are enforced, not honour-system:
- Human gates (depth, interview, prd, tickets) are accepted only after a REAL user turn occurs
  after the gate was requested. You cannot self-confirm; a tag emitted before the user replies is
  invalidated (the request-id rotates).
- Execute and Verify gates are accepted ONLY from an independent reviewer subagent's (Task/Agent)
  tool_result — never from your own message text. Emitting these tags yourself does nothing.
- A tag carrying a stale/mismatched request-id is ignored. Tags shown inside these instructions or
  in code fences do not count.

tickets.json (session state) shape — the Tickets gate validates it (no cycles, no dangling
blocked_by, valid shape, and PRD/ADR coverage: every story/decision id recorded at those
gates needs ≥1 covering ticket, and tickets may not claim unrecorded ids) before APPROVED
is accepted:
```json
{ "version": 1, "tickets": [
  { "id": "TSK-001", "story_id": "ST-001", "decision_ids": [], "title": "…",
    "acceptance": ["…"], "blocked_by": [], "self_verify": "…",
    "pbt_required": false, "status": "todo",
    "evidence": { "tdd": {
      "red":   { "command": "npx vitest run x.test.ts", "exit_code": 1,
                 "expected_failure": "parser lacks empty-input branch",
                 "head_sha": "abc1234", "recorded_at": "2026-07-10T10:00:00Z" },
      "green": { "command": "npx vitest run x.test.ts", "exit_code": 0,
                 "head_sha": "abc1234", "recorded_at": "2026-07-10T10:05:00Z" }
    } } }
] }
```
Verify convergence caps at 6 failed reviewer passes, then escalates to the user (a genuine
reviewer pass ≥ 9.5 still completes at any time).
</Gates_and_tags>

<Role_Model_Routing>
Each role can run on a different model; the reviewer is ALWAYS spawned as a Task/Agent
subagent (native model) or a Codex-backed Task agent (GPT-5.5 xhigh) — never a raw shell
command, so the gate detector accepts it. Defaults:
- Executor (writes code): sonnet
- Architect (ADR) + Reviewer (execute gate) + Verifier (verify gate): fable (advisory fallback: opus — prompted, not auto-enforced)
- Grilling panel (divergent opinions): fable + gpt-5.5

Override at activation: `--exec=sonnet`, `--architect=fable`, `--qa=codex` (sets reviewer+verifier),
`--reviewer=…`, `--verifier=…`, `--panel=fable+gpt-5.5`. `gpt-5.5`/`codex` route through a
Codex-backed Task agent (your Codex subscription). Example:
`nikoflow:deep --exec=sonnet --qa=codex build the parser`
</Role_Model_Routing>

<Completion>
When the task is FULLY complete and the Verification gate has passed, run
`/oh-my-claudecode:cancel` to cleanly exit and clean up state. If cancel fails, retry with
`/oh-my-claudecode:cancel --force`.
</Completion>
