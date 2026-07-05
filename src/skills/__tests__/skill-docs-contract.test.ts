import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

function listBundledSkillDocs(): string[] {
  const skillsRoot = join(process.cwd(), 'skills');

  return readdirSync(skillsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join('skills', entry.name, 'SKILL.md'));
}

describe('bundled skill docs contract', () => {
  it('does not advertise the removed note slash command', () => {
    const staleReferences = listBundledSkillDocs().filter((relativePath) =>
      readFileSync(join(process.cwd(), relativePath), 'utf8').includes('/oh-my-claudecode:note'),
    );

    expect(staleReferences).toEqual([]);
  });
});
