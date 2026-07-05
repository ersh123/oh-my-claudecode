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
});
//# sourceMappingURL=skills-agents-docs-contract.test.js.map