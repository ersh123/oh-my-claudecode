#!/usr/bin/env node
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import { spawnSync } from 'node:child_process';

const runVitest = process.argv.includes('--run-vitest');
const positional = process.argv.slice(2).filter((arg) => arg !== '--run-vitest');
const resultsPath = positional[0] ?? '.omc/test-results/vitest.json';
const baselinePath = positional[1] ?? 'test-baseline.json';

function die(message) {
  console.error(`baseline check failed: ${message}`);
  process.exit(1);
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch (error) {
    die(`cannot read ${label} at ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function testName(assertion) {
  if (typeof assertion.fullName === 'string' && assertion.fullName.trim()) {
    return assertion.fullName.trim();
  }
  const parts = [...(assertion.ancestorTitles ?? []), assertion.title].filter(Boolean);
  return parts.join(' ').trim();
}

if (runVitest) {
  mkdirSync(dirname(resultsPath), { recursive: true });
  rmSync(resultsPath, { force: true });
  spawnSync('vitest', ['run', '--reporter=json', `--outputFile=${resultsPath}`], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
}

const results = readJson(resultsPath, 'Vitest JSON results');
const baseline = readJson(baselinePath, 'test baseline');

if (!Array.isArray(baseline) || !baseline.every((entry) => typeof entry === 'string' && entry.trim())) {
  die('test-baseline.json must be a JSON array of non-empty failing test full names');
}

const duplicateBaselineEntries = baseline.filter((entry, index) => baseline.indexOf(entry) !== index);
if (duplicateBaselineEntries.length) {
  die(`duplicate baseline entries:\n${[...new Set(duplicateBaselineEntries)].map((entry) => `- ${entry}`).join('\n')}`);
}

const failing = new Set();
for (const suite of results.testResults ?? []) {
  for (const assertion of suite.assertionResults ?? []) {
    if (assertion.status === 'failed') {
      const name = testName(assertion);
      if (!name) {
        die('failed assertion without a fullName/title in Vitest JSON results');
      }
      failing.add(name);
    }
  }
}

const allowed = new Set(baseline);
const unexpected = [...failing].filter((name) => !allowed.has(name)).sort();
if (unexpected.length) {
  die(`new failing tests outside baseline:\n${unexpected.map((name) => `- ${name}`).join('\n')}`);
}

const fixed = baseline.filter((name) => !failing.has(name)).sort();
if (fixed.length) {
  console.log(
    `baseline shrunk: ${failing.size}/${baseline.length} failing test(s); remove fixed entries:\n${fixed
      .map((name) => `- ${name}`)
      .join('\n')}`,
  );
} else {
  console.log(`baseline ok: ${failing.size} failing test(s) match test-baseline.json`);
}
