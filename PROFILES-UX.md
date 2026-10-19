# Profiles: native items (UX, draft)

Mochi leaves Claude Code and Codex alone: it never writes, removes or uninstalls anything in `~/.claude`, `~/.claude.json`, `~/.codex`, `~/.agents` or a project's `.claude/` / `.agents/`. Inside Mochi, each profile can turn off any native skill, plugin, subagent, hook or MCP server. That affects Mochi sessions only. Mockups: design page (`#design`) › Profiles, in `src/design/sections/native-items.tsx`.

Status: the mockups and this feasibility matrix are done. Still to write: the full copy table, keyboard behaviour, search and filter rules, and how sync fits in later.

## Recommended layout (A)

- Native items sit on the existing Settings › Skills, Plugins and Connectors pages. Mochi's own library comes first, then one section per harness account: "From Claude Code · Work account". The profile you're in sorts its own accounts first. Subagents and hooks go on the Plugins page.
- Each native row keeps the profiles button that library items have, with labels for an on-by-default item: "On", "Off in Personal", "Off in 2 profiles", "Off in Mochi". The menu note reads: "Off in Mochi only. Still on in Claude Code. Applies to new threads." Profiles on another account show as disabled ("other account"). The ⋯ menu has Show in Finder, View source and Copy path; claude.ai connectors get Manage on claude.ai instead. Native items have no Remove.
- Row states:
  - on: no extra line;
  - off here: dimmed, with "Off in Mochi for X. Still on in Claude Code.";
  - can't be switched off: an "Always on" button that is disabled and has a tooltip with the reason;
  - new: a New badge;
  - broken: "Couldn't load: …" in the warning colour.
- Bulk actions: each section header has "Turn all off in <profile>", with an undo toast. Settings › Profiles › <profile> has, per harness, "Everything from <harness>" with Turn all off, and "New in <harness>" with two choices: Load them / Only what I add.
- In a thread: the Environment card shows a profile row ("Latitude · 18 loaded, 3 off") that opens what loaded, grouped by source. A warning dot means the profile changed after the thread started.
- Alternatives: B is a switch per item in Settings › Profiles. C is a matrix of items × profiles. Not recommended: B splits each item across two pages and goes against the rule that library items never get a per-profile switch; C is cramped past four profiles and on phones.

## Feasibility: skipping one native item in one session, without touching native files

Labels: RUN = ran in throwaway HOME, CLAUDE_CONFIG_DIR and CODEX_HOME folders against mock APIs; SRC = read in the SDK, CLI or schema; NO = not possible; NV = not verified. The login was kept in every RUN case.

| Item | Claude (Agent SDK) | Codex 0.163.0 (thread `config`) |
|---|---|---|
| Skill (user/project) | RUN: `settings.skillOverrides {name: "off"}`, removed from context | RUN: `skills.config [{name, enabled:false}]` |
| Plugin skill | RUN: the `skills` allowlist minus that skill (`skillOverrides` ignored) | RUN: same, with the name `plugin:skill` |
| Plugin | RUN: `settings.enabledPlugins {"p@mkt": false}` | RUN: `plugins.<p@mkt>.enabled=false` |
| Subagent | RUN: `disallowedTools ["Agent(name)"]`, removed from context | NO for one role (roles have no `enabled`); all via `features.multi_agent=false` |
| Hook | NO for one hook (flag-layer hooks merge); all via `disableAllHooks` | RUN: `hooks.state.<key>.enabled=false` (nested) |
| MCP server | RUN: `settings.deniedMcpServers [{serverName}]` (plugin server: `plugin:<p>:<srv>`); `.mcp.json`: `disabledMcpjsonServers` | RUN: `mcp_servers.<key>.enabled=false`; plugin server via `plugins.<p>.mcp_servers.<srv>.enabled=false` |
| Claude.ai / ChatGPT connectors | RUN: all off via `disableClaudeAiConnectors`. NV: one connector via `deniedMcpServers "claude.ai <Name>"` | SRC: `apps.<id>.enabled=false`, NV |

Ruled out: `toggleMcpServer` writes `.claude.json`; `settingSources` is too coarse (it drops whole layers, and all plugins with `user`). The UI therefore shows "Always on" with a reason for these: one Claude hook ("Claude Code always runs it. Mochi can turn off all hooks or the plugin it came from."), one Codex subagent, and one claude.ai or ChatGPT connector until checked against a real account. The fixtures currently lock only the claude.ai connectors.

## Open questions for the user

1. Subagents and hooks on the Plugins page, or a fourth page?
2. Project `.claude/` items: list them per known project on the library pages, or only in the thread's loaded list?
3. Allow switching off single parts of a native plugin, or only the whole plugin?
4. The existing per-account rows in Settings › Profiles (`ProfileAgentConfig.tsx`) write native files (`deniedMcpServers`, `skillOverrides`, `config.toml`). Should they be replaced by these Mochi-only settings?
