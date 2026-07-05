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
function listSkillInvocationNamesByDir() {
    return Object.fromEntries(listBundledSkillDirs().map((skillDir) => {
        const markdown = readFileSync(join(process.cwd(), 'skills', skillDir, 'SKILL.md'), 'utf8');
        const frontmatterName = markdown.match(/^name:\s*(.+)$/m)?.[1]?.trim() ?? skillDir;
        return [skillDir, Array.from(new Set([skillDir, frontmatterName, ...parseInlineAliases(markdown)]))];
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
            .map((skillName) => skillName.replace(/\([^)]*\)/g, '').trim())
            .filter(Boolean);
    })
        .sort();
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
        const namesByDir = listSkillInvocationNamesByDir();
        const allowedSkillNames = new Set(Object.values(namesByDir).flat());
        const categorizedSkillNames = extractSkillCategoryNames(readSkillsAgentsDoc());
        const unknownSkillNames = categorizedSkillNames.filter((skillName) => !allowedSkillNames.has(skillName));
        const missingSkillDirs = Object.entries(namesByDir)
            .filter(([, skillNames]) => !skillNames.some((skillName) => categorizedSkillNames.includes(skillName)))
            .map(([skillDir]) => skillDir);
        expect(unknownSkillNames).toEqual([]);
        expect(missingSkillDirs).toEqual([]);
    });
});
//# sourceMappingURL=skills-agents-docs-contract.test.js.map