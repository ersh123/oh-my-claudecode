/**
 * Nikoflow gate detection.
 *
 * Pure transcript-text scanning for the correlated gate tag
 *   <nikoflow-gate phase="X" [depth="..."] [request-id="..."]>PAYLOAD</nikoflow-gate>
 *
 * Mirrors ralph's detectArchitectApproval: strips injected examples (the
 * continuation prompt block and code-fenced sample tags) before matching, and
 * correlates on request-id so a stale tag from a previous gate cannot satisfy a
 * new one. Caller (persistent-mode) supplies the transcript text; this module
 * stays free of fs/hook dependencies so it is trivially unit-testable.
 */

import {
  NIKOFLOW_AUTONOMY_MODES,
  NIKOFLOW_DEPTHS,
  type NikoflowAutonomyMode,
  type NikoflowDepth,
} from "./loop.js";

/** Expected payload(s) per gate. A tag only counts if its payload matches. */
export const NIKOFLOW_GATE_PAYLOADS: Record<string, string[]> = {
  depth: ["CONFIRMED"],
  interview: ["CONFIRMED"],
  adr: ["RECORDED", "SKIPPED"],
  prd: ["SEAMS_CONFIRMED"],
  tickets: ["APPROVED"],
  // execute advances per-ticket via dynamic "execute:TSK-NNN" gates (payload
  // TICKET_DONE, passed explicitly) and auto-advances when all tickets are done —
  // there is no phase-level "execute" gate.
  verify: ["VERIFIED", "NO_ACTIONABLE_FINDINGS"],
};

/** Gates that require proof of a real user turn after the request was minted. */
export const HUMAN_GATE_PHASES: ReadonlySet<string> = new Set([
  "depth",
  "interview",
  "prd",
  "tickets",
]);

/** Parsed approving reviewer verdict attrs (resume-snapshot evidence). */
export interface ReviewerVerdict {
  spec: string;
  quality: string;
}

export interface GateMatch {
  matched: boolean;
  /** The approving reviewer verdict found alongside a ticket gate, when the
   *  caller required one (requireApprovedVerdict). */
  verdict?: ReviewerVerdict;
  /** For the depth gate: the tier the user confirmed, if present. */
  depth?: NikoflowDepth;
  /** Approval/autonomy mode the user confirmed. */
  autonomy_mode?: NikoflowAutonomyMode;
  /** The exact payload that matched (e.g. VERIFIED vs NO_ACTIONABLE_FINDINGS). */
  payload?: string;
  /** For the verify gate: the reviewer's numeric score, if present. */
  score?: number;
  /** For the prd gate: story ids from the `stories` attr (undefined = attr absent). */
  stories?: string[];
  /** For the adr gate: decision ids from the `decision-ids` attr (undefined = attr absent). */
  decision_ids?: string[];
}

// Precompiled attribute matchers for the known gate attributes — avoids a fresh
// RegExp compile per attribute per tag per Stop (perf F4). (?<![\w-]) not \b so a
// hyphen-prefixed lookalike (data-phase, x-request-id) can't shadow the real one.
const ATTR_REGEXES: Record<string, RegExp> = {
  phase: /(?<![\w-])phase=(["'])(.*?)\1/i,
  "request-id": /(?<![\w-])request-id=(["'])(.*?)\1/i,
  score: /(?<![\w-])score=(["'])(.*?)\1/i,
  depth: /(?<![\w-])depth=(["'])(.*?)\1/i,
  mode: /(?<![\w-])mode=(["'])(.*?)\1/i,
  spec: /(?<![\w-])spec=(["'])(.*?)\1/i,
  quality: /(?<![\w-])quality=(["'])(.*?)\1/i,
  stories: /(?<![\w-])stories=(["'])(.*?)\1/i,
  "decision-ids": /(?<![\w-])decision-ids=(["'])(.*?)\1/i,
};

/** Split a comma/whitespace-separated id-list attribute into trimmed, deduped ids. */
function splitIdList(value: string): string[] {
  return [...new Set(value.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean))];
}

function extractAttribute(attributes: string, name: string): string | undefined {
  // No `g` flag → exec always starts at 0, so a shared precompiled regex is safe.
  const re = ATTR_REGEXES[name] ?? new RegExp(`(?<![\\w-])${name}=(["'])(.*?)\\1`, "i");
  return re.exec(attributes)?.[2];
}

// Module-level strip patterns (perf F4) — .replace() ignores/rewinds lastIndex,
// so reusing these `g`-flagged regexes across calls is safe.
const STRIP_CONTINUATION = /<nikoflow-continuation\b[\s\S]*?<\/nikoflow-continuation>/gi;
const STRIP_FENCE_BACKTICK = /```[\s\S]*?```/g;
const STRIP_FENCE_TILDE = /~~~[\s\S]*?~~~/g;
const STRIP_INLINE_TAG = /`<nikoflow-(?:gate|verdict)\b[\s\S]*?<\/nikoflow-(?:gate|verdict)>`/gi;
// Markdown blockquote lines are quoted/example text, not emissions (QA-V1).
const STRIP_BLOCKQUOTE_LINE = /^[ \t]*>[^\n]*$/gm;

/**
 * Remove text that legitimately CONTAINS example gate tags so they cannot be
 * mistaken for a real confirmation: the continuation prompt block we inject,
 * and any code-fenced (`...`) sample tag.
 */
function stripInjectedExamples(text: string): string {
  return text
    .replace(STRIP_CONTINUATION, " ")
    .replace(STRIP_FENCE_BACKTICK, " ")
    .replace(STRIP_FENCE_TILDE, " ")
    .replace(STRIP_INLINE_TAG, " ")
    .replace(STRIP_BLOCKQUOTE_LINE, " ");
}

/**
 * Structured reviewer verdict. A ticket gate (TICKET_DONE) only counts when
 * the SAME reviewer output also carries an approving verdict block:
 *   <nikoflow-verdict spec="pass" quality="approved">…findings…</nikoflow-verdict>
 * A scalar approval hides scope drift — spec compliance (built what the ticket
 * asked, nothing missing/extra) and code quality are separate judgments and
 * must both pass explicitly (adopted from superpowers' two-verdict review).
 */
export function detectNikoflowReviewerVerdict(text: string): boolean {
  return matchNikoflowReviewerVerdict(text) !== null;
}

/** Like detectNikoflowReviewerVerdict, but returns the parsed approving verdict
 *  attrs so the caller can persist them as ticket evidence (resume snapshot). */
export function matchNikoflowReviewerVerdict(text: string): ReviewerVerdict | null {
  const sanitized = stripInjectedExamples(text);
  // Complete block only: a dangling opening tag or a self-closing tag is not a
  // verdict (QA-V2) — the body is where findings live.
  const re = /<nikoflow-verdict(?![\w-])([^>]*)>[\s\S]*?<\/nikoflow-verdict>/gi;
  for (const m of sanitized.matchAll(re)) {
    const attrs = m[1] ?? "";
    if (attrs.trimEnd().endsWith("/")) continue; // self-closing
    // Exactly one spec= and one quality=: a contradictory duplicate
    // (spec="pass" spec="fail") must reject, not first-attribute-win (QA-V2).
    if ((attrs.match(/(?<![\w-])spec=/gi) ?? []).length !== 1) continue;
    if ((attrs.match(/(?<![\w-])quality=/gi) ?? []).length !== 1) continue;
    const spec = extractAttribute(attrs, "spec")?.toLowerCase();
    const quality = extractAttribute(attrs, "quality")?.toLowerCase();
    if (spec === "pass" && quality === "approved") return { spec, quality };
  }
  return null;
}

/**
 * Detect a valid gate confirmation for `phase` in the transcript text.
 * When `requestId` is given, the tag MUST carry a matching request-id.
 */
export function detectNikoflowGate(
  text: string,
  opts: { phase: string; requestId?: string; expectedPayloads?: string[] },
): GateMatch {
  // Dynamic per-ticket gates (e.g. "execute:TSK-001") pass their own payloads.
  const expectedPayloads =
    opts.expectedPayloads ?? NIKOFLOW_GATE_PAYLOADS[opts.phase];
  if (!expectedPayloads) return { matched: false };

  const sanitized = stripInjectedExamples(text);
  // (?![\w-]) not \b: \b matches the boundary before the hyphen in a sibling like
  // <nikoflow-gate-blocked>, mis-parsing it as an open <nikoflow-gate> whose
  // payload then swallows the NEXT real gate (audit F1). The lookahead requires
  // the name to end exactly at "nikoflow-gate".
  const tagRe = /<nikoflow-gate(?![\w-])([^>]*)>([\s\S]*?)<\/nikoflow-gate>/gi;

  for (const m of sanitized.matchAll(tagRe)) {
    const attributes = m[1] ?? "";
    const payload = (m[2] ?? "").trim();

    const phaseAttr = extractAttribute(attributes, "phase");
    if (phaseAttr !== opts.phase) continue;

    // Exact payload match (not substring) so e.g. "NOT_CONFIRMED" ≠ "CONFIRMED".
    if (!expectedPayloads.includes(payload)) continue;

    if (opts.requestId) {
      const rid = extractAttribute(attributes, "request-id");
      if (rid !== opts.requestId) continue;
    }

    const result: GateMatch = { matched: true, payload };
    const modeAttr = extractAttribute(attributes, "mode")?.toLowerCase();
    if (modeAttr) {
      if (!(NIKOFLOW_AUTONOMY_MODES as readonly string[]).includes(modeAttr)) {
        continue;
      }
      result.autonomy_mode = modeAttr as NikoflowAutonomyMode;
    }
    const scoreAttr = extractAttribute(attributes, "score");
    if (scoreAttr !== undefined) {
      const parsed = Number.parseFloat(scoreAttr);
      // Scores are on a 1–10 scale; ignore out-of-range values (a placeholder
      // like "N.N" → NaN, or "99" → nonsense) so they can't force a pass (audit F6).
      if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 10) {
        result.score = parsed;
      }
    }
    // Coverage id lists ride the gate tag (attr present + empty → []; attr
    // absent → undefined so legacy tags keep coverage untracked).
    if (opts.phase === "prd") {
      const storiesAttr = extractAttribute(attributes, "stories");
      if (storiesAttr !== undefined) result.stories = splitIdList(storiesAttr);
    }
    if (opts.phase === "adr") {
      const decisionIdsAttr = extractAttribute(attributes, "decision-ids");
      if (decisionIdsAttr !== undefined) result.decision_ids = splitIdList(decisionIdsAttr);
    }
    if (opts.phase === "depth") {
      const depthAttr = extractAttribute(attributes, "depth")?.toLowerCase();
      // A depth confirmation is only real with a concrete tier — a verbatim
      // template copy ("tactical|standard|deep") must NOT count as a match,
      // otherwise it would burn the user's confirmation without setting depth.
      if (!depthAttr || !(NIKOFLOW_DEPTHS as readonly string[]).includes(depthAttr)) {
        continue;
      }
      result.depth = depthAttr as NikoflowDepth;
    }
    return result;
  }

  return { matched: false };
}
