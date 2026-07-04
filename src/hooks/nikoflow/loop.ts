/**
 * Nikoflow Hook
 *
 * Phase-gated work loop implementing the "Niko Flow v2.1" methodology
 * (grilling → ADR → PRD → tickets → execute → verify) as an enforced
 * Stop-hook state machine. Sibling of the ralph mode; reuses the generic
 * mode-state IO and (later tickets) ralph's PRD + verifier machinery.
 *
 * TSK-001: skeleton — activation, state, depth parsing, cancel, Stop-block.
 * Phase gating + gates land in TSK-002+.
 */

import { randomUUID } from "crypto";
import {
  writeModeState,
  readModeState,
  clearModeStateFile,
} from "../../lib/mode-state-io.js";

export const NIKOFLOW_DEPTHS = ["tactical", "standard", "deep"] as const;
export type NikoflowDepth = (typeof NIKOFLOW_DEPTHS)[number];

/**
 * Phase lists per depth tier — data, not code. The Stop-hook state machine
 * iterates `phases[]` by index; the tier only selects which phases fire.
 */
export const NIKOFLOW_PHASES: Record<NikoflowDepth, string[]> = {
  tactical: ["interview", "execute", "verify"],
  standard: ["interview", "adr", "prd", "tickets", "execute", "verify"],
  deep: ["interview", "adr", "prd", "tickets", "execute", "verify"],
};

export interface NikoflowState {
  /** Whether the loop is currently active */
  active: boolean;
  /** Current iteration number */
  iteration: number;
  /** When the loop started */
  started_at: string;
  /** Refreshed on every Stop-hook iteration so a live long session is not
   *  treated as stale; a crashed/legacy file goes stale on its own. */
  last_checked_at?: string;
  /** The original task prompt (control flags stripped) */
  prompt: string;
  /** Session ID the loop is bound to */
  session_id?: string;
  /** Project path for isolation */
  project_path?: string;
  /** Selected depth tier, or null until chosen during interview */
  depth: NikoflowDepth | null;
  /** Materialized phase list for the chosen depth (empty until depth set) */
  phases: string[];
  /** Index into phases[] of the current phase */
  phase_index: number;
  /** Whether deep-tier property-based-testing obligation applies */
  pbt_enabled?: boolean;

  // --- Gate correlation (TSK-003) ---
  /** Correlation id the current gate's confirmation tag must carry. */
  request_id?: string;
  /** The phase (or "depth") the current request_id was minted for. */
  awaiting_gate?: string;
  /** When the current request_id was minted (ISO). */
  gate_request_minted_at?: string;
  /** Timestamp of the most recent real UserPromptSubmit (ISO). Used to prove a
   *  human actually replied after a gate was requested (anti-self-approval). */
  last_user_prompt_at?: string;
  /** Number of failed verify-review passes (loop-review convergence, TSK-006). */
  verify_pass?: number;
}

/** Verify gate: reviewer score at/above this passes. */
export const NIKOFLOW_VERIFY_SCORE_THRESHOLD = 9.5;
/** Verify gate: after this many failed passes, escalate to the user. */
export const NIKOFLOW_VERIFY_MAX_PASSES = 6;

export interface NikoflowLoopOptions {
  depth?: NikoflowDepth;
}

export interface NikoflowLoopHook {
  startLoop: (
    sessionId: string | undefined,
    prompt: string,
    options?: NikoflowLoopOptions,
  ) => boolean;
  cancelLoop: (sessionId: string) => boolean;
  getState: (sessionId?: string) => NikoflowState | null;
}

const MODE = "nikoflow";

/** Read Nikoflow state from disk (session-isolated). */
export function readNikoflowState(
  directory: string,
  sessionId?: string,
): NikoflowState | null {
  const state = readModeState<NikoflowState>(MODE, directory, sessionId);
  if (state && sessionId && state.session_id && state.session_id !== sessionId) {
    return null;
  }
  return state;
}

/** Write Nikoflow state to disk. */
export function writeNikoflowState(
  directory: string,
  state: NikoflowState,
  sessionId?: string,
): boolean {
  return writeModeState(
    MODE,
    state as unknown as Record<string, unknown>,
    directory,
    sessionId,
  );
}

/** Clear Nikoflow state. */
export function clearNikoflowState(
  directory: string,
  sessionId?: string,
): boolean {
  return clearModeStateFile(MODE, directory, sessionId);
}

/** Increment the Nikoflow iteration counter. */
export function incrementNikoflowIteration(
  directory: string,
  sessionId?: string,
): NikoflowState | null {
  const state = readNikoflowState(directory, sessionId);
  if (!state || !state.active) {
    return null;
  }
  state.iteration += 1;
  state.last_checked_at = new Date().toISOString();
  return writeNikoflowState(directory, state, sessionId) ? state : null;
}

/**
 * Detect an explicit depth tier from the prompt.
 * Accepts `nikoflow:deep`, `--tier=standard`, `--depth deep`, `--deep`, etc.
 */
export function detectDepthFlag(prompt: string): NikoflowDepth | null {
  const colon = prompt.match(/nikoflow\s*:\s*(tactical|standard|deep)/i);
  if (colon) return colon[1].toLowerCase() as NikoflowDepth;
  const tier = prompt.match(/--(?:tier|depth)(?:=|\s+)(tactical|standard|deep)/i);
  if (tier) return tier[1].toLowerCase() as NikoflowDepth;
  if (/--deep\b/i.test(prompt)) return "deep";
  if (/--tactical\b/i.test(prompt)) return "tactical";
  if (/--standard\b/i.test(prompt)) return "standard";
  return null;
}

/** Strip nikoflow control flags from the task text. */
export function stripNikoflowFlags(prompt: string): string {
  return prompt
    .replace(/nikoflow\s*:\s*(tactical|standard|deep)/gi, "")
    .replace(/--(?:tier|depth)(?:=|\s+)(tactical|standard|deep)/gi, "")
    .replace(/--(?:deep|tactical|standard)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Materialize the phase list for a depth tier. */
export function materializePhases(depth: NikoflowDepth): string[] {
  return [...NIKOFLOW_PHASES[depth]];
}

/**
 * The current phase name, or null when the depth is not yet chosen (still in
 * depth-selection / grilling) or when every phase has completed.
 */
export function getCurrentPhase(state: NikoflowState): string | null {
  if (!state.depth || state.phases.length === 0) return null;
  return state.phases[state.phase_index] ?? null;
}

/** Whether all phases have completed (phase_index ran off the end). */
export function isNikoflowComplete(state: NikoflowState): boolean {
  return (
    !!state.depth &&
    state.phases.length > 0 &&
    state.phase_index >= state.phases.length
  );
}

/**
 * Set the depth tier and materialize the phase list. Depth is immutable once
 * the flow has advanced past the first phase — tier changes mid-flow would
 * invalidate already-passed gates, so callers must cancel + restart instead.
 * Returns false if the change is rejected.
 */
export function setNikoflowDepth(
  directory: string,
  depth: NikoflowDepth,
  sessionId?: string,
): boolean {
  const state = readNikoflowState(directory, sessionId);
  if (!state || !state.active) return false;

  // Immutable after the flow has moved past depth selection.
  if (state.depth && state.phase_index > 0) return false;

  state.depth = depth;
  state.phases = materializePhases(depth);
  state.phase_index = 0;
  state.pbt_enabled = depth === "deep";
  return writeNikoflowState(directory, state, sessionId);
}

/**
 * Advance to the next phase. Returns the new current phase, or null when the
 * flow has completed all phases (the caller should then clear state / cancel).
 * No-op guard: cannot advance before a depth is chosen.
 */
export function advanceNikoflowPhase(
  directory: string,
  sessionId?: string,
): { phase: string | null; complete: boolean } | null {
  const state = readNikoflowState(directory, sessionId);
  if (!state || !state.active || !state.depth || state.phases.length === 0) {
    return null;
  }

  // Idempotent past the end: a re-fired gate detector must not drift the index.
  if (state.phase_index >= state.phases.length) {
    return { phase: null, complete: true };
  }

  state.phase_index += 1;
  const complete = state.phase_index >= state.phases.length;
  if (!writeNikoflowState(directory, state, sessionId)) return null;

  return {
    phase: complete ? null : state.phases[state.phase_index],
    complete,
  };
}

/**
 * Ensure a correlation request_id exists for the given gate. Mints a fresh id
 * (and records the mint time) whenever the gate changed or no id is set, so a
 * confirmation tag left over from a previous gate can never satisfy a new one.
 * Returns the active request_id, or null if state is missing.
 */
export function mintGateRequest(
  directory: string,
  gate: string,
  sessionId?: string,
): string | null {
  const state = readNikoflowState(directory, sessionId);
  if (!state || !state.active) return null;

  if (state.awaiting_gate === gate && state.request_id) {
    return state.request_id;
  }

  state.request_id = randomUUID();
  state.awaiting_gate = gate;
  state.gate_request_minted_at = new Date().toISOString();
  return writeNikoflowState(directory, state, sessionId) ? state.request_id : null;
}

/**
 * Force a fresh request_id + mint time for the current gate, even if the gate
 * is unchanged. Used to invalidate a confirmation tag the model emitted BEFORE
 * a real user turn: after rotation the stale tag no longer correlates, so the
 * model must re-emit the tag only after the user has actually replied.
 */
export function rotateGateRequest(
  directory: string,
  gate: string,
  sessionId?: string,
): string | null {
  const state = readNikoflowState(directory, sessionId);
  if (!state || !state.active) return null;
  state.request_id = randomUUID();
  state.awaiting_gate = gate;
  state.gate_request_minted_at = new Date().toISOString();
  return writeNikoflowState(directory, state, sessionId) ? state.request_id : null;
}

/** Clear the current gate correlation (after a gate passes). */
export function clearGateRequest(
  directory: string,
  sessionId?: string,
): boolean {
  const state = readNikoflowState(directory, sessionId);
  if (!state) return false;
  delete state.request_id;
  delete state.awaiting_gate;
  delete state.gate_request_minted_at;
  return writeNikoflowState(directory, state, sessionId);
}

/** Increment the failed-verify-pass counter and return the new value. */
export function recordVerifyPass(
  directory: string,
  sessionId?: string,
): number {
  const state = readNikoflowState(directory, sessionId);
  if (!state || !state.active) return 0;
  state.verify_pass = (state.verify_pass ?? 0) + 1;
  writeNikoflowState(directory, state, sessionId);
  return state.verify_pass;
}

/** Record a real UserPromptSubmit timestamp (anti-self-approval evidence). */
export function recordNikoflowUserPrompt(
  directory: string,
  sessionId?: string,
): boolean {
  const state = readNikoflowState(directory, sessionId);
  if (!state || !state.active) return false;
  state.last_user_prompt_at = new Date().toISOString();
  return writeNikoflowState(directory, state, sessionId);
}

/**
 * Whether a real user prompt arrived AFTER the current gate request was minted.
 * This is the load-bearing anti-self-approval check for human gates: the model
 * cannot satisfy a human gate without an actual user turn in between.
 */
export function userRepliedAfterMint(state: NikoflowState): boolean {
  if (!state.gate_request_minted_at || !state.last_user_prompt_at) return false;
  const minted = new Date(state.gate_request_minted_at).getTime();
  const replied = new Date(state.last_user_prompt_at).getTime();
  if (!Number.isFinite(minted) || !Number.isFinite(replied)) return false;
  return replied > minted;
}

/** Create a Nikoflow loop hook instance bound to a working directory. */
export function createNikoflowLoopHook(directory: string): NikoflowLoopHook {
  const startLoop = (
    sessionId: string | undefined,
    prompt: string,
    options?: NikoflowLoopOptions,
  ): boolean => {
    const now = new Date().toISOString();
    const depth = options?.depth ?? detectDepthFlag(prompt);
    const normalizedPrompt = stripNikoflowFlags(prompt);

    const state: NikoflowState = {
      active: true,
      iteration: 1,
      started_at: now,
      last_checked_at: now,
      prompt: normalizedPrompt,
      session_id: sessionId,
      project_path: directory,
      depth,
      phases: depth ? materializePhases(depth) : [],
      phase_index: 0,
      pbt_enabled: depth === "deep",
    };

    return writeNikoflowState(directory, state, sessionId);
  };

  const cancelLoop = (sessionId: string): boolean => {
    const state = readNikoflowState(directory, sessionId);
    if (!state || state.session_id !== sessionId) {
      return false;
    }
    return clearNikoflowState(directory, sessionId);
  };

  const getState = (sessionId?: string): NikoflowState | null => {
    return readNikoflowState(directory, sessionId);
  };

  return { startLoop, cancelLoop, getState };
}
