# Profiles: native items

Status: built for skills, plugins and MCP servers. Settings › Skills, Plugins and Connectors show each account's own items under "From Claude Code" / "From Codex", and Settings › Profiles has the "Claude Code and Codex" group. A profile's choices live on it (`Space.nativeOff`, `Space.nativeNew`). Each thread start sends the profile's off ids for its harness (`AgentStartOptions.nativeOff`, `src/runtime/controls.ts`); main resolves them against the account's config, the thread's project included (`readProfileConfig`), and applies `src/library/nativeOverrides.ts`: Claude's flag-layer `skillOverrides`, `enabledPlugins` and `deniedMcpServers` (by command or URL, so Mochi's own server of the same name stays), Codex's `skills.config`, `plugins.<id>.enabled` and `mcp_servers.<name>.enabled` (dropped when Mochi brings a server of that name). Checked 2026-10-20 with the exact output of that code in throwaway homes against Claude Code 2.1.303 and codex-cli 0.163.0: the turned-off skill, plugin (with its skill, agent and server), user server and project `.mcp.json` server left the model's request, everything else stayed, no native file changed. GAP: subagents, hooks and claude.ai connectors aren't read yet, so they have no rows; no New badge or "Only what I add" arrival until a seen-list exists; a Mochi library server imported from the same command as a turned-off native one is blocked with it in Claude.

Labels as in RUNTIME.md: **verified** = run or read here; **not verified** = check before building on it; **decision** = ours.

## The rule (decision, agreed with the user)

- Mochi never writes to, removes from or uninstalls anything in `~/.claude`, `~/.claude.json`, `~/.codex`, `~/.agents` or a project's `.claude/` / `.agents/`.
- Per profile, any native skill, plugin, subagent, hook or MCP server can be turned off. The change affects Mochi sessions only, and the UI always says so: "Off in Mochi only. Still on in Claude Code."
- Native items are on by default. They have no Remove or Update in Mochi.
- A profile's set is the native items it keeps on plus Mochi's library items it was handed. That set only exists in Mochi.

## Model

- A native item is identified by `harness · account · scope · name`. The scope is one of: account (`~/.claude`, `CODEX_HOME`, `~/.agents`), project (`<repo>/.claude`, `.agents`, `.mcp.json`), plugin (`name@marketplace`), or login (claude.ai connectors, ChatGPT apps).
- A profile stores only the ids it turned off, plus one setting per harness for items that appear later (decision). Storing the off set means a new native item is on by default with no write at all. "Only what I add" flips the default: an id first seen after the setting was chosen is recorded as off.
- Native items belong to an account, and each profile runs on one Claude account and one Codex account (RUNTIME.md, accounts per profile). Only profiles on that account load an item, so only they can turn it off. The UI shows the other profiles as disabled: "other account".
- Changes apply to new threads. A running session keeps the set it started with, like library updates do (LIBRARY.md Phase 3).

## Where it lives (decision: layout A)

- **Settings › Skills, Plugins, Connectors.** The Library tab gets one section per source. "In Mochi" comes first (today's list). Then one section per harness account, titled "From Claude Code" with the harness mark, plus "· Work account" when a harness has more than one account. The accounts the current profile runs on come first.
  - Skills page: skills.
  - Plugins page: plugins, subagents and hooks, each row naming its kind in the meta line.
  - Connectors page: MCP servers and login connectors.
  - A harness that isn't installed has no section.
- **Settings › Profiles › <profile>** gets a "Claude Code and Codex" section with rows per harness, from the harness registry:
  - "Everything from Claude Code" with Turn all off / Turn all on;
  - "New in Claude Code" with a Select: Load them / Only what I add;
  - the switches for what a harness can only drop as a group (below).
- **In a thread**, the summary's Environment card gets a profile row.
- Why A: every item has one home, the library already hands items to profiles with the same button, and the rule that library items never get a per-profile switch or a page-wide profile picker holds.
- Alternatives in the mockups:
  - **B**, a switch list per profile in Settings › Profiles. Every item ends up on two pages, and it goes against that rule.
  - **C**, a matrix of items × profiles. Clear for comparing, but cramped past four profiles and on phones. Worth keeping as a later "Compare profiles" view if people ask for one.

## Rows

Same anatomy as a library row: a 40px icon tile (the letter for native items with no icon), the name, the description, a meta line and one status line, then the profiles button and ⋯.

- **Meta line**: `<Kind> · <where>`. Examples: `Skill · ~/.claude/skills/ui`, `Skill · Project · latitude-api · .claude/skills/deploy`, `MCP server · ~/.claude.json · http · mcp.figma.com`, `Plugin · ponytail@ponytail · 6 skills, 2 hooks`.
- **Profiles button** (native items, which are on by default, so it names where the item is off):

  | State | Label | Icons |
  |---|---|---|
  | On in every profile on its account | On | none |
  | Off in one | Off in Personal | that profile's icon |
  | Off in several | Off in 2 profiles | up to 3 icons |
  | Off in all of them | Off in Mochi | the icons |

  The menu is titled "Load in these Mochi profiles", with one checkbox per profile and other accounts disabled ("other account"). It stays open while you tick. Its footer reads: "Off in Mochi only. Still on in Claude Code. Applies to new threads."
- **Status line per state** (one line at most; none when the item is simply on):

  | State | Look | Copy |
  |---|---|---|
  | On | — | — |
  | Off in the current profile | icon and name at 60% | Off in Mochi for Personal. Still on in Claude Code. |
  | Can't be switched off | lock icon, muted; the button is disabled ("Always on") with the reason in its tooltip | Always on in Mochi: Claude Code loads it in every session |
  | New | `New` badge after the name | New in Claude Code. On, because Personal loads new items. / New in Claude Code. Off, because Personal loads only what you add. |
  | Broken | warning colour, warning icon | Couldn't load: <the harness's own error, verbatim> |
  | On another account | — | the section footer says it once: "Personal runs on another Claude Code account, so none of these load there." |

- The New badge clears the next time the page is opened after it was first shown.
- **⋯ menu**: Show in Finder, View source (Mochi's file viewer), Copy path. Login connectors get "Manage on claude.ai" instead. There is never a Remove or Update.
- **Section footer**: "Read from ~/.claude, used by Personal and Liane. Turning one off leaves it out of Mochi threads only; Claude Code keeps loading it."

## Locked reasons (copy)

| Item | Tooltip |
|---|---|
| One Claude hook | Claude Code runs every hook in its settings. Mochi can turn off all hooks for a profile, or the plugin a hook came from, but not one hook. |
| One Codex subagent | Codex has no switch for one subagent. Mochi can turn off all Codex subagents for a profile. |
| One claude.ai connector (until verified) | Comes with your Claude.ai login. Mochi can turn off all Claude.ai connectors for a profile, not one yet. |

Group switches in Settings › Profiles. Each is on by default, with label and description:
- Hooks from Claude Code: "Claude Code can't skip one hook, so this turns off every hook in Mochi threads, plugins' included."
- Claude.ai connectors from Claude Code: "The connectors your Claude.ai login brings, like Gmail and Google Calendar."
- Subagents from Codex: "Codex can't skip one subagent, so this turns off all of them in Mochi threads."
- ChatGPT apps from Codex: "The apps your ChatGPT login brings."

When a group switch is off, its locked rows read "Off in Mochi for Personal: all Claude Code hooks are off" and keep the lock.

## Bulk actions and confirmations

- Every bulk change can be undone, so it gets an undo toast and no confirm dialog (decision; the craft rule is "undo beats confirm").
- Section header, ghost xs: "Turn all off in Personal" / "Turn all on in Personal". It shows only on sections the current profile can load, and skips locked items.
- Settings › Profiles: "Turn all off" / "Turn all on" per harness, covering all three pages.
- Toasts:
  - Off: "Turned off 3 Claude Code skills in Personal". Description: "Claude Code still loads them. New threads in Personal start without them." Action: Undo.
  - On: "Turned on 3 Claude Code skills in Personal". Description: "New threads in Personal load them again." Action: Undo.
  - All of a harness: "Turned off everything from Claude Code in Personal", same description.
- One item toggled in the profiles menu gets no toast: the button label changes in place.

## Search and filter

- The page's search (already on the right of Library | Discover) matches name, description and where, across every section. Each section keeps its heading; a section with nothing to show says "Nothing here matches". Esc clears the search.
- Filter chips under the tabs (a gapless ToggleGroup), shown only when native items exist: All / Off in <profile> / New / Problems. Picking a tab or clearing the search leaves the filter as it is.

## Switching and comparing profiles

- The pages have no profile picker. They follow the profile you're in (sidebar). Switching profile re-sorts the sections, and updates the dimming, the status lines, the "Turn all off in <profile>" label and the filter chip.
- Comparing happens in each row: the profiles button shows the icons of the profiles an item is off in. Settings › Profiles shows per-harness counts ("Default account · 9 items, 3 off in Mochi").
- A matrix view (C) is deferred.

## In a thread

- The Environment card gets a row: the profile's icon, then "Personal · 18 loaded, 3 off".
- It opens a popover titled "What this thread loaded", grouped as From Mochi / From Claude Code (or Codex) with counts and names, then "Off in Mochi for Personal · 3", then "Change what Personal loads", which opens Settings › Skills.
- Recorded at session start (`initializationResult()` for Claude; `skills/list` and the MCP status for Codex), so the list says what really loaded, not what the profile says now.
- If the profile changed after the thread started, a warning dot shows on the row, and the popover says: "Personal changed after this thread started. New threads get the new set."

## First run and empty states

- The first time native items appear on a page, a one-time Alert opens the harness section. Title: "Claude Code's own skills show here now". Body: "Mochi found 4 skills on your Default account. They stay on in every profile. Turning one off here only changes Mochi threads; Claude Code keeps loading it." Button: "Got it". It shows once per page.
- An installed harness with none of this kind keeps its section, with the empty row "Codex has no skills on this account".
- A harness that isn't installed has no section.
- An empty Mochi library keeps today's empty row ("No skills yet" + Discover skills).

## Keyboard

- No new shortcuts. Tab moves through each row's profiles button, then ⋯. Locked rows put their focusable "Always on" in the tab order so the reason is reachable as a tooltip.
- In the profiles menu: arrow keys move, Space or Enter toggles and keeps the menu open, Esc closes.
- Filter chips: arrow keys (ToggleGroup). Search: Esc clears.
- The thread's profile row is a button: Enter opens the popover, Esc closes it.

## Later: sync (out of scope, room left)

- Sync carries the profile's off set, its new-item settings and the library (with connector tokens, end-to-end encrypted). It never carries native items themselves: paths are per computer.
- On another computer, an off id that matches nothing does nothing. If the item shows up there later, it arrives off.
- Settings › Profiles leaves room for a "Sync this profile" row.

## Replaces

- The per-account rows in Settings › Profiles (`ProfileAgentConfig.tsx`: MCP servers, Skills, Import) write `deniedMcpServers`, `skillOverrides` and `config.toml` into the account's own files (SETTINGS.md). Under this rule they become read-only views or go away. Their switches move to the per-session overrides below.

## Feasibility: skipping one native item in one session

Checked 2026-10-19 with claude-agent-sdk 0.3.296 (Claude Code 2.1.303) and codex-cli 0.163.0. Everything ran in throwaway HOME, CLAUDE_CONFIG_DIR and CODEX_HOME folders, with model turns sent to local mock APIs that saved the first request. "Removed from context" means the item's name wasn't in that request. Every run hashed the native files: none changed. The login was kept in every run (verified with a fake `.credentials.json`; the macOS keychain path was not run).

Labels: RUN = verified by a run; SRC = verified by reading the SDK, CLI strings or Codex schema; NO = not possible; NV = not verified.

### Claude (Agent SDK options; `settings` = flag-layer settings)

| Item | Mechanism | Status | Effect |
|---|---|---|---|
| User or project skill | `settings.skillOverrides: { "<name>": "off" }` | RUN | Removed from context; a call is refused |
| Plugin skill | `skills: [every name but this one]` (allowlist, built from `initializationResult()`) | RUN | Removed; `skillOverrides` ignores plugin skills (RUN) |
| Skill | `disallowedTools` / `permissions.deny` `Skill(name)` | RUN | Call refused only; still listed |
| Plugin | `settings.enabledPlugins: { "p@mkt": false }` | RUN | Its skills, agents, server and hooks all leave |
| Subagent (user, project or plugin) | `disallowedTools: ["Agent(name)"]` (plugin: `Agent(p:name)`) | RUN | Removed from context; call refused |
| One hook | — | NO | Flag-layer `hooks` merge with the user's; settings have no per-hook key |
| All hooks | `settings.disableAllHooks: true` | RUN | None run |
| MCP server (user, local, project or plugin) | `settings.deniedMcpServers: [{ serverName }]` (plugin: `plugin:<p>:<srv>`) | RUN | Not connected, not in context |
| Project `.mcp.json` server | `settings.disabledMcpjsonServers: [name]` | RUN | Not connected |
| MCP server | `disallowedTools: ["mcp__<server>"]` | RUN | Out of context, but still connects |
| MCP server | `strictMcpConfig` + re-passing kept servers | RUN | Works but heavy: Mochi would copy every kept server |
| All claude.ai connectors | `settings.disableClaudeAiConnectors: true` or env `ENABLE_CLAUDEAI_MCP_SERVERS=false` | RUN (debug log) | Not fetched |
| One claude.ai connector | `deniedMcpServers: [{ serverName: "claude.ai <Name>" }]` | NV | RUN only for a proxy server passed explicitly, not one fetched from a real account |
| Ruled out | `toggleMcpServer` | RUN | Writes `projects[cwd].disabledMcpServers` into `.claude.json` |
| Ruled out | `settingSources` | RUN | Drops whole layers (`user` drops all plugins too) |

### Codex (`thread/start` `config`)

| Item | Mechanism | Status | Effect |
|---|---|---|---|
| Skill (CODEX_HOME, `~/.agents`, repo, plugin) | `skills.config: [{ name, enabled: false }]` or `{ path, enabled: false }`; plugin skill name `p:skill` | RUN | Removed from context (`skills/list` doesn't change per thread) |
| MCP server in config.toml | `mcp_servers.<key>.enabled = false` | RUN | Removed |
| A plugin's server | `plugins.<p@mkt>.mcp_servers.<srv>.enabled = false` | RUN | Removed; `mcp_servers.<srv>` fails `thread/start` |
| Plugin | `plugins.<p@mkt>.enabled = false` | RUN | Its skills and servers removed |
| One hook | `hooks.state.<key from hooks/list>.enabled = false` (nested, the key has dots) | RUN | Doesn't run; process-level `-c` had no effect |
| All hooks | `features.hooks = false` | RUN | None run |
| One subagent role | — | NO | Roles have no `enabled` field |
| All subagents | `features.multi_agent = false` | RUN | Agent tools and roles removed |
| One ChatGPT app | `apps.<id>.enabled = false` | SRC, NV | Needs a ChatGPT login |
| All ChatGPT apps | `features.apps = false` | SRC, NV | |

0.163.0 lists `plugin_hooks` as removed, so Codex plugins carry no hooks. The reproduction scripts (`run.mjs`, `cxrun.mjs`, mock APIs) were kept in the session's scratchpad, not in the repo.

## Open questions

1. Subagents and hooks on the Plugins page (as mocked), or a fourth page?
2. Project `.claude/` items: one sub-group per known project on the library pages (as mocked, in the meta line), or only in the thread's loaded list?
3. Turning off single parts of a native plugin: possible for its skills (allowlist), subagents and servers, but not its hooks. Offer it, or whole plugins only (as mocked)?
4. The per-account rows in Settings › Profiles that write native files: read-only, or removed?
5. "Only what I add": does it also hide new items from the New filter until you look, or only arrive off (as mocked)?
