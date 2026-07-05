import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
function listBundledSkillDirs() {
    return readdirSync(join(process.cwd(), 'skills'), { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();
}
function readSkillsAgentsDoc() {
    return readFileSync(join(process.cwd(), 'skills/AGENTS.md'), 'utf8');
}
function extractKeyFileSkillPaths(markdown) {
    const keyFilesSection = markdown.split('## Key Files')[1]?.split('## For AI Agents')[0] ?? '';
    return Array.from(keyFilesSection.matchAll(/`([^`]+\/SKILL\.md)`/g), (match) => match[1]).sort();
}
function extractKeyFileSkillDirs(markdown) {
    return extractKeyFileSkillPaths(markdown)
        .map((relativePath) => relativePath.split('/')[0])
        .sort();
}
function parseInlineAliases(markdown) {
    const aliases = markdown.match(/^aliases:\s*\[([^\]]*)\]/m)?.[1] ?? '';
    return aliases
        .split(',')
        .map((alias) => alias.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean);
}
function listSkillInvocationMetadataByDir() {
    return Object.fromEntries(listBundledSkillDirs().map((skillDir) => {
        const markdown = readFileSync(join(process.cwd(), 'skills', skillDir, 'SKILL.md'), 'utf8');
        const frontmatterName = markdown.match(/^name:\s*(.+)$/m)?.[1]?.trim() ?? skillDir;
        const primaryNames = Array.from(new Set([skillDir, frontmatterName]));
        const aliases = parseInlineAliases(markdown);
        return [skillDir, { aliases, allNames: Array.from(new Set([...primaryNames, ...aliases])), primaryNames }];
    }));
}
function extractSkillCategoryNames(markdown) {
    const categorySection = markdown.split('## Skill Categories')[1]?.split('## Auto-Activation')[0] ?? '';
    return categorySection
        .split('\n')
        .flatMap((line) => {
        const match = line.match(/^\|\s*[^|]+\s*\|\s*([^|]+?)\s*\|/);
        const skillCell = match?.[1]?.trim();
        if (!skillCell || skillCell === 'Skills' || /^-+$/.test(skillCell)) {
            return [];
        }
        return skillCell
            .split(',')
            .map((skillName) => skillName.trim())
            .filter(Boolean);
    })
        .sort();
}
function resolveCategorizedSkillName(skillName, metadataByDir) {
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
        const missingSkillDocs = extractKeyFileSkillPaths(readSkillsAgentsDoc()).filter((relativePath) => !existsSync(join(process.cwd(), 'skills', relativePath)));
        expect(missingSkillDocs).toEqual([]);
    });
    it('lists every bundled skill in the key files tables', () => {
        expect(extractKeyFileSkillDirs(readSkillsAgentsDoc())).toEqual(listBundledSkillDirs());
    });
    it('keeps the skill categories table covering every bundled skill', () => {
        const metadataByDir = listSkillInvocationMetadataByDir();
        const allowedSkillNames = new Set(Object.values(metadataByDir).flatMap((metadata) => metadata.allNames));
        const categorizedSkillNames = extractSkillCategoryNames(readSkillsAgentsDoc());
        const unknownSkillNames = categorizedSkillNames.filter((skillName) => !allowedSkillNames.has(skillName));
        const categorizedSkillDirs = categorizedSkillNames.flatMap((skillName) => resolveCategorizedSkillName(skillName, metadataByDir));
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
});
//# sourceMappingURL=skills-agents-docs-contract.test.js.map