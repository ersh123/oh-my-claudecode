# Nikoflow -> OMX port contract

Status: planning contract, no runtime changes.
Date: 2026-07-05.
Owner: Codex/OMX implementation lane.

## 1. Target result

Port the current OMC Nikoflow workflow into OMX so Codex can run the same
methodology on the same behavioral stack:

- phase-gated Stop-hook loop;
- explicit depth selection;
- human gates that require a real user turn;
- execute and verify gates that require independent reviewer/subagent evidence;
- per-ticket implementation and review loop;
- request-id correlated gate payloads;
- bounded livelock and stale-state protection;
- reversible local state and rollback.

The target is not a textual rewrite of prompts only. The target is runtime parity:
the Codex/OMX user should be able to invoke Nikoflow, choose depth, let Codex
execute the staged workflow, and get the same safety properties OMC has today.

## 2. Authority and hard boundaries

This contract is subordinate to the workspace AGENTS.md, PROJECT-FLOW.md, and the
current OMX runtime contract.

MUST:

- Preserve user changes and unrelated untracked files.
- Work from a source checkout, not by patching an installed global package.
- Keep all changes scoped to Nikoflow/OMX integration surfaces.
- Keep state files human-readable and rollbackable.
- Verify with focused tests before claiming parity.
- Use Codex native subagents only for bounded local tasks that do not call
  external advisor CLIs.

MUST NOT:

- Modify OmniRoute providers/accounts except the explicitly allowed `codex` and
  `ollama-cloud` paths, and only when the user asks for that exact change.
- Call Claude, Gemini, reviewer CLIs, or paid/limited advisor lanes without
  explicit authorization for that exact call.
- Edit `node_modules` or global npm install paths as the durable implementation.
- Start an autonomous loop while `.omc/LOOP-HALT` or an equivalent stop marker is
  present.
- Weaken gate validation to "model said it happened".
- Treat a main-thread self-authored tag as reviewer evidence.
- Merge Codex and Claude host details back into the core state machine.

## 3. Current source of truth

OMC implementation facts to preserve:

- `src/hooks/nikoflow/loop.ts` owns the phase model, state shape, role specs,
  depth materialization, request-id minting, phase transitions, and prompt
  orchestration.
- `src/hooks/nikoflow/gates.ts` owns gate parsing and validation:
  fenced/injected examples do not count, request-id must match, payloads are exact,
  scores are bounded, and invalid depth/payload combinations are rejected.
- `src/hooks/nikoflow/prompts.ts` owns current Claude-oriented prompt rendering,
  including `Task(subagent_type=...)` language and `/oh-my-claudecode` cancel
  hints.
- `src/hooks/persistent-mode/index.ts` owns the Stop-hook enforcement path:
  stale-state handling, execute/verify special phases, reviewer-authored gate
  checks, score thresholds, pass caps, and livelock guards.
- `src/hooks/bridge.ts` owns activation from user prompts and records real user
  turns for human-gate anti-self-approval.
- `hooks/hooks.json` is the Claude hook manifest.
- `docs/NIKOFLOW-FORK.md` is the OMC fork maintenance map. It is related evidence,
  not the OMX migration contract.

OMX/Codex facts to respect:

- `~/.codex/config.toml` has hooks and multi-agent features enabled in the local
  Codex runtime.
- `~/.codex/hooks.json` already has UserPromptSubmit, Stop, PreToolUse,
  PostToolUse, PreCompact, and PostCompact hook lanes.
- OMX role prompts live under `~/.codex/agents`.
- OMX skills live under `~/.codex/skills`.
- The AGENTS.md contract requires `agent_type` for OMX native subagents.

## 4. Non-goals

Do not solve these in the first OMX port:

- No new product methodology beyond existing Nikoflow semantics.
- No multi-provider routing redesign.
- No automatic large-task heuristic activation.
- No cryptographic proof that a reviewer was unbiased.
- No cloud service, daemon, database, queue, or long-lived server requirement.
- No global rewrite of OMC persistent modes.
- No migration of all OMC skills into OMX.

## 5. Architecture contract

The port MUST split Nikoflow into two layers:

1. Host-neutral core.
2. Host adapter.

The host-neutral core owns:

- depth definitions and phase lists;
- state schema and state transitions;
- request-id minting;
- ticket lifecycle semantics;
- gate payload validation;
- stale-state and livelock rules;
- retry/advance decisions;
- generic prompt slots and acceptance criteria.

The host adapter owns:

- hook event names and payload decoding;
- session id extraction;
- state file root and path conventions;
- real-user-turn detection;
- transcript/session tail reading;
- subagent spawn syntax;
- reviewer-output provenance detection;
- cancel/help command text;
- install manifest generation.

Core MUST NOT import Claude or Codex hook manifests directly.
Core MUST NOT mention `CLAUDE_PLUGIN_ROOT`, `Task(subagent_type=...)`, or
`/oh-my-claudecode`.
Adapters MAY mention host-specific syntax.

Recommended interface shape:

```ts
export interface NikoflowHostAdapter {
  readonly host: "claude" | "codex";
  readonly stateRootName: ".omc" | ".omx";

  getSessionId(input: unknown): string | null;
  getProjectPath(input: unknown): string | null;
  getUserPrompt(input: unknown): string | null;
  hasRealUserTurnAfter(sessionId: string, timestamp: number): Promise<boolean>;

  renderCancelHint(): string;
  renderDepthPrompt(ctx: DepthPromptContext): string;
  renderPhasePrompt(ctx: PhasePromptContext): string;
  renderReviewerSpawn(ctx: ReviewerSpawnContext): string;

  readRecentAssistantOutput(ctx: OutputScanContext): Promise<AssistantOutput[]>;
  isIndependentReviewerOutput(output: AssistantOutput): boolean;
  installHooks(ctx: InstallContext): Promise<InstallResult>;
}
```

Exact names can change, but the boundary must remain.

## 6. State contract

OMC state exists under `.omc/state/...`.
OMX state SHOULD live under `.omx/state/...` unless the project already has a
stronger local convention.

The state schema MUST preserve:

- `active`;
- `session_id`;
- `project_path`;
- `depth`;
- `phases`;
- `current_phase`;
- `iteration`;
- `prompt`;
- gate request-id fields;
- timestamp of the user prompt that started/advanced the workflow;
- execute stall counters;
- verify stall counters;
- ticket state reference.

State writes MUST be atomic enough for hook re-entry. A temp file plus rename is
acceptable.

State cleanup MUST be explicit:

- success terminal state;
- user cancel;
- stale/corrupt unrecoverable state;
- hard blocker with clear report.

State cleanup MUST NOT delete unrelated `.omx` or `.omc` state.

## 7. Gate contract

All Nikoflow gates are structured tags. A gate is valid only when all relevant
conditions pass.

Human gates:

- MUST require a real user turn after the gate request was minted.
- MUST reject a gate emitted before that user turn.
- MUST correlate request-id exactly.
- MUST reject examples, fenced code, quoted instructions, and stale request-id.

Execute gates:

- MUST be authored by an independent reviewer-capable lane.
- MUST correlate request-id exactly.
- MUST prove the ticket acceptance criteria are satisfied or explain blockers.
- MUST NOT accept main-thread self-approval.

Verify gates:

- MUST be authored by an independent reviewer/verifier-capable lane.
- MUST correlate request-id exactly.
- MUST include score validation where the current OMC flow requires it.
- MUST enforce the same score threshold and pass caps as OMC unless changed by a
  deliberate versioned decision.

The Codex port MUST add tests for:

- valid Codex reviewer output;
- main-thread fake gate rejection;
- stale request-id rejection;
- fenced/example gate rejection;
- wrong `agent_type` or non-reviewer output rejection;
- human gate without real user turn rejection;
- verify score below threshold rejection.

## 8. Prompt rendering contract

OMC prompt rendering currently assumes Claude Task syntax. OMX MUST render Codex
instructions explicitly.

Claude adapter:

- MAY keep current `Task(subagent_type=...)` wording.
- MAY keep existing OMC cancel command wording.

Codex adapter:

- MUST instruct native subagent usage through installed role names and `agent_type`.
- MUST name the expected role, output contract, evidence requirement, and stop
  condition.
- MUST remind subagents to stay inside scope and report blockers upward.
- MUST forbid external advisor CLIs unless the user explicitly authorized them.
- MUST include exact gate payload format only when that phase is waiting for a
  gate.

Codex prompts SHOULD use SCEI-lite structure:

- System/Identity;
- Context;
- Examples/Guidance;
- Input/Task;
- Acceptance criteria;
- Done condition.

## 9. Codex hook mapping

Minimum viable mapping:

- UserPromptSubmit: detect Nikoflow activation and record real user turn.
- Stop: enforce phase gate, advance phase, block when gate is missing/invalid.
- PreToolUse/PostToolUse: optional evidence capture and tool safety checks.
- PreCompact/PostCompact: preserve/restore compact state references.

If Codex exposes direct subagent lifecycle events, use them for provenance.
If not, the adapter MAY inspect the recent session event stream, but it must keep
the same anti-forgery semantics:

- identify a bounded recent output window;
- require output provenance tied to a native subagent or review-capable tool;
- reject plain assistant text from the leader lane;
- avoid broad unbounded transcript reads.

## 10. Installer and packaging contract

The first implementation MUST happen in a source checkout.

Allowed install targets:

- project-local `.codex/skills/nikoflow` for dogfood;
- project-local `.codex/hooks.json` for dogfood;
- user-level `~/.codex/skills/nikoflow` only after local tests are green;
- user-level `~/.codex/hooks.json` only through an installer with backup/rollback.

Disallowed durable targets:

- global npm `node_modules`;
- generated dist files without source changes;
- direct manual edits to hook files without a reversible backup/plan.

Installer MUST:

- detect existing hook entries;
- avoid duplicates;
- preserve unrelated hooks;
- support dry-run or printed diff;
- support rollback from a local backup artifact;
- never print secret-bearing environment values.

## 11. Implementation stages

Stage 0, source and baseline:

- Locate or create the OMX source checkout.
- Confirm current Codex hooks and skill layout.
- Record baseline `git status`.
- Do not touch global installs.

Stage 1, fixture capture:

- Capture or synthesize minimal Codex session fixtures:
  - activation prompt;
  - leader output;
  - native subagent review output;
  - invalid leader-authored fake gate;
  - compaction boundary if available.

Stage 2, failing tests:

- Port OMC gate tests to host-neutral fixtures.
- Add Codex-specific provenance tests.
- Add installer hook merge tests.

Stage 3, host adapter split:

- Extract core logic so Claude behavior remains unchanged.
- Keep the Claude adapter green first.
- No behavior change should occur for OMC at this stage.

Stage 4, Codex adapter:

- Render Codex prompts with native role names.
- Parse Codex hook events.
- Validate Codex reviewer provenance.
- Keep all gate semantics equivalent to OMC.

Stage 5, OMX skill and hook wiring:

- Add `nikoflow` skill under Codex/OMX skill layout.
- Register activation keywords through the proper OMX router.
- Wire Stop and UserPromptSubmit hooks.

Stage 6, dogfood:

- Use temp `CODEX_HOME` or project-local `.codex` fixture first.
- Run a shallow Nikoflow task end to end.
- Then run a standard-depth task.
- Deep mode stays disabled until shallow and standard are green.

Stage 7, docs and cutover:

- Document invocation, state paths, rollback, and known limitations.
- Update maintenance map only if OMC surfaces changed.
- Move from project-local install to user-level only after explicit approval if
  user-level config mutation is required.

## 12. Verification contract

Minimum local verification before claiming implementation complete:

```bash
git status --short
npx tsc --noEmit
npx vitest run nikoflow
npx vitest run persistent-mode keyword-detector mode-registry
```

For the OMX implementation repo, use the equivalent package scripts if names
differ.

Additional required checks:

- focused tests for Codex hook event parsing;
- focused tests for Codex reviewer provenance;
- installer merge/rollback tests;
- diff scan for secrets and unexpected config churn;
- one end-to-end dry-run with project-local `.codex`;
- one real dogfood run after explicit operator approval if it mutates user-level
  Codex config.

If a check cannot run, the report MUST state why and provide next-best evidence.

## 13. Rollback contract

Rollback must be possible at every stage.

For source changes:

- revert the branch or individual commits;
- keep diffs scoped enough for file-level rollback.

For local project `.codex` dogfood:

- restore the prior project hook file from backup;
- remove only the project-local Nikoflow skill directory created by the port.

For user-level Codex config:

- require explicit approval before mutation;
- write a timestamped local backup first;
- restore from that backup if hooks fail to load;
- never delete unrelated user hooks.

For runtime state:

- remove only the active Nikoflow state files for the affected session;
- keep logs/artifacts unless the user explicitly asks to clean them.

## 14. Delegation contract for native subagents

Subagents may be used during implementation because the user requested that this
contract include delegation options. They are not required for every step.

Parent/leader responsibilities:

- decide whether delegation pays for itself;
- provide a bounded SCEI-lite prompt;
- name `agent_type`;
- forbid external advisor CLIs unless explicitly authorized;
- define output format and done condition;
- merge results and own final verification;
- stop delegation when lanes start overlapping.

Allowed native subagent lanes:

| Lane | `agent_type` | Use when | Expected output |
| --- | --- | --- | --- |
| Repo map | `explore` | Need exact source files, symbols, hook surfaces, or current OMX layout. | File/path map with evidence and uncertainty. |
| Architecture review | `architect` | Need host-adapter boundary review or split alternatives. | TAKE/DEFER/DROP findings and risks. |
| Implementation slice | `executor` | A bounded file set can be changed independently. | Patch summary, tests run, blockers. |
| Debug/root cause | `debugger` | A failing hook/test needs isolation. | Root cause, reproduction, minimal fix path. |
| Test design | `test-engineer` | Need fixtures, regression matrix, or flaky-test strategy. | Test cases, commands, expected assertions. |
| Verification | `verifier` | Need independent evidence that claims match code. | Pass/fail verdict with command output summary. |
| Code review | `code-reviewer` | Non-trivial diff is ready for review. | Findings by severity with file references. |
| Plan critique | `critic` | Plan may overfit OMC or miss Codex constraints. | Concrete objections and minimal repairs. |
| Docs | `writer` | Runtime is green and user docs need cleanup. | Final docs diff and wording risks. |
| Git hygiene | `git-master` | Branch/worktree/commit cleanup is needed. | Non-destructive git plan and executed safe steps. |

Delegation MUST NOT:

- mutate provider/account routing;
- touch user-level Codex config without explicit approval;
- patch global installs;
- read or print secret-bearing files;
- call external advisors;
- continue after the parent cancels or a stop marker is present;
- claim completion without evidence.

Good subagent prompt skeleton:

```text
System/Identity:
You are the <role> lane for the Nikoflow -> OMX port. Follow AGENTS.md.

Context:
Repo path, branch, relevant files, current stage, hard boundaries.

Guidance:
No external advisors. No provider/account changes. No global install edits.
Stay in the assigned file set. Report blockers upward.

Task:
Do <bounded task>.

Acceptance:
List exact evidence required.

Output:
Findings / Changes / Tests / Blockers / Next recommended lane.
```

## 15. WSJF-lite backlog

TAKE first:

- Extract host-neutral gate/state core with Claude behavior preserved.
- Add Codex fixture tests for reviewer provenance and fake-gate rejection.
- Implement Codex prompt renderer with `agent_type` role names.
- Wire project-local `.codex` dogfood install.
- Add installer merge/rollback tests.

DEFER until core is green:

- Deep mode dogfood.
- User-level install.
- Automatic task-size activation.
- Fancy HUD/trace integration.
- Cross-project migration assistant.

DROP for this port:

- New database/queue/daemon.
- Full OMC fork rewrite.
- External advisor dependency.
- Provider/account routing changes.
- Proof system beyond bounded runtime provenance.

## 16. Acceptance criteria

The port is accepted only when:

- OMC Claude Nikoflow tests remain green or unchanged by a deliberate documented
  migration step.
- OMX Codex Nikoflow can activate from a user prompt.
- Depth selection is enforced.
- Human gates require a real user turn.
- Execute/verify gates require independent reviewer/verifier output.
- Fake/stale/fenced gates are rejected.
- State survives ordinary Stop-hook re-entry.
- Stale/corrupt state exits safely.
- Installer can add hooks without duplicating or deleting unrelated hooks.
- Rollback restores the previous hook config.
- Docs describe invocation, state, rollback, and residual risks.

## 17. Residual risks to keep visible

- Runtime provenance is bounded, not cryptographic.
- Human-gate content can still be semantically poor; the hook only proves a real
  user turn occurred.
- Compaction can hide context if fixture coverage is weak.
- Codex subagent event shape may change; keep adapter tests close to real
  fixtures.
- User-level config mutation remains higher risk than project-local dogfood and
  needs explicit approval.

## 18. Stop condition for the implementation project

Stop when one of these is true:

- all acceptance criteria are met and evidence is recorded;
- the user cancels;
- a stop marker is present and no safe planning/doc-only work remains;
- three consecutive attempts hit the same blocker with no new evidence;
- required authority is missing for user-level config mutation or production-like
  dogfood.

Until then, prefer the smallest reversible next step with fresh evidence.
