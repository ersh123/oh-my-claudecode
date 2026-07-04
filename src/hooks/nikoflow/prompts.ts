/**
 * Nikoflow phase prompts.
 *
 * Each phase emits a continuation prompt that (a) tells the model what the
 * current gate requires and (b) names the exact tag/artifact the Stop hook
 * will look for to advance. Tag formats here MUST match the detectors the
 * gate logic enforces (TSK-003+), so the prose and the machine agree.
 */

import type { NikoflowState } from "./loop.js";

const CANCEL_HINT =
  "When the whole task is FULLY complete and the Verification gate has passed, " +
  "run `/oh-my-claudecode:cancel` to exit. If cancel fails, retry with " +
  "`/oh-my-claudecode:cancel --force`.";

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
 * Prompt shown while no depth tier has been chosen yet. Depth selection is the
 * first act of Grilling — propose a tier with justification and confirm.
 */
export function getDepthSelectionPrompt(
  state: NikoflowState,
  requestId?: string,
): string {
  const gateTag = injectRequestId(
    `<nikoflow-gate phase="depth" depth="tactical|standard|deep">CONFIRMED</nikoflow-gate>`,
    requestId,
  );
  return (
    `<nikoflow-continuation phase="grilling:depth" iteration="${state.iteration}">\n` +
    `NIKOFLOW — depth not yet chosen. Begin Grilling by sizing the task:\n` +
    `- 🟢 tactical — a 1-file bug fix or trivially-scoped change (Grilling → Execute → Verification).\n` +
    `- 🟡 standard — a new feature (Grilling → ADR → PRD → Ticketization → TDD → Verification).\n` +
    `- 🔴 deep — an architectural change (full cycle + property-based tests + evidence).\n` +
    `Propose the smallest tier that fits, with a one-line justification, and confirm it with the user.\n` +
    `Once the user agrees, record it by emitting on its own line:\n` +
    `${gateTag}\n` +
    `(the tag is only accepted after the user has actually replied — do not self-confirm).\n` +
    `${CANCEL_HINT}\n` +
    `</nikoflow-continuation>`
  );
}

const PHASE_BODIES: Record<string, string> = {
  interview:
    `Phase 🔥 GRILLING. Interrogate the task one question at a time: why, why this way, ` +
    `what alternatives, what risks. If a question can be answered by reading the code, read ` +
    `instead of asking. Do not write any implementation until the user confirms shared ` +
    `understanding. GATE — emit after the user confirms:\n` +
    `<nikoflow-gate phase="interview">CONFIRMED</nikoflow-gate>`,
  adr:
    `Phase 📋 ADR. Record an architecture decision ONLY if it is hard-to-reverse AND ` +
    `surprising-without-context AND the result of a real trade-off (all three). Give 2+ ` +
    `options, rationale, consequences; write it to docs/adr/NNNN-slug.md. Otherwise record a ` +
    `skip with a reason. GATE — emit one of:\n` +
    `<nikoflow-gate phase="adr" decision="docs/adr/NNNN-slug.md">RECORDED</nikoflow-gate>\n` +
    `<nikoflow-gate phase="adr" skip="reason">SKIPPED</nikoflow-gate>`,
  prd:
    `Phase 📄 PRD. Write "[Actor] can [capability]" with User Stories carrying Given/When/Then ` +
    `acceptance criteria — no implementation detail. Sketch the test seams (prefer the highest, ` +
    `fewest seams) and confirm them with the user. GATE — emit after seams confirmed:\n` +
    `<nikoflow-gate phase="prd">SEAMS_CONFIRMED</nikoflow-gate>`,
  tickets:
    `Phase 🎫 TICKETIZATION. Split the PRD into atomic vertical-slice tickets (TSK-001…) that ` +
    `each cut through all layers and are demoable on their own, with acceptance criteria + ` +
    `blocked-by dependencies + a self-verification step. Present the breakdown and iterate until ` +
    `the user approves it. GATE — emit after approval:\n` +
    `<nikoflow-gate phase="tickets">APPROVED</nikoflow-gate>`,
  execute:
    `Phase 🔴🟢♻️ EXECUTE (TDD). Work tickets in dependency order, one vertical slice at a time. ` +
    `The loop drives you ticket-by-ticket with a per-ticket prompt and an independent reviewer ` +
    `gate; the phase advances automatically once every ticket is reviewer-approved and done.`,
  verify:
    `Phase ✅ VERIFICATION. Spawn a fresh, context-isolated independent reviewer; iterate ` +
    `fix → re-review until local validation (tests/lint/build) is green AND the reviewer scores ` +
    `the changed surface ≥ 9.5/10 or reports no actionable findings. Never accept a passing ` +
    `score while validation is red. GATE — emit after the reviewer passes on green validation:\n` +
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
): string {
  const gate = `execute:${ticket.id}`;
  const gateTag = injectRequestId(
    `<nikoflow-gate phase="${gate}">TICKET_DONE</nikoflow-gate>`,
    requestId,
  );
  const ac = ticket.acceptance.length
    ? ticket.acceptance.map((c, i) => `  ${i + 1}. ${c}`).join("\n")
    : "  (none listed — derive from the PRD story)";
  const pbtLine = ticket.pbt_required
    ? "\nThis ticket owes property-based tests (deep tier): after GREEN, add ≥1 real property (invariant/round-trip/metamorphic) before review."
    : "";
  return (
    `<nikoflow-continuation phase="execute" ticket="${ticket.id}" iteration="${state.iteration}">\n` +
    `🔴🟢♻️ TDD on ticket ${ticket.id} — ${ticket.title}.\n` +
    `Acceptance criteria:\n${ac}\n` +
    `Work this ONE vertical slice: RED (a failing test at a pre-agreed seam) → GREEN ` +
    `(minimum code to pass) → then review. Do not start another ticket until this one is done.` +
    `${pbtLine}\n` +
    (ticket.self_verify ? `Self-verify: ${ticket.self_verify}\n` : "") +
    `When the slice is green, spawn a FRESH, context-isolated reviewer subagent (Task/Agent) to ` +
    `check it against the acceptance criteria and repo standards. Pass the reviewer this ` +
    `request-id and instruct it to emit — in ITS OWN final output — the ticket gate on its own ` +
    `line ONLY if it approves on green validation:\n` +
    `${gateTag}\n` +
    `The gate is accepted only from the reviewer subagent's output, never from your own text — ` +
    `emitting it yourself will not advance the ticket.\n` +
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
  const rawBody = PHASE_BODIES[phase] ?? `Phase "${phase}". Continue the methodology.`;
  const body = injectRequestId(rawBody, requestId);
  const depth = state.depth ?? "undecided";
  return (
    `<nikoflow-continuation phase="${phase}" depth="${depth}" iteration="${state.iteration}">\n` +
    `${body}\n` +
    `${CANCEL_HINT}\n` +
    `</nikoflow-continuation>`
  );
}
