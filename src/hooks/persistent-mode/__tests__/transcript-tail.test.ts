import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, appendFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { readTranscriptTailRaw, readTranscriptTailLines } from '../index.js';

// perf F2: one statSync + memoized read per (path, window); the memo must
// never serve a stale tail once the transcript grows.
describe('transcript tail read dedup (perf F2)', () => {
  const withDir = (fn: (dir: string) => void) => {
    const dir = mkdtempSync(join(tmpdir(), 'transcript-tail-'));
    try {
      fn(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  it('small file: full content, not truncated, no line dropped', () => {
    withDir((dir) => {
      const p = join(dir, 't.jsonl');
      writeFileSync(p, 'line-1\nline-2\nline-3');
      const raw = readTranscriptTailRaw(p, 1024);
      expect(raw.truncated).toBe(false);
      expect(raw.content).toBe('line-1\nline-2\nline-3');
      expect(readTranscriptTailLines(p, 1024)).toEqual(['line-1', 'line-2', 'line-3']);
    });
  });

  it('file larger than the window drops the partial first line', () => {
    withDir((dir) => {
      const p = join(dir, 't.jsonl');
      const lines = Array.from({ length: 50 }, (_, i) => `entry-${i}-${'x'.repeat(40)}`);
      writeFileSync(p, lines.join('\n'));
      const maxBytes = 256; // guaranteed to cut into the middle of a line
      const raw = readTranscriptTailRaw(p, maxBytes);
      expect(raw.truncated).toBe(true);
      const tailLines = readTranscriptTailLines(p, maxBytes);
      // The partial first line is dropped; every surviving line is complete.
      expect(tailLines.length).toBeGreaterThan(0);
      for (const line of tailLines) {
        expect(lines).toContain(line);
      }
      expect(tailLines.at(-1)).toBe(lines.at(-1));
      // The cut line (first in the raw window) must not survive.
      expect(tailLines).not.toContain(raw.content.split('\n')[0]);
    });
  });

  it('consecutive reads return identical content (memo hit)', () => {
    withDir((dir) => {
      const p = join(dir, 't.jsonl');
      writeFileSync(p, 'stable content\nsecond line');
      const a = readTranscriptTailRaw(p, 4096);
      const b = readTranscriptTailRaw(p, 4096);
      expect(b).toEqual(a);
    });
  });

  it('never serves a stale tail after the transcript grows', () => {
    withDir((dir) => {
      const p = join(dir, 't.jsonl');
      writeFileSync(p, 'first\n');
      expect(readTranscriptTailRaw(p, 4096).content).toBe('first\n');
      appendFileSync(p, 'second\n');
      expect(readTranscriptTailRaw(p, 4096).content).toBe('first\nsecond\n');
    });
  });

  it('different windows on the same file are independent cache entries', () => {
    withDir((dir) => {
      const p = join(dir, 't.jsonl');
      const lines = Array.from({ length: 50 }, (_, i) => `entry-${i}-${'y'.repeat(40)}`);
      writeFileSync(p, lines.join('\n'));
      const small = readTranscriptTailRaw(p, 128);
      const big = readTranscriptTailRaw(p, 1024 * 1024);
      expect(small.truncated).toBe(true);
      expect(big.truncated).toBe(false);
      expect(big.content.length).toBeGreaterThan(small.content.length);
      // re-reads stay window-correct
      expect(readTranscriptTailRaw(p, 128)).toEqual(small);
    });
  });
});
