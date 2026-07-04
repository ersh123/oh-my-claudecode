import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const REPO_ROOT = join(__dirname, '..', '..');
const SCRIPT = join(REPO_ROOT, 'scripts/check-test-baseline.mjs');

function writeVitestJson(path: string, failedFullNames: string[]) {
  writeFileSync(
    path,
    JSON.stringify(
      {
        testResults: [
          {
            assertionResults: [
              ...failedFullNames.map((fullName) => ({ fullName, status: 'failed' })),
              { fullName: 'suite passing test', status: 'passed' },
            ],
          },
        ],
      },
      null,
      2,
    ),
  );
}

describe('test-baseline gate', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'omc-baseline-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('passes when the failing test set equals the baseline', () => {
    const results = join(dir, 'vitest.json');
    const baseline = join(dir, 'test-baseline.json');
    writeVitestJson(results, ['suite known failure']);
    writeFileSync(baseline, JSON.stringify(['suite known failure'], null, 2));

    const output = execFileSync('node', [SCRIPT, results, baseline], { encoding: 'utf-8' });

    expect(output).toContain('baseline ok');
  });

  it('passes when the failing test set is a strict subset of the baseline', () => {
    const results = join(dir, 'vitest.json');
    const baseline = join(dir, 'test-baseline.json');
    writeVitestJson(results, ['suite known failure']);
    writeFileSync(baseline, JSON.stringify(['suite known failure', 'suite fixed failure'], null, 2));

    const output = execFileSync('node', [SCRIPT, results, baseline], { encoding: 'utf-8' });

    expect(output).toContain('shrunk');
  });

  it('blocks any failing test outside the baseline', () => {
    const results = join(dir, 'vitest.json');
    const baseline = join(dir, 'test-baseline.json');
    writeVitestJson(results, ['suite known failure', 'suite new failure']);
    writeFileSync(baseline, JSON.stringify(['suite known failure'], null, 2));

    expect(() => execFileSync('node', [SCRIPT, results, baseline], { encoding: 'utf-8' })).toThrow(
      /new failing tests outside baseline/,
    );
  });
});
