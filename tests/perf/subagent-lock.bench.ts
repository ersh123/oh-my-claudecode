/**
 * Benchmark: subagent-tracking RMW latency under no contention.
 *
 * Measures per-update wall time for sequential updates. Linux uses repeated
 * samples and a scheduler/filesystem-noise-tolerant p50/p99 envelope so an
 * isolated stall does not fail dev, while still catching sustained lock
 * slowdowns and hangs (median-p50, median-p99, and max-p99 ceilings).
 * GitHub-hosted runners routinely sustain ~23-31ms p50 / ~30-32ms p99 on a
 * healthy path. Local full-suite runs share CPU and filesystem bandwidth with
 * thousands of concurrent tests, so they use a wider envelope by default. Set
 * OMC_STRICT_LOCAL_PERF=1 to enforce the historical local p99 <= 8ms guard when
 * benchmarking on a known-fast filesystem.
 */

import { describe, it, expect, afterEach } from "vitest";
import { performance } from "perf_hooks";
import { mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  flushPendingWrites,
  executeFlush,
  type SubagentTrackingState,
} from "../../src/hooks/subagent-tracker/index.js";

const N = 100;
const WARMUP_RUNS = 1;
const MEASURED_RUNS = 5;
const STRICT_LOCAL_P99_LIMIT_MS = 8;
// CI ceilings sit above the hosted-runner steady-state band (p50 ~23-31ms,
// p99 ~30-32ms) so healthy runs pass, while still catching sustained
// slowdowns/hangs via the median-p50, median-p99, and max-p99 guards. See #3352.
const CI_MEDIAN_P50_LIMIT_MS = 40;
const CI_MEDIAN_P99_LIMIT_MS = 25;
const CI_MEDIAN_P99_JITTER_MARGIN_MS = 20;
const CI_MAX_P99_LIMIT_MS = 100;
const LOCAL_MEDIAN_P50_LIMIT_MS = 80;
const LOCAL_MEDIAN_P99_LIMIT_MS = 90;
const LOCAL_MAX_P99_LIMIT_MS = 200;
const isCi = process.env.CI === "true" || process.env.CI === "1";
const isStrictLocalPerf = !isCi && process.env.OMC_STRICT_LOCAL_PERF === "1";

function makeEmptyState(): SubagentTrackingState {
  return {
    agents: [],
    total_spawned: 0,
    total_completed: 0,
    total_failed: 0,
    last_updated: new Date().toISOString(),
  };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
}

type BenchmarkSummary = {
  p50: number;
  p95: number;
  p99: number;
  max: number;
};

function summarize(sorted: number[]): BenchmarkSummary {
  return {
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    max: sorted[sorted.length - 1] ?? 0,
  };
}

function median(values: number[]): number {
  const sorted = values.slice().sort((a, b) => a - b);
  return percentile(sorted, 50);
}

describe("subagent-lock benchmark", () => {
  const dirs: string[] = [];

  afterEach(() => {
    flushPendingWrites();
    for (const d of dirs) {
      try { rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
    }
    dirs.length = 0;
  });

  function makeTempDir(): string {
    const dir = join(tmpdir(), `omc-bench-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    // Create the .omc/state dir so resolveSessionStatePaths can resolve paths
    mkdirSync(join(dir, ".omc", "state"), { recursive: true });
    dirs.push(dir);
    return dir;
  }

  /**
   * Run N sequential executeFlush calls and return sorted per-update timings.
   */
  function runBenchmark(dir: string, sessionId: string): number[] {
    const samples: number[] = [];

    for (let i = 0; i < N; i++) {
      const state = makeEmptyState();
      state.agents.push({
        agent_id: `agent-${i}`,
        agent_type: "oh-my-claudecode:executor",
        started_at: new Date().toISOString(),
        parent_mode: "ultrawork",
        status: "running",
        task_description: `task-${i}`,
      });
      state.total_spawned = i + 1;

      const t0 = performance.now();
      // executeFlush does the full RMW critical section under lock
      executeFlush(dir, state, sessionId);
      const elapsed = performance.now() - t0;
      samples.push(elapsed);
    }

    return samples.slice().sort((a, b) => a - b);
  }

  function runMeasuredBenchmarks(): BenchmarkSummary[] {
    const summaries: BenchmarkSummary[] = [];

    for (let run = 0; run < WARMUP_RUNS + MEASURED_RUNS; run++) {
      const dir = makeTempDir();
      const sessionId = `bench-session-${Date.now()}-${run}`;
      const summary = summarize(runBenchmark(dir, sessionId));
      if (run >= WARMUP_RUNS) summaries.push(summary);
    }

    return summaries;
  }

  // Linux hard assertion with CI-noise-tolerant aggregation.
  it.runIf(process.platform === "linux")(
    `sequential locked updates stay within Linux latency guardrails`,
    () => {
      const summaries = runMeasuredBenchmarks();
      const p50s = summaries.map((summary) => summary.p50);
      const p99s = summaries.map((summary) => summary.p99);
      const medianP50 = median(p50s);
      const medianP99 = median(p99s);
      const maxP99 = Math.max(...p99s);
      const medianP50Limit = isCi ? CI_MEDIAN_P50_LIMIT_MS : LOCAL_MEDIAN_P50_LIMIT_MS;
      const medianP99Limit = isCi
        ? CI_MEDIAN_P99_LIMIT_MS + CI_MEDIAN_P99_JITTER_MARGIN_MS
        : LOCAL_MEDIAN_P99_LIMIT_MS;
      const maxP99Limit = isCi ? CI_MAX_P99_LIMIT_MS : LOCAL_MAX_P99_LIMIT_MS;

      console.log(
        `[subagent-lock bench] Linux CI=${isCi} strictLocal=${isStrictLocalPerf}` +
        ` N=${N} measuredRuns=${MEASURED_RUNS}` +
        ` medianP50=${medianP50.toFixed(3)}ms medianP99=${medianP99.toFixed(3)}ms` +
        ` medianP50Limit=${medianP50Limit}ms medianP99Limit=${medianP99Limit}ms` +
        ` maxP99=${maxP99.toFixed(3)}ms maxP99Limit=${maxP99Limit}ms` +
        ` p99s=${p99s.map((p99) => p99.toFixed(3)).join(",")}`,
      );

      if (isStrictLocalPerf) {
        expect(medianP99).toBeLessThanOrEqual(STRICT_LOCAL_P99_LIMIT_MS);
      } else {
        // Local full-suite runs can add scheduler and filesystem contention.
        // Keep this as a coarse sustained-slowdown/hang guard; use strictLocal
        // for dedicated low-noise performance benchmarking.
        expect(medianP50).toBeLessThanOrEqual(medianP50Limit);
        expect(medianP99).toBeLessThanOrEqual(medianP99Limit);
        expect(maxP99).toBeLessThanOrEqual(maxP99Limit);
      }
    },
  );

  // All platforms: log p99 without failing
  it("logs p99 latency on all platforms (informational)", () => {
    const dir = makeTempDir();
    const sessionId = `bench-session-${Date.now()}`;

    const summary = summarize(runBenchmark(dir, sessionId));

    console.log(
      `[subagent-lock bench] platform=${process.platform}  N=${N}` +
      `  p50=${summary.p50.toFixed(3)}ms  p95=${summary.p95.toFixed(3)}ms` +
      `  p99=${summary.p99.toFixed(3)}ms  max=${summary.max.toFixed(3)}ms`,
    );

    // Sanity: p99 must always be positive and less than 30s (catches hangs)
    expect(summary.p99).toBeGreaterThan(0);
    expect(summary.p99).toBeLessThan(30_000);
  });
});
