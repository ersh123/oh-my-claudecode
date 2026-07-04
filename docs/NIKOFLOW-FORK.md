# Nikoflow — fork maintenance map

`nikoflow` is a local addition to this OMC fork (a new enforced Stop-hook mode, sibling of
`ralph`). It is NOT upstream. When you rebase/merge this fork onto a newer
`Yeachan-Heo/oh-my-claudecode` tag, the self-contained module survives untouched; only the
handful of **registration-point edits** below can conflict. Re-verify them in a few minutes
with this map. All paths are under the repo root.

## Self-contained (no upstream conflict expected)

- `skills/nikoflow/SKILL.md` — methodology + exact gate-tag contracts.
- `src/hooks/nikoflow/{index,loop,prompts,gates,tickets,pbt}.ts` — all mode logic.
- `src/hooks/nikoflow/__tests__/*` — unit + orchestration tests.

## Upstream registration edits (conflict-prone — re-verify after a merge)

Ranked by merge-conflict risk (hottest first):

1. **`src/hooks/persistent-mode/index.ts`** (HIGH — the repo's hottest file):
   - import block from `../nikoflow/index.js` (~line 51).
   - `PersistentModeResult.mode` union includes `'nikoflow'` (~line 108).
   - `checkNikoflowLoop` + `handleNikoflowExecute` + `handleNikoflowVerify` +
     `nikoflowReviewerAuthoredGate` + `nikoflowGatePrecondition` + helpers (~957–1399).
   - **Dispatch**: the Priority-1.5 block calling `checkNikoflowLoop` inside
     `resolvePersistentModeBlock` (between the ralph/autopilot block and Autoresearch). If a
     merge drops this block, the mode goes silent — the `nikoflow-*` tests catch the helpers
     but NOT a lost dispatch wire; smoke-test activation after any merge here.
2. **`src/hooks/keyword-detector/index.ts`** (MED-HIGH): `KeywordType` union (~20), `KEYWORD_PATTERNS`
   (~50), `KEYWORD_PRIORITY` (~97), `CANONICAL_WORKFLOW_SLASH_SKILLS` (~111),
   `SLASH_SKILL_TO_KEYWORD_TYPE` (~135), `EXECUTION_GATE_KEYWORDS` (~970).
3. **`src/hooks/bridge.ts`** (MED): `NIKOFLOW_MESSAGE` import (~96), `MODE_CONFIRMATION_SKILL_MAP`
   (~165), `recordNikoflowUserPrompt` call in `processKeywordDetector` (~1458, UserPromptSubmit —
   load-bearing for human-gate anti-self-approval), keyword activation `case "nikoflow"` (~1663),
   Skill-path activation `if (skillName === "nikoflow")` (~2841).
4. **`src/lib/mode-names.ts`** (LOW): `MODE_NAMES.NIKOFLOW`, `ALL_MODE_NAMES`, `MODE_STATE_FILE_MAP`,
   `SESSION_END_MODE_STATE_FILES` (incl. the `nikoflow-verification.json` marker).
5. **`src/hooks/mode-registry/{types,index}.ts`** (LOW): `ExecutionMode` union + `MODE_CONFIGS` entry.
6. **`src/installer/hooks.ts`** (LOW): `NIKOFLOW_MESSAGE` banner (~264).
7. **`.claude-plugin/plugin.json`** (LOW): `"./skills/nikoflow/"` in the skills array (~38).

## Build

The plugin loads `dist/`, not `src/`. After any TS edit: `npm run build` (behind a proxy, use
`env -u HTTP_PROXY -u HTTPS_PROXY … npx …`). SKILL.md/plugin.json load from disk directly.

## Post-merge checklist

1. `npx tsc` clean.
2. `npx vitest run nikoflow persistent-mode keyword-detector mode-registry ralph` green
   (proves the shared verifier/PRD/registry weren't disturbed and nikoflow still wires up).
3. Grep the dispatch wire: `grep -n "checkNikoflowLoop(sessionId" src/hooks/persistent-mode/index.ts`
   must still exist inside `resolvePersistentModeBlock`.
4. `npm run build`, then in a live Claude Code session: type `никофлоу <task>` → the Stop hook
   should block with the depth-selection prompt.

## Residual risks (soft-enforcement boundary)

- A model with shell/Write access can edit `.omc/state/**/nikoflow*.json` directly (same class as ralph).
- Human-gate user-turn check is content-blind (a "no" reply still lets the model emit the tag).
- Reviewer genuineness is bounded, not cryptographic: execute/verify gates require a review-capable
  `Task`/`proxy_Task`/`Agent` tool_result (`code-reviewer`, `security-reviewer`, `verifier`, `critic`, or
  Codex rescue), but the Stop hook cannot prove the subagent was unbiased or context-isolated.
- Green-validation in the verify phase is prompt-only (not run from the Stop hook).
- PBT detection reads root manifests only (monorepos may mis-waive; the waived reason is the tell).

## Rollout

v1 is keyword-only activation (`nikoflow`/`никофлоу`/`nflow`, or `/oh-my-claudecode:nikoflow`) —
no size-heuristic auto-trigger. Dogfood one Standard-tier task end-to-end before enabling Deep.
