import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

function readDoctorSkill(): string {
  return readFileSync(join(process.cwd(), 'skills', 'omc-doctor', 'SKILL.md'), 'utf8');
}

function extractKnownPluginNames(content: string, type: 'agent' | 'skill' | 'command'): string[] {
  const heading = `**Known plugin ${type} names**`;
  const headingIndex = content.indexOf(heading);
  expect(headingIndex).toBeGreaterThanOrEqual(0);

  const afterHeading = content.slice(headingIndex + heading.length);
  const sectionEnd = afterHeading.search(/\n\n(?:\*\*Known plugin|---)/);
  const section = sectionEnd >= 0 ? afterHeading.slice(0, sectionEnd) : afterHeading;

  return [...section.matchAll(/`([^`]+)`/g)]
    .flatMap((match) => match[1].split(','))
    .map((name) => name.trim())
    .filter(Boolean)
    .sort();
}

function listMarkdownFiles(dir: string): string[] {
  return readdirSync(join(process.cwd(), dir))
    .filter((file) => file.endsWith('.md'))
    .sort();
}

function listSkillDirs(): string[] {
  const skillsRoot = join(process.cwd(), 'skills');

  return readdirSync(skillsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => existsSync(join(skillsRoot, name, 'SKILL.md')))
    .sort();
}

describe('omc-doctor skill (issue #2254)', () => {
  it('documents CLAUDE.md OMC version drift check against cached plugin version', () => {
    const content = readDoctorSkill();

    expect(content).toContain('CLAUDE.md OMC version:');
    expect(content).toContain('OMC version source:');
    expect(content).toContain('Latest cached plugin version:');
    expect(content).toContain('VERSION DRIFT: CLAUDE.md and plugin versions differ');
    expect(content).toContain('VERSION CHECK SKIPPED: missing CLAUDE marker or plugin cache');
    expect(content).toContain('VERSION MATCH: CLAUDE and plugin cache are aligned');
    expect(content).toContain('CLAUDE-*.md');
    expect(content).toContain('deterministic companion');
    expect(content).toContain('scanned deterministic CLAUDE sources');
    expect(content).not.toContain('!==');
    expect(content).toContain('If `CLAUDE.md OMC version` != `Latest cached plugin version`: WARN - version drift detected');
  });
});


describe('omc-doctor skill Ralph Ruby dependency check (issue #2969)', () => {
  it('documents a narrow Ruby check with actionable Ralph guidance', () => {
    const content = readDoctorSkill();

    expect(content).toContain('Check Ralph Ruby Dependency');
    expect(content).toContain('Ruby for Ralph: MISSING');
    expect(content).toContain('Ralph workflows require Ruby');
    expect(content).toContain('sudo apt update && sudo apt install ruby-full');
    expect(content).toContain('Ralph Ruby Dependency');
  });
});

describe('omc-doctor skill package version diagnostic (issue #2981)', () => {
  it('checks the canonical published npm package for latest version', () => {
    const content = readDoctorSkill();

    expect(content).toContain('npm view oh-my-claude-sisyphus version');
    expect(content).not.toContain('npm view oh-my-claudecode version');
  });
});

describe('omc-doctor skill legacy plugin name inventory', () => {
  it('keeps legacy file cleanup inventories aligned with bundled plugin content', () => {
    const content = readDoctorSkill();

    expect(extractKnownPluginNames(content, 'agent')).toEqual(listMarkdownFiles('agents'));
    expect(extractKnownPluginNames(content, 'skill')).toEqual(listSkillDirs());
    expect(extractKnownPluginNames(content, 'command')).toEqual(listMarkdownFiles('commands'));
  });
});
