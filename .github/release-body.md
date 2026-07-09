# oh-my-claudecode v4.15.3: keyword, hook, plugin-cache, and TypeScript LSP fixes

## Release Notes

Patch release after v4.15.2 focused on reducing false workflow activation, repairing hook/plugin-cache edge cases, improving HUD payload estimates, and adding native TypeScript 7 LSP support.

### Highlights

- Add native TypeScript 7 server support for LSP workflows (#3405).
- Add disabled keyword config support and stop Ralph from false-firing on proper nouns / identifiers (#3435).
- Fix plugin cache self-realpath exclusion and hook prune safety (#3432, #3430).
- Fix persistent-mode Stop hook watchdog and prompt hook timeout preemption (#3434, #3428).
- Fix project-memory command harvest, HUD payload estimates after compaction, MiniMax general-plan usage parsing, Thai informational keyword prompts, and multi-line CRLF rule-array parsing (#3426, #3424, #3420, #3410, #3415).
- Deploy hook libs before entrypoints and mark unmatched subagent stop telemetry correctly (#3407, #3417).

### Install / Update

The npm CLI and the Claude Code marketplace/plugin are separate install tracks, not either/or replacements. Update whichever track you use; if you have both installed, update both. CLI-dependent skill paths such as `ask`, `ccg`, and CLI-backed `team` require the `omc` CLI from the npm package.

**CLI / runtime:**

```bash
npm install -g oh-my-claude-sisyphus@4.15.3
```

**Claude Code plugin:**

```text
/plugin marketplace update omc
```

**Full Changelog**: https://github.com/Yeachan-Heo/oh-my-claudecode/compare/v4.15.2...v4.15.3

## Contributors

Thank you to all contributors who made this release possible!

@Yeachan-Heo @qitiandashenggogogo
