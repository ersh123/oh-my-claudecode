/**
 * Nikoflow phase prompts.
 *
 * Each phase emits a continuation prompt that (a) tells the model what the
 * current gate requires and (b) names the exact tag/artifact the Stop hook
 * will look for to advance. Tag formats here MUST match the detectors the
 * gate logic enforces (TSK-003+), so the prose and the machine agree.
 */

import { isCodexRoleSpec, NIKOFLOW_MODEL_FALLBACK } from "./loop.js";
import {
  ticketWorktreeRelPath,
  ticketWorktreeCreateCmd,
  ticketWorktreeMergeCmd,
} from "./worktree.js";
import type { NikoflowState } from "./loop.js";
import type { PbtObligation } from "./pbt.js";

/**
 * Render a "spawn this reviewer as a Task subagent" instruction for a model
 * spec. Native models run as a Task on that model; a codex/gpt-5.5 spec routes
 * through a Codex-backed Task agent — so the reviewer is ALWAYS a Task subagent
 * the gate detector accepts (never a raw shell command).
 */
export function renderReviewerSpawn(spec: string): string {
  if (isCodexRoleSpec(spec)) {
    return (
      `a Codex-backed reviewer Task subagent (GPT-5.5 xhigh) — e.g. ` +
      `Task(subagent_type="codex:codex-rescue") given a REVIEW task. Run it FOREGROUND ` +
      `(--wait; NEVER --background — a backgrounded run returns a job id, not the verdict, ` +
      `and the gate would stall). The reviewer must emit the gate tag as a plain line, not inside a code block`
    );
  }
  const fb = NIKOFLOW_MODEL_FALLBACK[spec];
  const fbNote = fb ? ` (if ${spec} is unavailable, use ${fb})` : "";
  return `a fresh reviewer Task subagent on model "${spec}"${fbNote} — e.g. Task(subagent_type="code-reviewer", model="${spec}")`;
}

/** Render the grilling panel (divergent-opinion models) as Task subagents. */
export function renderPanel(panel: string[]): string {
  if (!panel || panel.length === 0) return "";
  const parts = panel.map((m) =>
    isCodexRoleSpec(m) ? "a Codex/GPT-5.5 xhigh Task subagent" : `a Task subagent on "${m}"`,
  );
  return parts.join(" and ");
}

const CANCEL_HINT =
  "When the whole task is FULLY complete and the Verification gate has passed, " +
  "run `/oh-my-claudecode:cancel` to exit. If cancel fails, retry with " +
  "`/oh-my-claudecode:cancel --force`.";

const AUTONOMY_MODE_PROTOCOL =
  "Autonomy mode: establish exactly one mode once, in Grilling/depth if it is not already explicit: " +
  "approval-gated (ask before each phase/step) or autonomous (run the full safe cycle without per-step approvals). " +
  "Default to autonomous when the user clearly asks for no handoffs (full cycle) or the task is already scoped. " +
  "Even in autonomous mode, stop for destructive, credential-gated, external-production, or materially branching actions.";

const MONEY_CRITICAL_PREFLIGHT =
  "Money/prod deploy preflight: before any execute/deploy action that can affect production, ad spend, accounts, " +
  "credentials, or proxy-dependent scraping, verify and report release base vs prod, prod divergence, money guards, " +
  "proxy/env, rollback path, and stop condition. Unknown/red item => STOP and report blockers; never continue on assumptions.";

/**
 * Inject the correlation request-id into every <nikoflow-gate ...> tag in a
 * prompt body so the model echoes an id the Stop hook will accept. Without a
 * matching request-id the gate is ignored, so this is required, not cosmetic.
 */
function injectRequestId(body: string, requestId?: string): string {
  if (!requestId) return body;
  return body.replace(
    /(<nikoflow-gate\b)([^>]*?)(>)/gi,
    (_full, open, attrs, close) => `${open}${attrs} request-id="${requestId}"${close}`,
  );
}

/**
 * Models routinely invent their own request-id instead of copying the minted
 * UUID (observed live 2026-07-06/10), which silently fails correlation and
 * loops the gate. A dedicated COPY-EXACTLY line makes the contract unmissable.
 */
function requestIdLine(requestId?: string): string {
  if (!requestId) return "";
  return `REQUIRED REQUEST-ID — COPY EXACTLY, do not invent your own: ${requestId}\n`;
}

/**
 * Prompt shown while no depth tier has been chosen yet. Depth selection is the
 * first act of Grilling — propose a tier with justification and confirm.
 */
export function getDepthSelectionPrompt(
  state: NikoflowState,
  requestId?: string,
): string {
  const gateTag = injectRequestId(
    `<nikoflow-gate phase="depth" depth="tactical|standard|deep" mode="approval-gated|autonomous">CONFIRMED</nikoflow-gate>`,
    requestId,
  );
  return (
    `<nikoflow-continuation phase="grilling:depth" iteration="${state.iteration}">\n` +
    `NIKOFLOW — depth not yet chosen. Begin Grilling by sizing the task:\n` +
    `- 🟢 tactical — a 1-file bug fix or trivially-scoped change (Grilling → Execute → Verification).\n` +
    `- 🟡 standard — a new feature (Grilling → ADR → PRD → Ticketization → TDD → Verification).\n` +
    `- 🔴 deep — an architectural change (full cycle + property-based tests + evidence).\n` +
    `Propose the smallest tier that fits, with a one-line justification, and confirm it with the user.\n` +
    `${AUTONOMY_MODE_PROTOCOL}\n` +
    `${MONEY_CRITICAL_PREFLIGHT}\n` +
    (state.roles?.panel && state.roles.panel.length > 1
      ? `For standard/deep work, consult a divergent-opinion panel — ${renderPanel(state.roles.panel)} — ` +
        `on approach/risks/alternatives BEFORE committing, and surface where they disagree.\n`
      : "") +
    `Once the user chooses depth + mode, record both by emitting on its own line:\n` +
    `${gateTag}\n` +
    requestIdLine(requestId) +
    `(the tag is only accepted after the user has actually replied — do not self-confirm).\n` +
    `${CANCEL_HINT}\n` +
    `</nikoflow-continuation>`
  );
}

const PHASE_BODIES: Record<string, string> = {
  interview:
    `Phase 🔥 GRILLING. Interrogate the task one question at a time: why, why this way, ` +
    `what alternatives, what risks. If a question can be answered by reading the code, read ` +
    `instead of asking. ${AUTONOMY_MODE_PROTOCOL} In approval-gated mode, or when there is ` +
    `a destructive/external-production/materially branching risk, do not write implementation until ` +
    `the user confirms shared understanding. In autonomous mode, write the shared understanding, ` +
    `state assumptions/evidence, emit the gate, and proceed. GATE — emit after user confirmation ` +
    `or autonomous shared-understanding is recorded:\n` +
    `<nikoflow-gate phase="interview" mode="approval-gated|autonomous">CONFIRMED</nikoflow-gate>`,
  adr:
    `Phase 📋 ADR. Record an architecture decision ONLY if it is hard-to-reverse AND ` +
    `surprising-without-context AND the result of a real trade-off (all three). Give 2+ ` +
    `options, rationale, consequences; write it to docs/adr/NNNN-slug.md. Otherwise record a ` +
    `skip with a reason. Trackable decision ids listed in decision-ids must each be carried by ` +
    `≥1 ticket later. GATE — emit one of:\n` +
    `<nikoflow-gate phase="adr" decision="docs/adr/NNNN-slug.md" decision-ids="ADR-NNNN">RECORDED</nikoflow-gate>\n` +
    `<nikoflow-gate phase="adr" skip="reason">SKIPPED</nikoflow-gate>`,
  prd:
    `Phase 📄 PRD. Write "[Actor] can [capability]" with User Stories carrying Given/When/Then ` +
    `acceptance criteria — no implementation detail. Sketch the test seams (prefer the highest, ` +
    `fewest seams). For money/prod/proxy work, include the preflight evidence as acceptance criteria. ` +
    `Confirm seams with the user only when approval-gated mode or material ambiguity requires it; ` +
    `otherwise record the seams and continue. Give each User Story a stable id (ST-001…) and list ` +
    `every id in the gate tag's stories attribute — the Tickets gate enforces that each is covered. ` +
    `GATE — emit after seams are confirmed or recorded:\n` +
    `<nikoflow-gate phase="prd" stories="ST-001,ST-002">SEAMS_CONFIRMED</nikoflow-gate>`,
  tickets:
    `Phase 🎫 TICKETIZATION. Split the PRD into atomic vertical-slice tickets (TSK-001…) that ` +
    `each cut through all layers and are demoable on their own, with acceptance criteria + ` +
    `blocked-by dependencies + a self-verification step. Add an explicit preflight ticket before any ` +
    `money/prod/proxy-impacting deploy or external side effect. Tag each ticket with the story_id it ` +
    `implements and decision_ids for any ADR decisions it lands — the gate blocks uncovered or unknown ids. ` +
    `Present the breakdown and iterate until ` +
    `the user approves it in approval-gated mode; in autonomous mode, write the artifact, validate the DAG, ` +
    `and continue unless risk is red. GATE — emit after approval or autonomous validation:\n` +
    `<nikoflow-gate phase="tickets">APPROVED</nikoflow-gate>`,
  execute:
    `Phase 🔴🟢♻️ EXECUTE (TDD). Work tickets in dependency order, one vertical slice at a time. ` +
    `The loop drives you ticket-by-ticket with a per-ticket prompt and an independent reviewer ` +
    `gate; the phase advances automatically once every ticket is reviewer-approved and done. ` +
    `${MONEY_CRITICAL_PREFLIGHT}`,
  verify:
    `Phase ✅ VERIFICATION. Spawn a fresh, context-isolated independent reviewer; iterate ` +
    `fix → re-review until local validation (tests/lint/build) is green AND the reviewer scores ` +
    `the changed surface ≥ 9.5/10 or reports no actionable findings. Never accept a passing ` +
    `score while validation is red. For money/prod/proxy work, the reviewer must reject missing or red preflight evidence. ` +
    `GATE — emit after the reviewer passes on green validation:\n` +
    `<nikoflow-gate phase="verify">VERIFIED</nikoflow-gate>`,
};

/**
 * Per-ticket execution prompt (Execute phase). Drives red→green→review for one
 * ticket and names the ticket-scoped gate the reviewer's approval must carry.
 */
export function getExecuteTicketPrompt(
  ticket: { id: string; title: string; acceptance: string[]; self_verify?: string; pbt_required?: boolean },
  state: NikoflowState,
  requestId?: string,
  pbt?: PbtObligation,
): string {
  const gate = `execute:${ticket.id}`;
  const gateTag = injectRequestId(
    `<nikoflow-gate phase="${gate}">TICKET_DONE</nikoflow-gate>`,
    requestId,
  );
  const ac = ticket.acceptance.length
    ? ticket.acceptance.map((c, i) => `  ${i + 1}. ${c}`).join("\n")
    : "  (none listed — derive from the PRD story)";
  // The ticket may explicitly mark whether it owes property tests; otherwise
  // fall back to the "touches pure logic" heuristic.
  const owes =
    ticket.pbt_required === true
      ? "This ticket owes property-based tests"
      : `If this ticket touches pure/parseable logic`;
  let pbtLine = "";
  let reviewerPbt = "";
  if (pbt?.required && pbt.status === "ready" && ticket.pbt_required !== false) {
    pbtLine =
      `\nDeep tier: ${owes}. After GREEN add ≥1 real property (invariant / round-trip / ` +
      `metamorphic — "no crash on random input" alone does not count) using ${pbt.framework}, before review.`;
    reviewerPbt =
      ` For this deep-tier ticket, also reject if pure/parseable logic changed without at least ` +
      `one real ${pbt.framework} property test.`;
  } else if (pbt?.required && pbt.status === "needs-lib" && ticket.pbt_required !== false) {
    pbtLine =
      `\nDeep tier: ${owes}, but ${pbt.framework} is not installed — ASK the user before adding it ` +
      `as a dev dependency; do not add it speculatively.`;
  } else if (pbt?.status === "waived" && pbt.reason !== "not deep tier") {
    pbtLine = `\nDeep tier: property-based tests waived (${pbt.reason}).`;
  }
  const dir = state.project_path ?? ".";
  const executor = state.roles?.executor ?? "sonnet";
  const wtRel = ticketWorktreeRelPath(ticket.id, state.run_id);
  const createCmd = ticketWorktreeCreateCmd(dir, ticket.id, state.run_id);
  const mergeCmd = ticketWorktreeMergeCmd(dir, ticket.id, state.run_id);
  const execIsCodex = isCodexRoleSpec(executor);
  const execSpawn = execIsCodex
    ? `a Codex-backed executor Task subagent (GPT-5.5 xhigh, foreground/--wait)`
    : `an executor Task subagent — Task(subagent_type="executor", model="${executor}")`;
  return (
    `<nikoflow-continuation phase="execute" ticket="${ticket.id}" iteration="${state.iteration}">\n` +
    `🔴🟢♻️ TDD on ticket ${ticket.id} — ${ticket.title}.\n` +
    `Acceptance criteria:\n${ac}\n` +
    `BASE RULE — DELEGATE + ISOLATE: you (this thread) ORCHESTRATE only; you do NOT write code ` +
    `(keep your context clean). The code is written by a subagent inside a DEDICATED worktree and is ` +
    `quarantined there until QA approves it — nothing lands on the branch unreviewed.\n` +
    `1. Create the ticket worktree once:\n   ${createCmd}\n` +
    `${MONEY_CRITICAL_PREFLIGHT}\n` +
    `2. Spawn ${execSpawn} whose working directory is "${wtRel}". It does RED→GREEN for this ONE ` +
    `vertical slice (a failing test at a pre-agreed seam → the minimum code to pass) INSIDE that ` +
    `worktree and returns a summary + the diff. Do NOT edit files in the main tree yourself.${pbtLine}\n` +
    (ticket.self_verify ? `Self-verify: ${ticket.self_verify}\n` : "") +
    `3. When the slice is green, spawn ${renderReviewerSpawn(state.roles?.reviewer ?? "fable")} — a ` +
    `FRESH reviewer that has NOT seen your reasoning — to review the worktree DIFF against the ` +
    `acceptance criteria and repo standards.${reviewerPbt} Tell it to REJECT if the change leaked ` +
    `outside the worktree (\`git -C "${dir}" status --porcelain\` shows ticket edits in the main tree). ` +
    `Pass it this request-id; it emits, in ITS OWN final output, TWO things ONLY if it approves on ` +
    `green validation — first its structured verdict (spec compliance and code quality are SEPARATE ` +
    `judgments; findings with file:line inside the block; use spec="fail" or quality="needs_fixes" ` +
    `to reject):\n` +
    `<nikoflow-verdict spec="pass" quality="approved">findings / none</nikoflow-verdict>\n` +
    `then the ticket gate on its own line (the gate does NOT count without the approving verdict):\n` +
    `${gateTag}\n` +
    requestIdLine(requestId) +
    `4. ONLY after that reviewer approval, merge the worktree into the branch:\n   ${mergeCmd}\n` +
    `   If the merge conflicts, resolve it or run \`git -C "${dir}" merge --abort\` and re-review — the ` +
    `worktree is preserved, nothing is lost.\n` +
    `The gate is accepted only from the reviewer subagent's output, never your own text. Do not merge ` +
    `unreviewed code, and do not start another ticket until this one is merged.\n` +
    `Note: isolation is enforced by YOU following this flow (Stop hooks do not run git) — keep edits ` +
    `inside the worktree so nothing lands unreviewed.\n` +
    `${CANCEL_HINT}\n` +
    `</nikoflow-continuation>`
  );
}

/**
 * Verify-phase convergence prompt (loop-review). Each pass spawns a FRESH,
 * context-isolated reviewer that returns a numeric score; the phase completes
 * when the reviewer scores ≥ 9.5 or reports no actionable findings AND local
 * validation is green.
 */
export function getVerifyPrompt(
  state: NikoflowState,
  requestId: string | undefined,
  pass: number,
): string {
  // Placeholder score "N.N" so a verbatim copy of the example fails (NaN) — the
  // reviewer must substitute its real score. NAF is payload-only.
  const okTag = injectRequestId(
    `<nikoflow-gate phase="verify" score="N.N">VERIFIED</nikoflow-gate>`,
    requestId,
  );
  const noFindingsTag = injectRequestId(
    `<nikoflow-gate phase="verify">NO_ACTIONABLE_FINDINGS</nikoflow-gate>`,
    requestId,
  );
  return (
    `<nikoflow-continuation phase="verify" iteration="${state.iteration}" pass="${pass}">\n` +
    `✅ VERIFICATION (loop-review, pass ${pass}). First run local validation for the changed ` +
    `surface (tests, typecheck, lint, build) and make it GREEN — the gate must never pass while ` +
    `validation is red.\n` +
    `${MONEY_CRITICAL_PREFLIGHT}\n` +
    `Then spawn ${renderReviewerSpawn(state.roles?.verifier ?? "fable")} that has NOT seen your ` +
    `reasoning. Give it this request-id and the diff scope. The reviewer inspects the change for ` +
    `correctness, regressions, security, and missing high-value tests, and returns a score from ` +
    `1–10. It must emit — in ITS OWN final output, replacing N.N with its actual score — exactly one of:\n` +
    `  ${okTag}   (score ≥ 9.5 on green validation), or\n` +
    `  ${noFindingsTag}   (no actionable findings remain).\n` +
    requestIdLine(requestId) +
    `If the reviewer scores below 9.5 with actionable findings, fix them and a NEW reviewer runs ` +
    `next pass. The gate is accepted only from the reviewer subagent's output, never your own text.\n` +
    `${CANCEL_HINT}\n` +
    `</nikoflow-continuation>`
  );
}

/** Continuation prompt for a named phase. */
export function getPhasePrompt(
  phase: string,
  state: NikoflowState,
  requestId?: string,
): string {
  let rawBody = PHASE_BODIES[phase] ?? `Phase "${phase}". Continue the methodology.`;
  // ADR: consult the architect-role model for the decision.
  if (phase === "adr" && state.roles?.architect) {
    rawBody +=
      `\nArchitect model: ${state.roles.architect} — for a non-trivial trade-off, consult it via a ` +
      `Task(model="${state.roles.architect}") subagent before recording the decision.`;
  }
  const body = injectRequestId(rawBody, requestId);
  const depth = state.depth ?? "undecided";
  return (
    `<nikoflow-continuation phase="${phase}" depth="${depth}" iteration="${state.iteration}">\n` +
    `${body}\n` +
    requestIdLine(requestId) +
    `${CANCEL_HINT}\n` +
    `</nikoflow-continuation>`
  );
}
