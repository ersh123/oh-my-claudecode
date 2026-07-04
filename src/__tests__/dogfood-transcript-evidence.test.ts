import { describe, expect, it } from 'vitest';

import {
  extractDogfoodTranscriptEvidence,
  redactTranscriptEvidence,
} from '../dogfood/transcript-evidence.js';

describe('dogfood transcript evidence extraction', () => {
  it('extracts redacted BLOCK and PASS quotes through hook noise', () => {
    const claudeProfilePath = [
      '/home/tester',
      `.${'claude'}`,
      'projects',
      'sample',
      'session.jsonl',
    ].join('/');
    const shardxProfilePath = [
      '/home/tester',
      '.local',
      'share',
      'shardx',
      'profiles',
      'main',
    ].join('/');
    const bearerToken = ['fixture', 'token', 'value'].join('-');
    const botToken = ['fixture', 'bot', 'value'].join('-');
    const transcript = [
      'hook stderr noise before json',
      JSON.stringify({
        message: {
          content: [
            {
              type: 'text',
              text: `BLOCK stop quote ${claudeProfilePath} Bearer ${bearerToken}`,
            },
          ],
        },
      }),
      JSON.stringify({
        message: {
          content: [
            {
              type: 'tool_result',
              content: [
                {
                  type: 'text',
                  text: `PASS reviewer quote ${shardxProfilePath} Bot ${botToken}`,
                },
              ],
            },
          ],
        },
      }),
    ].join('\n');

    const result = extractDogfoodTranscriptEvidence(transcript);

    expect(result.missing).toEqual([]);
    expect(result.blockQuote).toContain('BLOCK stop quote');
    expect(result.passQuote).toContain('PASS reviewer quote');
    expect(JSON.stringify(result)).not.toContain(claudeProfilePath);
    expect(JSON.stringify(result)).not.toContain(shardxProfilePath);
    expect(JSON.stringify(result)).not.toContain(bearerToken);
    expect(JSON.stringify(result)).not.toContain(botToken);
  });

  it('reports missing PASS without fabricating evidence', () => {
    const result = extractDogfoodTranscriptEvidence('BLOCK only');

    expect(result.blockQuote).toBe('BLOCK only');
    expect(result.passQuote).toBeUndefined();
    expect(result.missing).toEqual(['PASS']);
  });

  it('does not treat a BLOCK-to-PASS summary as both required quotes', () => {
    const result = extractDogfoodTranscriptEvidence('Observed BLOCK->PASS in notes');

    expect(result.blockQuote).toBe('Observed BLOCK->PASS in notes');
    expect(result.passQuote).toBeUndefined();
    expect(result.missing).toEqual(['PASS']);
  });

  it('does not accept PASS wording inside the same multiline BLOCK entry', () => {
    const transcript = JSON.stringify({
      message: {
        content: [
          {
            type: 'text',
            text: 'BLOCK <ralph-verification>\nTask: Dogfood Ralph live BLOCK/PASS evidence',
          },
        ],
      },
    });

    const result = extractDogfoodTranscriptEvidence(transcript);

    expect(result.blockQuote).toBe('BLOCK <ralph-verification>');
    expect(result.passQuote).toBeUndefined();
    expect(result.missing).toEqual(['PASS']);
  });

  it('redacts profile and credential-bearing paths', () => {
    const codexProfilePath = ['/home/tester', `.${'codex'}`, 'auth.json'].join('/');
    const sessionCachePath = ['/home/tester', 'app', `session${'-cache'}`, 'file'].join('/');
    const result = redactTranscriptEvidence(`see ${codexProfilePath} and ${sessionCachePath}`);

    expect(result).toContain('[CODEX_PROFILE_PATH]');
    expect(result).toContain('[SENSITIVE_PATH]');
    expect(result).not.toContain(codexProfilePath);
    expect(result).not.toContain(sessionCachePath);
  });
});
