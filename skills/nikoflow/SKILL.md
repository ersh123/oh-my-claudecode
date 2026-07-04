---
name: nikoflow
description: Phase-gated Niko Flow v2.1 methodology loop (Grilling → ADR → PRD → Ticketization → TDD → Verification) with Tactical/Standard/Deep depth tiers and hard quality gates
argument-hint: "[nikoflow:tactical|standard|deep] <task description>"
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
- The user says "nikoflow" / "никофлоу", or asks for the full grilling → PRD → tickets → TDD → verify cycle.
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
   If a question can be answered by reading the code, read instead of asking. GATE: user confirms
   shared understanding before any code.
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
6. ✅ Verification — spawn a fresh, context-isolated independent reviewer; iterate fix → re-review until
   local validation (tests/lint/build) is green AND the reviewer scores the changed surface ≥ 9.5/10 or
   reports no actionable findings. Never accept a passing score while validation is red.
</Phases>

<Completion>
When the task is FULLY complete and the Verification gate has passed, run
`/oh-my-claudecode:cancel` to cleanly exit and clean up state. If cancel fails, retry with
`/oh-my-claudecode:cancel --force`.
</Completion>
