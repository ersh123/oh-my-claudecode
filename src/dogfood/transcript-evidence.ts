import { redactTokens } from '../notifications/redact.js';

export interface DogfoodTranscriptEvidence {
  blockQuote?: string;
  passQuote?: string;
  missing: Array<'BLOCK' | 'PASS'>;
}

function collectText(value: unknown, output: string[]): void {
  if (typeof value === 'string') {
    output.push(value);
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) collectText(item, output);
    return;
  }

  if (!value || typeof value !== 'object') return;
  const record = value as Record<string, unknown>;
  collectText(record.text, output);
  collectText(record.content, output);
  collectText(record.message, output);
}

export function redactTranscriptEvidence(value: string): string {
  return redactTokens(value)
    .replace(/\/home\/[^/\\\s"']+\/\.claude\/[^\s"']*/g, '[CLAUDE_PROFILE_PATH]')
    .replace(/\/home\/[^/\\\s"']+\/\.codex\/[^\s"']*/g, '[CODEX_PROFILE_PATH]')
    .replace(/\/home\/[^/\\\s"']+\/[^\s"']*(?:session|profile|cookie|credential)[^\s"']*/gi, '[SENSITIVE_PATH]');
}

export function extractDogfoodTranscriptEvidence(transcript: string): DogfoodTranscriptEvidence {
  const lines: string[] = [];

  for (const rawLine of transcript.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    try {
      collectText(JSON.parse(line), lines);
    } catch {
      lines.push(line);
    }
  }

  let blockQuote: string | undefined;
  let passQuote: string | undefined;

  for (const entry of lines) {
    let entryStartedBlock = false;

    for (const line of entry.split(/\r?\n/)) {
      const clean = redactTranscriptEvidence(line.trim());
      if (!clean) continue;
      if (!blockQuote && /\bBLOCK\b/i.test(clean)) {
        blockQuote = clean;
        entryStartedBlock = true;
        break;
      }
      if (blockQuote && !passQuote && /\bPASS\b/i.test(clean)) passQuote = clean;
      if (blockQuote && passQuote) break;
    }

    if (blockQuote && passQuote) break;
    if (entryStartedBlock) continue;
  }

  return {
    blockQuote,
    passQuote,
    missing: [
      ...(blockQuote ? [] : ['BLOCK' as const]),
      ...(passQuote ? [] : ['PASS' as const]),
    ],
  };
}
