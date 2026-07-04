/**
 * Nikoflow Hook - Consolidated Module
 *
 * Enforced phase-gated methodology loop implementing "Niko Flow v2.1"
 * (grilling → ADR → PRD → tickets → execute → verify). Sibling of the ralph
 * mode: same Stop-hook enforcement pattern, plus an explicit phase dimension.
 */

export {
  // State management
  readNikoflowState,
  writeNikoflowState,
  clearNikoflowState,
  incrementNikoflowIteration,

  // Loop control
  createNikoflowLoopHook,

  // Depth / phase helpers
  detectDepthFlag,
  stripNikoflowFlags,
  materializePhases,

  // Constants
  NIKOFLOW_DEPTHS,
  NIKOFLOW_PHASES,

  // Types
  type NikoflowDepth,
  type NikoflowState,
  type NikoflowLoopOptions,
  type NikoflowLoopHook,
} from "./loop.js";
