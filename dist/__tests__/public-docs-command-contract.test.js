import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { listBuiltinSkillNames } from '../features/builtin-skills/skills.js';
const removedNoteCommand = ['/oh-my-claudecode', 'note'].join(':');
const removedPublicCommandNames = ['omc-help', 'ralph-init'];
function listMarkdownFiles(relativeRoot) {
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
function listUserFacingDocs() {
    return [
        'README.md',
        'skills/AGENTS.md',
        ...listMarkdownFiles('docs'),
        ...listMarkdownFiles('seminar'),
    ].filter((relativePath) => existsSync(join(process.cwd(), relativePath)));
}
function containsRemovedCommandName(markdown, commandName) {
    return new RegExp(`/oh-my-claudecode:${commandName}\\b|/${commandName}\\b|\\b${commandName}\\b`).test(markdown);
}
function listCommandWrapperNames() {
    return readdirSync(join(process.cwd(), 'commands'))
        .filter((fileName) => fileName.endsWith('.md'))
        .map((fileName) => fileName.replace(/\.md$/, ''));
}
function extractSeminarQuickrefKeyCommands(markdown) {
    const keyCommandsSection = markdown.split('## Key Commands')[1]?.split('## Natural Language')[0] ?? '';
    return [...keyCommandsSection.matchAll(/\/oh-my-claudecode:([a-z0-9-]+)/g)].map((match) => match[1]);
}
describe('public docs command contract', () => {
    it('does not advertise the removed note slash command', () => {
        const staleReferences = listUserFacingDocs().filter((relativePath) => readFileSync(join(process.cwd(), relativePath), 'utf8').includes(removedNoteCommand));
        expect(staleReferences).toEqual([]);
    });
    it('does not list the removed note skill in the skill inventory docs', () => {
        const skillInventory = readFileSync(join(process.cwd(), 'skills/AGENTS.md'), 'utf8');
        expect(skillInventory).not.toContain('`note/SKILL.md`');
        expect(skillInventory).not.toMatch(/\bnote,\s+cancel\b/);
    });
    it('does not advertise removed public slash command names', () => {
        const staleReferences = listUserFacingDocs().flatMap((relativePath) => {
            const markdown = readFileSync(join(process.cwd(), relativePath), 'utf8');
            return removedPublicCommandNames
                .filter((commandName) => containsRemovedCommandName(markdown, commandName))
                .map((commandName) => `${relativePath}: ${commandName}`);
        });
        expect(staleReferences).toEqual([]);
    });
    it('keeps seminar quickref key commands backed by bundled skills or wrappers', () => {
        const installedCommandNames = new Set([...listBuiltinSkillNames({ includeAliases: true }), ...listCommandWrapperNames()]);
        const quickref = readFileSync(join(process.cwd(), 'seminar/quickref.md'), 'utf8');
        const staleCommandNames = extractSeminarQuickrefKeyCommands(quickref).filter((commandName) => !installedCommandNames.has(commandName));
        expect(staleCommandNames).toEqual([]);
    });
});
//# sourceMappingURL=public-docs-command-contract.test.js.map