import { describe, expect, it } from 'vitest';
import { execFileSync } from 'child_process';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const PROJECT_ROOT = process.cwd();

function readProjectFile(...segments: string[]): string {
  return readFileSync(join(PROJECT_ROOT, ...segments), 'utf-8');
}

function listTopLevelHookTemplates(): string[] {
  const templatesDir = join(PROJECT_ROOT, 'templates', 'hooks');

  return readdirSync(templatesDir)
    .filter((filename) => filename.endsWith('.mjs'))
    .filter((filename) => statSync(join(templatesDir, filename)).isFile())
    .sort();
}

function extractSettingsJqFilter(uninstallScript: string): string {
  const match = uninstallScript.match(/\n\s+jq '\n([\s\S]*?)\n\s+' "\$SETTINGS_FILE"/);
  expect(match).not.toBeNull();
  return match?.[1] ?? '';
}

describe('uninstall script .mjs hook parity', () => {
  it('keeps uninstall cleanup aligned with current standalone hook templates', () => {
    const uninstallScript = readProjectFile('scripts', 'uninstall.sh');

    for (const filename of listTopLevelHookTemplates()) {
      expect(uninstallScript).toContain(`hooks/${filename}`);
      expect(uninstallScript).toContain(filename);
    }
  });

  it('removes OMC hook entries from settings without deleting third-party hooks', () => {
    const uninstallScript = readProjectFile('scripts', 'uninstall.sh');
    const filter = extractSettingsJqFilter(uninstallScript);
    const settings = {
      hooks: {
        UserPromptSubmit: [
          {
            matcher: '*',
            hooks: [
              { type: 'command', command: 'node /opt/vendor/third-party.js' },
              {
                type: 'command',
                command:
                  'node "$CLAUDE_PLUGIN_ROOT"/scripts/run.cjs "$CLAUDE_PLUGIN_ROOT"/scripts/keyword-detector.mjs',
              },
            ],
          },
        ],
        PostToolUse: [
          {
            matcher: '*',
            hooks: [
              {
                type: 'command',
                command:
                  'node "$CLAUDE_PLUGIN_ROOT"/scripts/run.cjs "$CLAUDE_PLUGIN_ROOT"/scripts/post-tool-rules-injector.mjs',
              },
            ],
          },
        ],
        Stop: [
          {
            matcher: '*',
            hooks: [
              {
                type: 'command',
                command:
                  'node "$CLAUDE_PLUGIN_ROOT"/scripts/run.cjs "$CLAUDE_PLUGIN_ROOT"/scripts/persistent-mode.mjs',
              },
            ],
          },
        ],
      },
    };

    const output = execFileSync('jq', [filter], {
      input: JSON.stringify(settings),
      encoding: 'utf-8',
    });
    const filtered = JSON.parse(output) as typeof settings;
    const commands = Object.values(filtered.hooks ?? {}).flatMap((entries) =>
      entries.flatMap((entry) => entry.hooks.map((hook) => hook.command)),
    );

    expect(commands).toEqual(['node /opt/vendor/third-party.js']);
  });
});
