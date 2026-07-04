# OMC Trust Roadmap

This is the steering artifact required by the autonomous mandate. Mark an area done only when its exit criteria are checked by current evidence, not by intent.

| Area | Exit criteria | Status | Evidence / next action |
| --- | --- | --- | --- |
| nikoflow | [ ] Human gates require a post-request real user turn. [ ] Execute/verify gates require independent reviewer tool results. [ ] Stale request ids fail closed. [ ] Request-id fidelity is pinned. | In progress | Existing invariant tests cover the core gate semantics. Next: design request-id fidelity without production edits. |
| ralph | [ ] Cannot self-approve. [ ] Phase machine cannot livelock on recoverable failures. [ ] Live dogfood has BLOCK->PASS evidence. | Unchecked | Discovery pass needed. |
| team | [ ] Team phases reach terminal states. [ ] Worker launch/model routing is deterministic. [ ] Worktree cleanup is covered. | In progress | Spawn env baseline fixed. Next: cancel-path worktree cleanup. |
| persistent-mode | [ ] Runtime hook cannot silently skip required enforcement. [ ] Dist import parity is checked. [ ] Failure mode is explicit in docs/tests. | Unchecked | Discovery pass needed around `scripts/persistent-mode.mjs` and compiled engine imports. |
| state IO | [ ] Cross-process writes are atomic where needed. [ ] RMW order is designed for nikoflow F1. [ ] No user work is lost on crash/retry. | Escalation-gated | F1 is design-then-STOP before production edits. |
| gate detection | [ ] Reviewer channel accepts only Task/proxy_Task/Agent tool results. [ ] Main-thread text never passes review gates. [ ] Tests pin negative cases. | In progress | Core safety invariants exist. Next: scan for cross-mode gaps before edits. |
| transcript scan | [ ] Transcript parsing handles hook noise. [ ] Required BLOCK and PASS quotes are extracted without leaking secrets. [ ] Session/profile paths are redacted in committed artifacts. | Unchecked | Discovery pass needed before live-dogfood automation. |
| `.mjs` parity | [ ] Hook/runtime `.mjs` defaults match TS engine. [ ] Build scripts keep generated runtime in the same commit as source changes. [ ] Drift checks are mechanical. | In progress | Baseline gate exists. Next: systematic `.mjs`/TS default audit. |
| docs | [ ] User docs match current commands, gates, and recovery path. [ ] Mandate-required roadmap and journal are committed. [ ] Recovery via `loop-last-good` is documented. | In progress | This roadmap closes the missing steering artifact. Next: docs accuracy discovery. |

## Backlog

- Design nikoflow F1 write ordering and stop before production edits.
- Investigate request-id fidelity without weakening anti-self-approval.
- Wire nikoflow cancel-path worktree cleanup if tests prove the orphan path.
- Audit `.mjs` defaults and parsers against TS runtime.
- Extend livelock and anti-self-approval coverage across ralph, team, and persistent-mode.

## Cadence

- Every iteration updates this file when it changes area status or backlog.
- Every 10th iteration audits the least-recently-audited area and records evidence in `AUTONOMOUS-JOURNAL.md`.
