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
}

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
