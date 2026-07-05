<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-01-28 | Updated: 2026-03-02 -->

# skills

41 skill directories for workflow automation and specialized behaviors.

## Purpose

Skills are reusable workflow templates that can be invoked via `/oh-my-claudecode:skill-name`. Each skill provides:
- Structured prompts for specific workflows
- Activation triggers (manual or automatic)
- Integration with execution modes

## Key Files

### Execution Mode Skills

| File | Skill | Purpose |
|-----------|-------|---------|
| `autopilot/SKILL.md` | autopilot | Full autonomous execution from idea to working code |
| `autoresearch/SKILL.md` | autoresearch | Stateful single-mission improvement loop with strict evaluator contract, markdown decision logs, and max-runtime stop behavior |
| `nikoflow/SKILL.md` | nikoflow | Phase-gated Niko Flow v2.1 methodology loop (Grilling → ADR → PRD → Ticketization → TDD → Verification) with Tactical/Standard/Deep depth tiers and hard quality gates |
| `ultrawork/SKILL.md` | ultrawork | Parallel execution engine for high-throughput task completion |
| `ralph/SKILL.md` | ralph | Self-referential loop until task completion with configurable verification reviewer |
| `self-improve/SKILL.md` | self-improve | Autonomous evolutionary code improvement engine with tournament selection |
| `team/SKILL.md` | team | N coordinated agents on shared task list using Claude Code implicit agent teams |
| `ultraqa/SKILL.md` | ultraqa | QA cycling workflow - test, verify, fix, repeat until goal met |
| `ultragoal/SKILL.md` | ultragoal | Durable multi-goal workflow that persists plan/ledger artifacts under .omc/ultragoal and prints Claude /goal handoff text for the active session |
| `verify/SKILL.md` | verify | Verify that a change really works before you claim completion |

### Planning Skills

| File | Skill | Purpose |
|-----------|-------|---------|
| `plan/SKILL.md` | omc-plan | Strategic planning with optional interview workflow |
| `ralplan/SKILL.md` | ralplan | Consensus planning entrypoint that auto-gates vague ralph/autopilot/team requests before execution |
| `deep-interview/SKILL.md` | deep-interview | Socratic deep interview with mathematical ambiguity gating before explicit execution approval |

### Exploration Skills

| File | Skill | Purpose |
|-----------|-------|---------|
| `deepinit/SKILL.md` | deepinit | Deep codebase initialization with hierarchical AGENTS.md documentation |
| `debug/SKILL.md` | debug | Diagnose the current OMC session or repo state using logs, traces, state, and focused reproduction |
| `deep-dive/SKILL.md` | deep-dive | 2-stage pipeline: trace (causal investigation) -> deep-interview (requirements crystallization) with 3-point injection |
| `external-context/SKILL.md` | external-context | Invoke parallel document-specialist agents for external web searches and documentation lookup |
| `sciomc/SKILL.md` | sciomc | Orchestrate parallel scientist agents for comprehensive analysis with AUTO mode |
| `trace/SKILL.md` | trace | Evidence-driven tracing lane that orchestrates competing tracer hypotheses in Claude built-in team mode |
| `wiki/SKILL.md` | wiki | LLM Wiki — persistent markdown knowledge base that compounds across sessions (Karpathy model) |

### Visual Skills

| File | Skill | Purpose |
|-----------|-------|---------|
| `visual-verdict/SKILL.md` | visual-verdict | Structured visual QA verdict for screenshot-to-reference comparisons |

### Utility Skills

| File | Skill | Purpose |
|-----------|-------|---------|
| `ai-slop-cleaner/SKILL.md` | ai-slop-cleaner | Clean AI-generated code slop with a regression-safe, deletion-first workflow and optional reviewer-only mode |
| `ccg/SKILL.md` | ccg | Claude-Codex-Gemini tri-model orchestration via /ask codex + /ask antigravity (or gemini), then Claude synthesizes results |
| `configure-notifications/SKILL.md` | configure-notifications | Configure notification integrations (Telegram, Discord, Slack) via natural language |
| `skillify/SKILL.md` | skillify | Turn a repeatable workflow from the current session into a reusable OMC skill draft |
| `learner/SKILL.md` | learner | Extract a learned skill from the current conversation |
| `ask/SKILL.md` | ask | Process-first advisor routing for Claude, Codex, Gemini, Antigravity, Grok, or Cursor via `omc ask`, with artifact capture and no raw CLI assembly |
| `cancel/SKILL.md` | cancel | Cancel any active OMC mode (autopilot, ralph, nikoflow, ultrawork, ultraqa, swarm, ultrapilot, pipeline, team) |
| `hud/SKILL.md` | hud | Configure HUD display options (layout, presets, display elements) |
| `local-build-reminder/SKILL.md` | local-build-reminder | Remind the user to rebuild OMC after editing TypeScript when running from a local fork. Triggered automatically by the AI whenever it notices it (or the user) just changed a src/**/*.ts file in an OMC dev install. |
| `omc-doctor/SKILL.md` | omc-doctor | Diagnose and fix oh-my-claudecode installation issues |
| `omc-reference/SKILL.md` | omc-reference | OMC agent catalog, available tools, team pipeline routing, commit protocol, and skills registry. Auto-loads when delegating to agents, using OMC tools, orchestrating teams, making commits, or invoking skills. |
| `setup/SKILL.md` | setup | Use first for install/update routing — sends setup, doctor, or MCP requests to the correct OMC setup flow |
| `omc-setup/SKILL.md` | omc-setup | Install or refresh oh-my-claudecode for plugin, npm, and local-dev setups from the canonical setup flow |
| `omc-teams/SKILL.md` | omc-teams | CLI-team runtime for claude, codex, gemini, antigravity, grok, or cursor workers in tmux panes when you need process-based parallel execution |
| `mcp-setup/SKILL.md` | mcp-setup | Configure popular MCP servers for enhanced agent capabilities |
| `remember/SKILL.md` | remember | Review reusable project knowledge and decide what belongs in project memory, notepad, or durable docs |
| `skill/SKILL.md` | skill | Manage local skills - list, add, remove, search, edit, setup wizard |

### Domain Skills

| File | Skill | Purpose |
|-----------|-------|---------|
| `project-session-manager/SKILL.md` | project-session-manager | Worktree-first dev environment manager for issues, PRs, and features with optional tmux sessions |
| `writer-memory/SKILL.md` | writer-memory | Agentic memory system for writers - track characters, relationships, scenes, and themes |
| `release/SKILL.md` | release | Generic release assistant — analyzes repo release rules, caches them in .omc/RELEASE_RULE.md, then guides the release |

`project-session-manager` also exposes the `psm` alias for shorter invocations.

## For AI Agents

### Working In This Directory

#### Skill Template Format

```markdown
---
name: skill-name
description: Brief description
triggers:
  - "keyword1"
  - "keyword2"
agent: executor  # Optional: which agent to use
model: sonnet    # Optional: model override
pipeline: [skill-name, follow-up-skill]  # Optional: standardized multi-skill flow
next-skill: follow-up-skill              # Optional: explicit handoff target
next-skill-args: --direct                # Optional: arguments for the next skill
handoff: .omc/plans/example.md           # Optional: artifact/context handed to next skill
---

# Skill Name

## Purpose
What this skill accomplishes.

## Workflow
1. Step one
2. Step two
3. Step three

## Usage
How to invoke this skill.

## Configuration
Any configurable options.
```

#### Skill Invocation

```bash
# Manual invocation
/oh-my-claudecode:skill-name

# With arguments
/oh-my-claudecode:skill-name arg1 arg2

# Auto-detected from keywords
"autopilot build me a REST API"  # Triggers autopilot skill
```

#### Creating a New Skill

1. Create `new-skill/SKILL.md` directory and file with YAML frontmatter
2. Define purpose, workflow, and usage
3. Add to skill registry (auto-detected from frontmatter)
4. Optionally add activation triggers
5. Create corresponding plugin-scoped skill/slash surface via `skills/new-skill/SKILL.md` (and generated artifacts when the build requires them)
6. Update `docs/REFERENCE.md` (Skills section, count)
7. If execution mode skill, also create `src/hooks/new-skill/` hook

### Common Patterns

**Skill chaining:**
```markdown
## Workflow
1. Invoke `explore` agent for context
2. Invoke `architect` for analysis
3. Invoke `executor` for implementation
4. Invoke `qa-tester` for verification
```

If `pipeline` / `next-skill` metadata is present, OMC appends a standardized **Skill Pipeline** handoff block to the rendered skill prompt so downstream steps are explicit.

**Conditional behavior:**
```markdown
## Workflow
1. Check if tests exist
   - If yes: Run tests first
   - If no: Create test plan
2. Proceed with implementation
```

### Testing Requirements

- Skills are verified via integration tests
- Test skill invocation with `/oh-my-claudecode:skill-name`
- Verify trigger keywords activate correct skill
- For git-related skills, follow `templates/rules/git-workflow.md`

## Dependencies

### Internal
- Loaded by skill bridge (`scripts/build-skill-bridge.mjs`)
- References agents from `agents/`
- Uses hooks from `src/hooks/`

### External
None - pure markdown files.

## Skill Categories

| Category | Skills | Trigger Keywords |
|----------|--------|------------------|
| Execution | autopilot, autoresearch, nikoflow, ralph, self-improve, team, ultragoal, ultraqa, ultrawork, verify | "autopilot", "ulw", "ralph", "team" |
| Cleanup | ai-slop-cleaner | "deslop", "anti-slop", cleanup/refactor + slop smells |
| Planning | omc-plan, ralplan, deep-interview | "plan this", "interview me", "ouroboros" |
| Exploration | debug, deep-dive, deepinit, external-context, sciomc, trace, wiki | "deepinit", "research" |
| Visual | visual-verdict | screenshot/reference comparison |
| Utility | ask, cancel, ccg, configure-notifications, hud, learner, local-build-reminder, mcp-setup, omc-doctor, omc-reference, omc-setup, omc-teams, remember, setup, skill, skillify | "stop", "cancel" |
| Domain | psm, writer-memory, release | psm context |

`learner` remains a deprecated compatibility skill; prefer `skillify` for new skill extraction workflows.

## Auto-Activation

Some skills activate automatically based on context:

| Skill | Auto-Trigger Condition |
|-------|----------------------|
| autopilot | "autopilot", "build me", "I want a" |
| ultrawork | "ulw", "ultrawork" |
| ralph | "ralph", "don't stop until" |
| deep-interview | "deep interview", "interview me", "ouroboros", "don't assume" |
| cancel | "stop", "cancel", "abort" |

<!-- MANUAL:
- Team runtime wait semantics: `omc_run_team_wait.timeout_ms` only limits the wait call and does not stop workers.
- `timeoutSeconds` is removed from `omc_run_team_start`; use explicit `omc_run_team_cleanup` for intentional worker pane termination.
-->
