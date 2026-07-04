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

import { NIKOFLOW_DEPTHS, type NikoflowDepth } from "./loop.js";

/** Expected payload(s) per gate. A tag only counts if its payload matches. */
export const NIKOFLOW_GATE_PAYLOADS: Record<string, string[]> = {
  depth: ["CONFIRMED"],
  interview: ["CONFIRMED"],
  adr: ["RECORDED", "SKIPPED"],
  prd: ["SEAMS_CONFIRMED"],
  tickets: ["APPROVED"],
  execute: ["ALL_TICKETS_APPROVED"],
  verify: ["VERIFIED"],
};

/** Gates that require proof of a real user turn after the request was minted. */
export const HUMAN_GATE_PHASES: ReadonlySet<string> = new Set([
  "depth",
  "interview",
  "prd",
  "tickets",
]);

export interface GateMatch {
  matched: boolean;
  /** For the depth gate: the tier the user confirmed, if present. */
  depth?: NikoflowDepth;
}

function extractAttribute(attributes: string, name: string): string | undefined {
  const match = new RegExp(`\\b${name}=(["'])(.*?)\\1`, "i").exec(attributes);
  return match?.[2];
}

/**
 * Remove text that legitimately CONTAINS example gate tags so they cannot be
 * mistaken for a real confirmation: the continuation prompt block we inject,
 * and any code-fenced (`...`) sample tag.
 */
function stripInjectedExamples(text: string): string {
  return text
    .replace(/<nikoflow-continuation\b[\s\S]*?<\/nikoflow-continuation>/gi, " ")
    // fenced code blocks (```...``` and ~~~...~~~) hold examples, not real gates
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/~~~[\s\S]*?~~~/g, " ")
    // inline code-spanned example tag
    .replace(/`<nikoflow-gate\b[\s\S]*?<\/nikoflow-gate>`/gi, " ");
}

/**
 * Detect a valid gate confirmation for `phase` in the transcript text.
 * When `requestId` is given, the tag MUST carry a matching request-id.
 */
export function detectNikoflowGate(
  text: string,
  opts: { phase: string; requestId?: string },
): GateMatch {
  const expectedPayloads = NIKOFLOW_GATE_PAYLOADS[opts.phase];
  if (!expectedPayloads) return { matched: false };

  const sanitized = stripInjectedExamples(text);
  const tagRe = /<nikoflow-gate\b([^>]*)>([\s\S]*?)<\/nikoflow-gate>/gi;

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

    const result: GateMatch = { matched: true };
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
