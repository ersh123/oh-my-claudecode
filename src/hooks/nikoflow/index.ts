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
  detectAutonomyModeFlag,
  stripNikoflowFlags,
  materializePhases,

  // Role → model routing (TSK-010)
  detectRoleFlags,
  resolveRoles,
  isCodexRoleSpec,
  NIKOFLOW_DEFAULT_ROLES,
  NIKOFLOW_NATIVE_MODELS,
  NIKOFLOW_CODEX_SPECS,
  NIKOFLOW_MODEL_FALLBACK,
  type NikoflowRoles,
  getCurrentPhase,
  isNikoflowComplete,
  setNikoflowDepth,
  setNikoflowAutonomyMode,
  recordNikoflowCoverageIds,
  advanceNikoflowPhase,
  requiresNikoflowHumanGate,

  // Gate correlation (TSK-003)
  mintGateRequest,
  rotateGateRequest,
  clearGateRequest,
  bumpNikoflowRidMismatch,
  recordNikoflowUserPrompt,
  readNikoflowUserTurnAt,
  userRepliedAfterMint,
  isNikoflowUserTurnFresh,

  // Verify convergence (TSK-006)
  recordVerifyPass,

  // Livelock guards (R1)
  bumpVerifyNoVerdict,
  deactivateNikoflowLoop,
  resetVerifyNoVerdict,
  bumpExecuteStall,
  resetExecuteStall,

  // Pure in-memory mutator cores (perf F1 — ctx threading in persistent-mode)
  incrementIterationIn,
  setDepthIn,
  setAutonomyModeIn,
  recordCoverageIdsIn,
  advancePhaseIn,
  mintGateRequestIn,
  rotateGateRequestIn,
  clearGateRequestIn,
  bumpRidMismatchIn,
  recordVerifyPassIn,
  bumpVerifyNoVerdictIn,
  resetVerifyNoVerdictIn,
  bumpExecuteStallIn,
  resetExecuteStallIn,
  deactivateIn,

  // Constants
  NIKOFLOW_DEPTHS,
  NIKOFLOW_AUTONOMY_MODES,
  NIKOFLOW_PHASES,
  NIKOFLOW_VERIFY_SCORE_THRESHOLD,
  NIKOFLOW_VERIFY_MAX_PASSES,
  NIKOFLOW_VERIFY_MAX_NO_VERDICT,
  NIKOFLOW_EXECUTE_MAX_STALL,
  NIKOFLOW_EXECUTE_ABORT_STALL,

  // Types
  type NikoflowDepth,
  type NikoflowAutonomyMode,
  type NikoflowState,
  type NikoflowLoopOptions,
  type NikoflowLoopHook,
} from "./loop.js";

export {
  getDepthSelectionPrompt,
  getPhasePrompt,
  renderNikoflowResumeHeader,
} from "./prompts.js";

export {
  detectNikoflowGate,
  detectNikoflowReviewerVerdict,
  matchNikoflowReviewerVerdict,
  NIKOFLOW_GATE_PAYLOADS,
  HUMAN_GATE_PHASES,
  type GateMatch,
  type ReviewerVerdict,
} from "./gates.js";

export {
  normalizeTicketsFile,
  lintTicketsRaw,
  lintTicketsFile,
  readTickets,
  writeTickets,
  clearTickets,
  validateTicketDag,
  validateTicketCoverage,
  getNextTicket,
  allTicketsDone,
  markTicketStatus,
  isTicketDeadlock,
  lintTddEvidence,
  TDD_SHA_PATTERN,
  type TddRunEvidence,
  type TddRedEvidence,
  type TddEvidence,
  type NikoflowCoverage,
  type NikoflowTicket,
  type NikoflowTicketsFile,
  type TicketStatus,
  type DagValidation,
} from "./tickets.js";

export {
  getExecuteTicketPrompt,
  getVerifyPrompt,
  renderReviewerSpawn,
  renderPanel,
} from "./prompts.js";

export {
  NIKOFLOW_TASK_STATUS,
  readTaskBoardTasks,
  readTaskmapSidecar,
  writeTaskmapSidecar,
  clearTaskmapSidecar,
  computeTaskBoardDrift,
  type TaskBoardStatus,
  type TaskBoardTask,
  type TaskmapEntry,
  type TaskmapSidecar,
  type TaskBoardDrift,
} from "./taskmap.js";

export {
  detectPbtFramework,
  pbtObligation,
  type PbtFramework,
  type PbtStatus,
  type PbtDetection,
  type PbtObligation,
} from "./pbt.js";

export {
  ticketWorktreeRelPath,
  ticketWorktreePath,
  ticketWorktreeBranch,
  ticketWorktreeCreateCmd,
  ticketWorktreeMergeCmd,
  ticketWorktreeRemoveCmd,
} from "./worktree.js";
