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
