import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const removedNoteCommand = ['/oh-my-claudecode', 'note'].join(':');

function listMarkdownFiles(relativeRoot: string): string[] {
  const absoluteRoot = join(process.cwd(), relativeRoot);

  if (!existsSync(absoluteRoot)) {
    return [];
  }

  return readdirSync(absoluteRoot, { withFileTypes: true }).flatMap((entry) => {
    const relativePath = join(relativeRoot, entry.name);

    if (entry.isDirectory()) {
      return listMarkdownFiles(relativePath);
    }

    return entry.isFile() && entry.name.endsWith('.md') ? [relativePath] : [];
  });
}

function listUserFacingDocs(): string[] {
  return [
    'README.md',
    'skills/AGENTS.md',
    ...listMarkdownFiles('docs'),
    ...listMarkdownFiles('seminar'),
  ].filter((relativePath) => existsSync(join(process.cwd(), relativePath)));
}

describe('public docs command contract', () => {
  it('does not advertise the removed note slash command', () => {
    const staleReferences = listUserFacingDocs().filter((relativePath) =>
      readFileSync(join(process.cwd(), relativePath), 'utf8').includes(removedNoteCommand),
    );

    expect(staleReferences).toEqual([]);
  });

  it('does not list the removed note skill in the skill inventory docs', () => {
    const skillInventory = readFileSync(join(process.cwd(), 'skills/AGENTS.md'), 'utf8');

    expect(skillInventory).not.toContain('`note/SKILL.md`');
    expect(skillInventory).not.toMatch(/\bnote,\s+cancel\b/);
  });
});
