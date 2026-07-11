/**
 * Live-hook contract tests for nikoflow.
 *
 * These run the ACTUAL deployed hook scripts (scripts/keyword-detector.mjs,
 * scripts/persistent-mode.mjs) as child processes — not the TypeScript source —
 * because the 2026-07 audit found every P1 in the .mjs/TS drift gap:
 *  - bare mentions of "nikoflow" activated the mode (three live incidents),
 *  - --auto / autonomy flags were parsed by TS but dropped by the live script,
 *  - rate-limit Stops were blocked by the live wrapper (429 retry loop).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createNikoflowLoopHook,
  type NikoflowState,
} from '../hooks/nikoflow/loop.js';

const KEYWORD_SCRIPT = join(process.cwd(), 'scripts', 'keyword-detector.mjs');
const PERSISTENT_SCRIPT = join(process.cwd(), 'scripts', 'persistent-mode.mjs');
const NODE = process.execPath;

let runCounter = 0;

function runHook(
  scriptPath: string,
  payload: Record<string, unknown>,
  extraEnv: Record<string, string> = {},
): string {
  // Strip external kill-switches, not just override: a parent shell running
  // with DISABLE_OMC=1 (e.g. a codex/QA session) otherwise makes every live
  // activation test silently inert (QA-T1).
  const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: 'test', OMC_SKIP_HOOKS: '', ...extraEnv };
  delete env.DISABLE_OMC;
  delete env.DISABLE_OMX;
  delete env.OMX_SKIP_HOOKS;
  return execFileSync(NODE, [scriptPath], {
    input: JSON.stringify(payload),
    encoding: 'utf-8',
    env,
    timeout: 20000,
  }).trim();
}

function activate(prompt: string): { cwd: string; sessionId: string; statePath: string } {
  const cwd = mkdtempSync(join(tmpdir(), 'nikoflow-live-'));
  // The persistent-mode engine resolves state relative to the worktree root;
  // without a git root the Stop path would look elsewhere than activation wrote.
  execFileSync('git', ['init', '-q'], { cwd, timeout: 10000 });
  const sessionId = `nikoflow-live-${runCounter++}`;
  runHook(KEYWORD_SCRIPT, {
    hook_event_name: 'UserPromptSubmit',
    cwd,
    session_id: sessionId,
    prompt,
  });
  const statePath = join(cwd, '.omc', 'state', 'sessions', sessionId, 'nikoflow-state.json');
  return { cwd, sessionId, statePath };
}

function readState(statePath: string): NikoflowState {
  return JSON.parse(readFileSync(statePath, 'utf-8')) as NikoflowState;
}

describe('nikoflow live activation guard (keyword-detector.mjs)', () => {
  // Every negative here is a real prompt that false-fired in production
  // sessions on 2026-07-10, or the class it belongs to.
  const NEGATIVES = [
    'тебе нужно вспомнить что такое никофлоу у OMC клода кода. сделай аудит',
    'You are auditing nikoflow, an enforced Stop-hook workflow mode.',
    'Write the full report in Markdown to /home/niko/.claude/refs/nikoflow-audit-gpt56.md',
    'окей давай делай все правки по НИКОФЛОУ',
    'review src/hooks/nikoflow/loop.ts and explain the state machine',
    'compare nikoflow vs superpowers and gsd-core',
    'inspect nikoflow-state.json without starting the mode',
    // Negated intent must not activate (QA-A1).
    'Do not run nikoflow on this repo.',
    'We should not use nikoflow here.',
    'Не используй никофлоу, это только термин в отчёте.',
  ];

  const POSITIVES = [
    'Run nikoflow on this repository.',
    'nikoflow:standard implement the scoped task',
    'nikoflow fix the parser crash',
    'запусти никофлоу почини сборку',
    'никофлоу: исправь баг в авторизации',
    // Control flags directly after the name are an invocation (QA-A2).
    'nikoflow --auto',
    'nikoflow --auto fix auth',
    'nikoflow --depth deep --auto',
  ];

  for (const prompt of NEGATIVES) {
    it(`stays inert on mention: ${JSON.stringify(prompt.slice(0, 60))}`, () => {
      const { cwd, statePath } = activate(prompt);
      try {
        expect(existsSync(statePath), 'nikoflow-state.json must NOT be written').toBe(false);
      } finally {
        rmSync(cwd, { recursive: true, force: true });
      }
    });
  }

  for (const prompt of POSITIVES) {
    it(`activates on explicit invocation: ${JSON.stringify(prompt.slice(0, 60))}`, () => {
      const { cwd, statePath } = activate(prompt);
      try {
        expect(existsSync(statePath), 'nikoflow-state.json must be written').toBe(true);
        expect(readState(statePath).active).toBe(true);
      } finally {
        rmSync(cwd, { recursive: true, force: true });
      }
    });
  }
});

describe('nikoflow live activation parity with the TS engine (autonomy/depth/roles/prompt)', () => {
  const PARITY_PROMPTS = [
    'nikoflow:standard --auto implement the scoped task',
    'nikoflow:deep --qa=codex --exec=sonnet build the parser',
    'nikoflow:tactical --approval-gated fix the off-by-one',
    'запусти никофлоу без согласований почини сборку',
  ];

  for (const prompt of PARITY_PROMPTS) {
    it(`live script state matches createNikoflowLoopHook().startLoop() for ${JSON.stringify(prompt.slice(0, 50))}`, () => {
      const { cwd, statePath } = activate(prompt);
      const tsDir = mkdtempSync(join(tmpdir(), 'nikoflow-ts-'));
      try {
        expect(existsSync(statePath), 'live activation expected').toBe(true);
        const live = readState(statePath);

        const hook = createNikoflowLoopHook(tsDir);
        expect(hook.startLoop('ts-session', prompt)).toBe(true);
        const ts = hook.getState('ts-session')!;

        // run_id is random per activation — assert shape, not equality.
        expect(String(live.run_id)).toMatch(/^[0-9a-f]{8}$/);
        expect(String(ts.run_id)).toMatch(/^[0-9a-f]{8}$/);
        expect(live.autonomy_mode ?? null).toBe(ts.autonomy_mode ?? null);
        expect(live.depth ?? null).toBe(ts.depth ?? null);
        expect(live.phases).toEqual(ts.phases);
        expect(live.pbt_enabled ?? false).toBe(ts.pbt_enabled ?? false);
        expect(live.roles).toEqual(ts.roles);
        // Stored task text must be identical after flag stripping — a leaked
        // control flag in one surface but not the other is exactly the drift
        // class that broke --auto.
        expect(live.prompt).toBe(ts.prompt);
      } finally {
        rmSync(cwd, { recursive: true, force: true });
        rmSync(tsDir, { recursive: true, force: true });
      }
    });
  }
});

describe('nikoflow live activation never writes Stop-hook-owned resume fields', () => {
  // base_sha / last_verify are written ONLY from the Stop hook. If someone
  // later adds them at activation, the hand-written keyword-detector.mjs
  // activation shape would need mirroring — this documents and catches that.
  it('activation state carries neither base_sha nor last_verify', () => {
    const { cwd, statePath } = activate('Run nikoflow on this repository.');
    try {
      const live = readState(statePath) as unknown as Record<string, unknown>;
      expect('base_sha' in live).toBe(false);
      expect('last_verify' in live).toBe(false);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

describe('nikoflow cancel sweeps every registered root (cwd-wander hazard)', () => {
  it('cancelomc issued from a different cwd removes state written under another .omc root', () => {
    const registry = join(mkdtempSync(join(tmpdir(), 'nikoflow-registry-')), 'roots.json');
    const env = { OMC_NIKOFLOW_ROOTS_FILE: registry };
    const sessionId = `nikoflow-sweep-${runCounter++}`;

    // Activate in root A.
    const rootA = mkdtempSync(join(tmpdir(), 'nikoflow-rootA-'));
    execFileSync('git', ['init', '-q'], { cwd: rootA, timeout: 10000 });
    runHook(KEYWORD_SCRIPT, {
      hook_event_name: 'UserPromptSubmit',
      cwd: rootA,
      session_id: sessionId,
      prompt: 'Run nikoflow on this repository.',
    }, env);
    const statePath = join(rootA, '.omc', 'state', 'sessions', sessionId, 'nikoflow-state.json');
    expect(existsSync(statePath), 'activation must write state under root A').toBe(true);

    // Cancel from root B — previously this left root A state alive for days.
    const rootB = mkdtempSync(join(tmpdir(), 'nikoflow-rootB-'));
    execFileSync('git', ['init', '-q'], { cwd: rootB, timeout: 10000 });
    runHook(KEYWORD_SCRIPT, {
      hook_event_name: 'UserPromptSubmit',
      cwd: rootB,
      session_id: sessionId,
      prompt: 'cancelomc',
    }, env);
    try {
      expect(existsSync(statePath), 'sweep must remove root A state').toBe(false);
    } finally {
      rmSync(rootA, { recursive: true, force: true });
      rmSync(rootB, { recursive: true, force: true });
    }
  });
});

describe('nikoflow live Stop wiring (persistent-mode.mjs)', () => {
  function runStop(cwd: string, sessionId: string, extra: Record<string, unknown> = {}): string {
    return runHook(PERSISTENT_SCRIPT, {
      hook_event_name: 'Stop',
      cwd,
      session_id: sessionId,
      ...extra,
    });
  }

  it('blocks an ordinary Stop while a flow is active', () => {
    const { cwd, sessionId, statePath } = activate('Run nikoflow on this repository.');
    try {
      expect(existsSync(statePath)).toBe(true);
      const out = JSON.parse(runStop(cwd, sessionId));
      expect(out.decision).toBe('block');
      expect(String(out.reason)).toContain('nikoflow-continuation');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('never blocks a rate-limit Stop (429 retry-loop guard)', () => {
    const { cwd, sessionId, statePath } = activate('Run nikoflow on this repository.');
    try {
      expect(existsSync(statePath)).toBe(true);
      for (const stopReason of [
        'rate_limit',
        'too_many_requests',
        'overloaded_error',
        // Separator variants and provider quota codes (QA-R2/R3).
        'rate-limit',
        'rate limit exceeded',
        'RESOURCE_EXHAUSTED',
        'insufficient_quota',
        // Non-string junk from the JSON boundary must not crash (QA-R4).
        429,
      ]) {
        const out = JSON.parse(runStop(cwd, sessionId, { stop_reason: stopReason }));
        expect(out.decision, `stop_reason=${JSON.stringify(stopReason)} must pass through`).toBeUndefined();
        expect(out.continue).toBe(true);
      }
      // Non-rate-limit junk types must not crash AND must still reach the block.
      const blocked = JSON.parse(runStop(cwd, sessionId, { stop_reason: { code: 500 } }));
      expect(blocked.decision).toBe('block');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
