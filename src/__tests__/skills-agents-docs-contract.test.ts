import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

function listBundledSkillDirs(): string[] {
  return readdirSync(join(process.cwd(), 'skills'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function readSkillsAgentsDoc(): string {
  return readFileSync(join(process.cwd(), 'skills/AGENTS.md'), 'utf8');
}

function extractSkillFrontmatter(markdown: string): string {
  return markdown.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? markdown;
}

function stripYamlScalarQuotes(value: string): string {
  return value.trim().replace(/^['"]|['"]$/g, '');
}

interface KeyFileRow {
  relativePath: string;
  skillName: string;
  purpose: string;
}

interface SkillCategoryRow {
  category: string;
  skillNames: string[];
  triggerKeywords: string[];
}

function extractSkillFrontmatterName(markdown: string, fallback: string): string {
  return extractSkillFrontmatter(markdown).match(/^name:\s*(.+)$/m)?.[1]?.trim() ?? fallback;
}

function extractSkillFrontmatterDescription(markdown: string): string {
  return stripYamlScalarQuotes(extractSkillFrontmatter(markdown).match(/^description:\s*(.+)$/m)?.[1] ?? '');
}

function extractKeyFileRows(markdown: string): KeyFileRow[] {
  const keyFilesSection = markdown.split('## Key Files')[1]?.split('## For AI Agents')[0] ?? '';

  return Array.from(keyFilesSection.matchAll(/^\|\s*`([^`]+\/SKILL\.md)`\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|$/gm), (match) => ({
    relativePath: match[1],
    skillName: match[2].trim(),
    purpose: match[3].trim(),
  })).sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

function extractKeyFileSkillPaths(markdown: string): string[] {
  return extractKeyFileRows(markdown)
    .map((row) => row.relativePath)
    .sort();
}

function extractKeyFileSkillDirs(markdown: string): string[] {
  return extractKeyFileSkillPaths(markdown)
    .map((relativePath) => relativePath.split('/')[0])
    .sort();
}

function parseFrontmatterList(markdown: string, fieldName: string): string[] {
  const frontmatter = extractSkillFrontmatter(markdown);
  const inlineValues = frontmatter.match(new RegExp(`^${fieldName}:\\s*\\[([^\\]]*)\\]`, 'm'))?.[1] ?? '';
  const blockValues = frontmatter.match(new RegExp(`^${fieldName}:\\s*\\n((?:\\s*-\\s*.+\\n?)+)`, 'm'))?.[1] ?? '';
  const rawValues = inlineValues
    ? inlineValues.split(',')
    : blockValues
      .split('\n')
      .map((line) => line.match(/^\s*-\s*(.+)$/)?.[1] ?? '');

  return rawValues
    .map(stripYamlScalarQuotes)
    .filter(Boolean);
}

function parseInlineAliases(markdown: string): string[] {
  return parseFrontmatterList(markdown, 'aliases');
}

function parseFrontmatterTriggers(markdown: string): string[] {
  return parseFrontmatterList(markdown, 'triggers').filter((trigger) => trigger !== '--' && !/^<[^>]+>$/.test(trigger));
}

interface SkillInvocationMetadata {
  aliases: string[];
  allNames: string[];
  primaryNames: string[];
}

function listSkillInvocationMetadataByDir(): Record<string, SkillInvocationMetadata> {
  return Object.fromEntries(
    listBundledSkillDirs().map((skillDir) => {
      const markdown = readFileSync(join(process.cwd(), 'skills', skillDir, 'SKILL.md'), 'utf8');
      const frontmatterName = extractSkillFrontmatterName(markdown, skillDir);
      const primaryNames = Array.from(new Set([skillDir, frontmatterName]));
      const aliases = parseInlineAliases(markdown);

      return [skillDir, { aliases, allNames: Array.from(new Set([...primaryNames, ...aliases])), primaryNames }];
    }),
  );
}

function extractSkillCategoryNames(markdown: string): string[] {
  return extractSkillCategoryRows(markdown)
    .flatMap((row) => row.skillNames)
    .sort();
}

function extractQuotedStrings(value: string): string[] {
  return Array.from(value.matchAll(/"([^"]+)"/g), (match) => match[1]).sort();
}

function extractSkillCategoryRows(markdown: string): SkillCategoryRow[] {
  const categorySection = markdown.split('## Skill Categories')[1]?.split('## Auto-Activation')[0] ?? '';

  return categorySection
    .split('\n')
    .flatMap((line): SkillCategoryRow[] => {
      const match = line.match(/^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|$/);
      const category = match?.[1]?.trim() ?? '';
      const skillCell = match?.[2]?.trim();
      const triggerKeywords = match?.[3]?.trim() ?? '';

      if (!skillCell || category === 'Category' || /^-+$/.test(category)) {
        return [];
      }

      return [
        {
          category,
          skillNames: skillCell
            .split(',')
            .map((skillName) => skillName.trim())
            .filter(Boolean),
          triggerKeywords: extractQuotedStrings(triggerKeywords),
        },
      ];
    })
}

function extractAutoActivationSkillNames(markdown: string): string[] {
  const autoActivationSection = markdown.split('## Auto-Activation')[1] ?? '';

  return Array.from(autoActivationSection.matchAll(/^\|\s*([^|]+?)\s*\|\s*[^|]+?\s*\|$/gm), (match) => match[1].trim())
    .filter((skillName) => skillName !== 'Skill' && !/^-+$/.test(skillName))
    .sort();
}

function resolveCategorizedSkillName(
  skillName: string,
  metadataByDir: Record<string, SkillInvocationMetadata>,
): string[] {
  const primaryMatches = Object.entries(metadataByDir)
    .filter(([, metadata]) => metadata.primaryNames.includes(skillName))
    .map(([skillDir]) => skillDir);

  if (primaryMatches.length > 0) {
    return primaryMatches;
  }

  return Object.entries(metadataByDir)
    .filter(([, metadata]) => metadata.aliases.includes(skillName))
    .map(([skillDir]) => skillDir);
}

describe('skills/AGENTS.md docs contract', () => {
  it('keeps the skill directory count aligned with bundled skills', () => {
    const match = readSkillsAgentsDoc().match(/^(\d+) skill directories/m);

    expect(match?.[1]).toBe(String(listBundledSkillDirs().length));
  });

  it('only lists existing skill docs in the key files tables', () => {
    const missingSkillDocs = extractKeyFileSkillPaths(readSkillsAgentsDoc()).filter(
      (relativePath) => !existsSync(join(process.cwd(), 'skills', relativePath)),
    );

    expect(missingSkillDocs).toEqual([]);
  });

  it('lists every bundled skill in the key files tables', () => {
    expect(extractKeyFileSkillDirs(readSkillsAgentsDoc())).toEqual(listBundledSkillDirs());
  });

  it('keeps the key files skill column matching each skill frontmatter name', () => {
    const mismatchedRows = extractKeyFileRows(readSkillsAgentsDoc())
      .filter(({ relativePath, skillName }) => {
        const skillDir = relativePath.split('/')[0];
        const markdown = readFileSync(join(process.cwd(), 'skills', relativePath), 'utf8');
        const frontmatterName = extractSkillFrontmatterName(markdown, skillDir);

        return skillName !== frontmatterName;
      })
      .map(({ relativePath, skillName }) => `${relativePath}: ${skillName}`);

    expect(mismatchedRows).toEqual([]);
  });

  it('keeps the key files purpose column matching each skill frontmatter description', () => {
    const mismatchedRows = extractKeyFileRows(readSkillsAgentsDoc())
      .filter(({ relativePath, purpose }) => {
        const markdown = readFileSync(join(process.cwd(), 'skills', relativePath), 'utf8');
        const frontmatterDescription = extractSkillFrontmatterDescription(markdown);

        return purpose !== frontmatterDescription;
      })
      .map(({ relativePath, purpose }) => `${relativePath}: ${purpose}`);

    expect(mismatchedRows).toEqual([]);
  });

  it('keeps the skill categories table covering every bundled skill', () => {
    const metadataByDir = listSkillInvocationMetadataByDir();
    const allowedSkillNames = new Set(Object.values(metadataByDir).flatMap((metadata) => metadata.allNames));
    const categorizedSkillNames = extractSkillCategoryNames(readSkillsAgentsDoc());
    const unknownSkillNames = categorizedSkillNames.filter((skillName) => !allowedSkillNames.has(skillName));
    const categorizedSkillDirs = categorizedSkillNames.flatMap((skillName) =>
      resolveCategorizedSkillName(skillName, metadataByDir),
    );
    const missingSkillDirs = listBundledSkillDirs()
      .filter((skillDir) => !categorizedSkillDirs.includes(skillDir))
      .sort();
    const duplicateSkillDirs = categorizedSkillDirs
      .filter((skillDir, index) => categorizedSkillDirs.indexOf(skillDir) !== index)
      .filter((skillDir, index, duplicateSkillDirs) => duplicateSkillDirs.indexOf(skillDir) === index)
      .sort();
    const ambiguousSkillNames = categorizedSkillNames
      .filter((skillName) => resolveCategorizedSkillName(skillName, metadataByDir).length > 1)
      .sort();
    const unresolvedAnnotations = categorizedSkillNames
      .filter((skillName) => /\([^)]*\)/.test(skillName))
      .sort();

    expect(unresolvedAnnotations).toEqual([]);
    expect(ambiguousSkillNames).toEqual([]);
    expect(duplicateSkillDirs).toEqual([]);
    expect(unknownSkillNames).toEqual([]);
    expect(missingSkillDirs).toEqual([]);
  });

  it('lists every skill with real frontmatter triggers in auto-activation docs', () => {
    const autoActivationSkillNames = extractAutoActivationSkillNames(readSkillsAgentsDoc());
    const missingTriggeredSkills = listBundledSkillDirs()
      .map((skillDir) => {
        const markdown = readFileSync(join(process.cwd(), 'skills', skillDir, 'SKILL.md'), 'utf8');
        const frontmatterName = extractSkillFrontmatterName(markdown, skillDir);
        const triggers = parseFrontmatterTriggers(markdown);

        return { frontmatterName, triggers };
      })
      .filter(({ frontmatterName, triggers }) => triggers.length > 0 && !autoActivationSkillNames.includes(frontmatterName))
      .map(({ frontmatterName, triggers }) => `${frontmatterName}: ${triggers.join(', ')}`)
      .sort();

    expect(missingTriggeredSkills).toEqual([]);
  });

  it('keeps category trigger keyword cells covering listed skill frontmatter triggers', () => {
    const metadataByDir = listSkillInvocationMetadataByDir();
    const missingCategoryTriggers = extractSkillCategoryRows(readSkillsAgentsDoc())
      .flatMap((row) =>
        row.skillNames.flatMap((skillName) =>
          resolveCategorizedSkillName(skillName, metadataByDir).flatMap((skillDir) => {
            const markdown = readFileSync(join(process.cwd(), 'skills', skillDir, 'SKILL.md'), 'utf8');
            const triggers = parseFrontmatterTriggers(markdown);

            return triggers
              .filter((trigger) => !row.triggerKeywords.includes(trigger))
              .map((trigger) => `${row.category}/${skillName}: ${trigger}`);
          }),
        ),
      )
      .sort();

    expect(missingCategoryTriggers).toEqual([]);
  });
});
