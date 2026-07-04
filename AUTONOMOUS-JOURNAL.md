# OMC Autonomous Journal

## 2026-07-04 — dogfood/baseline-gate

Candidates + WSJF:
- TAKE: root `test-baseline.json` set-diff gate for full Vitest results. Value 9, risk reduction 10, urgency 9, complexity 2 => 14.0. Missing artifact made the mandate's "full suite vs baseline" invariant unverifiable.
- DEFER: fix the 5 current baseline failures. Value 7, risk reduction 8, urgency 5, complexity 7 => 2.9. Needs separate root-cause pass.
- DROP now: commit generated bridge churn from symlinked `node_modules`. Value 0, risk 6, complexity 1 => 0. It only changed esbuild debug path comments.

Changed:
- Added `scripts/check-test-baseline.mjs`, which compares Vitest JSON failed `fullName` set against root `test-baseline.json`.
- Added `npm run test:baseline` as the mechanical full-suite gate.
- Added tests covering exact match, strict subset, and new-failure BLOCK.
- Added current baseline of 5 failing full test names from full Vitest JSON.

Evidence:
- RED: `npx vitest run tests/lint/test-baseline-gate.test.ts` failed before implementation with missing `scripts/check-test-baseline.mjs`.
- GREEN: `npx vitest run tests/lint/test-baseline-gate.test.ts` passed 3/3; negative probe emitted `baseline check failed: new failing tests outside baseline: - suite new failure`, and the test asserted BLOCK.
- Build: `npm run build` exited 0.
- Full suite baseline gate: `npm run test:baseline` exited 0 and ended with `baseline ok: 5 failing test(s) match test-baseline.json`.
- Dist/live drift: `git status --porcelain dist/ bridge/cli.cjs bridge/mcp-server.cjs bridge/team-mcp.cjs` produced no output.
- Secret scan: staged diff scan for key/token/password/private-key patterns produced no output.

Dogfood artifact:
- The new gate was dogfooded by `npm run test:baseline`; it runs Vitest JSON, deletes stale JSON first, and accepts only the exact current baseline or a strict subset.
- Observed BLOCK->PASS: fixture with `suite new failure` blocked; full repo run passed only after `test-baseline.json` matched the actual 5-name failing set.

Reviewer verdict (verbatim, Codex-only local refute pass):
> PASS.
> Invariant checks:
> 1. Human gates, anti-self-approval, userturn sidecar, and reviewer-channel code were not touched.
> 2. `dist/` was not rebuilt into the commit because no `src/**` runtime code changed; checked `dist/` and bridge generated files for zero drift after removing symlink-only build noise.
> 3. No test assertion was removed/weakened/skipped; one new lint test file adds exact/subset/BLOCK coverage.
> 4. Full-suite failing set is exactly `test-baseline.json`: 5 failed of 10231, baseline checker exited 0 with `baseline ok`.
> 5. No new speculative surface: one Node script, one npm command, one baseline file, one focused test.
> Remaining concern: the baseline records 5 existing failures; it makes drift visible but does not fix those failures.

Remaining risk:
- Five current failures remain accepted by baseline and should be shrunk in later iterations.
- Full suite stdout is noisy from existing git/tmux fixtures, but the JSON set-diff is now the source of truth.

## 2026-07-04 — dogfood/ask-baseline-shrink

Candidates + WSJF:
- TAKE: shrink `test-baseline.json` by fixing `omc ask --agent-prompt` prompt-dir precedence. Value 8, risk reduction 8, urgency 7, complexity 2 => 11.5. Deterministic unit failure, advisor-facing behavior, no tmux/perf flake.
- DEFER: tmux `spawnWorkerInPane` baseline failures. Value 7, risk reduction 8, urgency 6, complexity 7 => 3.0. Needs separate terminal-delivery root-cause pass.
- DEFER: `subagent-lock` perf baseline. Value 5, risk reduction 6, urgency 4, complexity 8 => 1.9. Likely timing/env-sensitive.

Changed:
- `resolveAskPromptsDir` now lets explicit project/project-local `.omx/setup-scope.json` choose `.codex/prompts` before falling back to global `CODEX_HOME/prompts`.
- The `--agent-prompt` CLI test now creates a conflicting `CODEX_HOME` prompt and asserts the project prompt wins.
- Removed the fixed ask failure from `test-baseline.json`, shrinking the known-failure set from 5 to 4.

Evidence:
- RED: `npx vitest run src/cli/__tests__/ask.test.ts -t 'loads --agent-prompt role from resolved prompts dir'` failed because payload loaded global executor prompt instead of `ROLE HEADER`.
- GREEN targeted: same command passed 1/1 after the precedence fix.
- GREEN ask suite: `npx vitest run src/cli/__tests__/ask.test.ts` passed 42/42.
- Build: `npm run build` exited 0 in the dogfood worktree.
- SQLite env repair: local `npm ci --ignore-scripts` left `better-sqlite3` without a native binding; `npm rebuild better-sqlite3` restored it, verified by `better-sqlite3 binding ok`.
- SQLite smoke: `npx vitest run src/__tests__/job-state-db.test.ts src/__tests__/job-management-sqlite.test.ts src/__tests__/pre-compact-cwd.test.ts` passed 93/93.
- Full suite baseline gate: `npm run test:baseline` exited 0 and ended with `baseline ok: 4 failing test(s) match test-baseline.json`.
- Dist truth: build changed only `bridge/cli.cjs`, `dist/cli/**`, source, and `test-baseline.json`; `bridge/mcp-server.cjs`, `bridge/team-mcp.cjs`, `bridge/runtime-cli.cjs`, and `bridge/team.js` stayed clean after local-node_modules rebuild.
- Secret/format scan: `git diff --check` and diff scan for key/token/password/private-key patterns produced no output.

Reviewer verdict (manual Codex-only local diff review):
> PASS.
> The behavior change is limited to prompt directory precedence: project/project-local scope now wins over inherited global `CODEX_HOME`, while global fallback remains intact when no project scope exists.
> The regression test is deterministic because it creates both project and global executor prompts and asserts the global prompt is absent.
> Generated artifacts are in the same diff and match the source change; no unrelated bridge path-comment churn remains.

Remaining risk:
- Four accepted baseline failures remain: auto-update reconciliation, subagent-lock latency, and two tmux spawnWorkerInPane cases.
- Full-suite stdout is still noisy from existing git/tmux fixtures; the JSON baseline set remains the source of truth.
