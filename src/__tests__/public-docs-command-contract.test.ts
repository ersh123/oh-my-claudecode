import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { listBuiltinSkillNames } from '../features/builtin-skills/skills.js';
import { KEYWORD_DETECTOR_PUBLIC_DOC_TRIGGER_EXAMPLES } from '../hooks/keyword-detector/index.js';

const removedNoteCommand = ['/oh-my-claudecode', 'note'].join(':');
const removedPublicCommandNames = ['omc-help', 'ralph-init'];

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

function containsRemovedCommandName(markdown: string, commandName: string): boolean {
  return new RegExp(
    `/oh-my-claudecode:${commandName}\\b|/${commandName}\\b|\\b${commandName}\\b`,
  ).test(markdown);
}

function listCommandWrapperNames(): string[] {
  return readdirSync(join(process.cwd(), 'commands'))
    .filter((fileName) => fileName.endsWith('.md'))
    .map((fileName) => fileName.replace(/\.md$/, ''));
}

function extractSeminarQuickrefKeyCommands(markdown: string): string[] {
  const keyCommandsSection = markdown.split('## Key Commands')[1]?.split('## Natural Language')[0] ?? '';

  return [...keyCommandsSection.matchAll(/\/oh-my-claudecode:([a-z0-9-]+)/g)].map((match) => match[1]);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractMarkdownSection(markdown: string, heading: string): string {
  const match = markdown.match(new RegExp(`^${escapeRegExp(heading)}\\s*$`, 'm'));

  if (match?.index === undefined) {
    return '';
  }

  const headingLevel = heading.match(/^#+/)?.[0].length ?? 1;
  const afterHeading = markdown.slice(match.index + match[0].length);
  const nextHeadingIndex = afterHeading.search(new RegExp(`\\n#{1,${headingLevel}}\\s+`));

  return nextHeadingIndex === -1 ? afterHeading : afterHeading.slice(0, nextHeadingIndex);
}

function isMarkdownTableSeparator(line: string): boolean {
  return /^\|\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function extractMarkdownTableAfterHeading(markdown: string, heading: string): string[][] {
  const sectionLines = extractMarkdownSection(markdown, heading).split('\n');
  const headerLineIndex = sectionLines.findIndex((line, index) =>
    line.trim().startsWith('|') && isMarkdownTableSeparator(sectionLines[index + 1]?.trim() ?? ''),
  );

  if (headerLineIndex === -1) {
    return [];
  }

  const rows: string[][] = [];

  for (const line of sectionLines.slice(headerLineIndex + 2)) {
    const trimmedLine = line.trim();

    if (!trimmedLine.startsWith('|')) {
      break;
    }

    rows.push(trimmedLine.replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim()));
  }

  return rows;
}

function extractQuotedCodePhrases(markdown: string): string[] {
  return [...markdown.matchAll(/`([^`]+)`/g)].map((match) => match[1]);
}

function formatPublicTriggerCell(skillName: keyof typeof KEYWORD_DETECTOR_PUBLIC_DOC_TRIGGER_EXAMPLES): string[] {
  return [...KEYWORD_DETECTOR_PUBLIC_DOC_TRIGGER_EXAMPLES[skillName]];
}

const referenceMagicKeywordEffectBySkill: Record<
  keyof typeof KEYWORD_DETECTOR_PUBLIC_DOC_TRIGGER_EXAMPLES,
  string
> = {
  cancel: 'Unified cancellation',
  ralph: 'Persistence until verified complete',
  autopilot: 'Full autonomous execution',
  ultrawork: 'Activates parallel agent orchestration',
  ccg: 'Claude-Codex-Gemini orchestration',
  ralplan: 'Iterative planning consensus',
  tdd: 'TDD workflow enforcement',
  'code-review': 'Comprehensive code review mode',
  'security-review': 'Security-focused review mode',
  ultrathink: 'Deep reasoning mode',
  deepsearch: 'Codebase-focused search mode',
  analyze: 'Deep analysis mode',
  'deep-interview': 'Deep Socratic interview',
};

const hooksAgentShortcutEffectBySkill = {
  tdd: 'TDD mode',
  'code-review': 'Code review mode',
  'security-review': 'Security review mode',
} as const satisfies Partial<Record<PublicDocSkillName, string>>;

const hooksReasoningEffectBySkill = {
  ultrathink: 'extended reasoning mode',
  deepsearch: 'codebase-focused search mode',
  analyze: 'deep analysis mode',
} as const satisfies Partial<Record<PublicDocSkillName, string>>;

const stalePublicTriggerExamples = [
  'build me a todo app',
  'build me a REST API',
  'autopilot build me a REST API',
  '"build me"',
  '"I want a"',
  '"ouroboros"',
  '"don\'t assume"',
  '"don\'t stop"',
  '- "stop" or "cancel"',
  'Just say "don\'t stop until done"',
  'Just say "fast" or "parallel"',
  'Just say "stop"',
  'Say "fast" or "parallel" OR use `ulw` keyword',
  '"fast: refactor the entire API layer"',
  '"fast, I\'m in a hurry"',
  '"I\'m in a hurry, go fast!"',
  '"fix all errors fast"',
  "'build me a...'",
  "'fast parallel'",
  "'don't stop'",
  'fast parallel fixes',
  'efficient batch fixes',
  'build me, create me, make me',
  'handle it all',
  'I want a/an...',
  'Natural language works:',
  'Natural language is first-class.',
  'describe what you want in natural language',
  'describe the goal naturally',
  'Natural language first',
  'Architecture: natural language',
  'works with natural language',
  'natural language first.',
  'natural language works fine',
  '| **Learning curve** | Command memorization | Natural language |',
  '`build me`',
  '`I want a`',
  '`handle it all`',
  '`end to end`',
  '`e2e this`',
  "`don't stop`",
  '`must complete`',
  '`until done`',
  '`uw`',
  '`think hard`',
  '`think deeply`',
  '`red green`',
  "don't stop until user auth is done",
  "don't stop until done",
  "don't stop until verified complete",
  "don't stop until this works",
  'say "stop", "cancel", or "abort"',
  'just say: "stop", "cancel", "abort"',
  'build me a hello world app',
];

type PublicDocSkillName = keyof typeof KEYWORD_DETECTOR_PUBLIC_DOC_TRIGGER_EXAMPLES;

const hooksExecutionKeywordSkills = [
  'cancel',
  'ralph',
  'autopilot',
  'ultrawork',
  'ccg',
  'ralplan',
  'deep-interview',
] as const satisfies readonly PublicDocSkillName[];

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
    const staleCommandNames = extractSeminarQuickrefKeyCommands(quickref).filter(
      (commandName) => !installedCommandNames.has(commandName),
    );

    expect(staleCommandNames).toEqual([]);
  });

  it('keeps HOOKS execution keyword rows aligned with runtime public trigger examples', () => {
    const hooksDoc = readFileSync(join(process.cwd(), 'docs/HOOKS.md'), 'utf8');
    const rowsBySkill = Object.fromEntries(
      extractMarkdownTableAfterHeading(hooksDoc, '### Execution Mode Keywords').map((row) => [
        row[1],
        extractQuotedCodePhrases(row[0]),
      ]),
    ) as Partial<Record<PublicDocSkillName, string[]>>;
    const missingRows = hooksExecutionKeywordSkills
      .filter((skillName) => !(skillName in rowsBySkill))
      .map((skillName) => `${skillName}: missing HOOKS execution keyword row`);
    const mismatchedRows = hooksExecutionKeywordSkills
      .filter(
        (skillName) =>
          skillName in rowsBySkill &&
          JSON.stringify(rowsBySkill[skillName]) !==
          JSON.stringify(formatPublicTriggerCell(skillName)),
      )
      .map(
        (skillName) =>
          `${skillName}: expected ${formatPublicTriggerCell(skillName).join(', ')}; documented ${(rowsBySkill[skillName] ?? []).join(', ')}`,
      );

    expect([...missingRows, ...mismatchedRows]).toEqual([]);
  });

  it('keeps HOOKS inline keyword rows aligned with runtime public trigger examples', () => {
    const hooksDoc = readFileSync(join(process.cwd(), 'docs/HOOKS.md'), 'utf8');
    const inlineKeywordRows = [
      ...extractMarkdownTableAfterHeading(hooksDoc, '### Agent Shortcut Keywords'),
      ...extractMarkdownTableAfterHeading(hooksDoc, '### Reasoning Enhancement Keywords'),
    ];
    const rowsBySkill = Object.fromEntries(
      [...Object.entries(hooksAgentShortcutEffectBySkill), ...Object.entries(hooksReasoningEffectBySkill)].flatMap(
        ([skillName, effectFragment]) => {
          const row = inlineKeywordRows.find((candidate) => candidate[1]?.includes(effectFragment));

          return row ? [[skillName, extractQuotedCodePhrases(row[0])]] : [];
        },
      ),
    ) as Partial<Record<PublicDocSkillName, string[]>>;
    const expectedSkillNames = [
      ...Object.keys(hooksAgentShortcutEffectBySkill),
      ...Object.keys(hooksReasoningEffectBySkill),
    ] as PublicDocSkillName[];
    const missingRows = expectedSkillNames
      .filter((skillName) => !(skillName in rowsBySkill))
      .map((skillName) => `${skillName}: missing HOOKS inline keyword row`);
    const mismatchedRows = expectedSkillNames
      .filter(
        (skillName) =>
          skillName in rowsBySkill &&
          JSON.stringify(rowsBySkill[skillName]) !== JSON.stringify(formatPublicTriggerCell(skillName)),
      )
      .map(
        (skillName) =>
          `${skillName}: expected ${formatPublicTriggerCell(skillName).join(', ')}; documented ${(rowsBySkill[skillName] ?? []).join(', ')}`,
      );

    expect([...missingRows, ...mismatchedRows]).toEqual([]);
  });

  it('keeps REFERENCE magic keyword rows aligned with runtime public trigger examples', () => {
    const referenceDoc = readFileSync(join(process.cwd(), 'docs/REFERENCE.md'), 'utf8');
    const magicKeywordRows = extractMarkdownTableAfterHeading(referenceDoc, '## Magic Keywords');
    const rowsBySkill = Object.fromEntries(
      Object.entries(referenceMagicKeywordEffectBySkill).flatMap(([skillName, effectFragment]) => {
        const row = magicKeywordRows.find((candidate) => candidate[1]?.includes(effectFragment));

        return row ? [[skillName, extractQuotedCodePhrases(row[0])]] : [];
      }),
    ) as Partial<Record<PublicDocSkillName, string[]>>;
    const missingRows = Object.keys(KEYWORD_DETECTOR_PUBLIC_DOC_TRIGGER_EXAMPLES)
      .filter((skillName) => !(skillName in rowsBySkill))
      .map((skillName) => `${skillName}: missing REFERENCE magic keyword row`);
    const mismatchedRows = Object.keys(KEYWORD_DETECTOR_PUBLIC_DOC_TRIGGER_EXAMPLES)
      .filter(
        (skillName) =>
          skillName in rowsBySkill &&
          JSON.stringify(rowsBySkill[skillName as PublicDocSkillName]) !==
          JSON.stringify(formatPublicTriggerCell(skillName as PublicDocSkillName)),
      )
      .map(
        (skillName) =>
          `${skillName}: expected ${formatPublicTriggerCell(skillName as PublicDocSkillName).join(', ')}; documented ${(rowsBySkill[skillName as PublicDocSkillName] ?? []).join(', ')}`,
      );

    expect([...missingRows, ...mismatchedRows]).toEqual([]);
  });

  it('does not advertise stale natural-language trigger examples as current public guidance', () => {
    const docsToCheck = [
      'docs/ARCHITECTURE.md',
      'docs/shared/mode-selection-guide.md',
      'docs/MIGRATION.md',
      'docs/GETTING-STARTED.md',
      'seminar/quickref.md',
      'seminar/notes.md',
      'seminar/slides.md',
      'seminar/demos/README.md',
      'seminar/demos/demo-0-live-audience.md',
      'seminar/demos/demo-1-autopilot.md',
      'seminar/demos/demo-2-ultrawork.md',
      'seminar/demos/demo-3-pipeline.md',
      'seminar/demos/demo-4-planning.md',
      'seminar/demos/demo-5-ralph.md',
      'seminar/screenshots/README.md',
      'skills/AGENTS.md',
      'skills/omc-setup/phases/04-welcome.md',
    ];
    const staleReferences = docsToCheck.flatMap((relativePath) => {
      const markdown = readFileSync(join(process.cwd(), relativePath), 'utf8').toLowerCase();

      return stalePublicTriggerExamples
        .filter((example) => markdown.includes(example.toLowerCase()))
        .map((example) => `${relativePath}: ${example}`);
    });

    expect(staleReferences).toEqual([]);
  });

  it('does not present legacy ultrapilot as current seminar guidance', () => {
    const docsToCheck = [
      'seminar/quickref.md',
      'seminar/notes.md',
      'seminar/slides.md',
      'seminar/demos/demo-1-autopilot.md',
    ];
    const staleReferences = docsToCheck.flatMap((relativePath) =>
      readFileSync(join(process.cwd(), relativePath), 'utf8')
        .split('\n')
        .flatMap((line, index) => (line.toLowerCase().includes('ultrapilot') ? [`${relativePath}:${index + 1}`] : [])),
    );

    expect(staleReferences).toEqual([]);
  });

  it('does not present legacy swarm as current seminar guidance', () => {
    const docsToCheck = [
      'seminar/quickref.md',
      'seminar/notes.md',
      'seminar/slides.md',
      'seminar/demos/demo-2-ultrawork.md',
    ];
    const staleReferences = docsToCheck.flatMap((relativePath) =>
      readFileSync(join(process.cwd(), relativePath), 'utf8')
        .split('\n')
        .flatMap((line, index) => (/\bswarm\b/i.test(line) ? [`${relativePath}:${index + 1}`] : [])),
    );

    expect(staleReferences).toEqual([]);
  });

  it('does not publish fixed eco savings figures as current seminar guidance', () => {
    const docsToCheck = ['seminar/notes.md', 'seminar/slides.md'];
    const fixedClaimPattern = /(?:\d{1,3}-\d{1,3}%|\d+%|~?\$\d+(?:\.\d+)?|\d+k tokens)/i;
    const malformedPlaceholderPattern = /\b(?:same task with\s*:|compare ultrawork vs\s+for)\b/i;
    const staleReferences = docsToCheck.flatMap((relativePath) => {
      let inEcoGuidance = false;

      return readFileSync(join(process.cwd(), relativePath), 'utf8')
        .split('\n')
        .flatMap((line, index) => {
          if (/^#{2,3}\s+Mode 5: Ecomode\b/i.test(line)) {
            inEcoGuidance = true;
          } else if (inEcoGuidance && /^#{1,3}\s+(?:Mode Comparison|Section 4|The Agent System)\b/i.test(line)) {
            inEcoGuidance = false;
          }

          const mentionsEco = /\beco(?:mode)?\b/i.test(line) || malformedPlaceholderPattern.test(line);
          const hasStaleClaim = fixedClaimPattern.test(line) || malformedPlaceholderPattern.test(line);

          return (inEcoGuidance || mentionsEco) && hasStaleClaim ? [`${relativePath}:${index + 1}`] : [];
        });
    });

    expect(staleReferences).toEqual([]);
  });

  it('does not document unsupported defaultExecutionMode config policy in public/setup docs', () => {
    const docsToCheck = [
      'docs/MIGRATION.md',
      'seminar/quickref.md',
      'seminar/slides.md',
      'skills/omc-setup/phases/02-configure.md',
    ];
    const staleReferences = docsToCheck.flatMap((relativePath) => {
      const markdown = readFileSync(join(process.cwd(), relativePath), 'utf8');

      return markdown.includes('defaultExecutionMode') ? [`${relativePath}: defaultExecutionMode`] : [];
    });

    expect(staleReferences).toEqual([]);
  });
});
