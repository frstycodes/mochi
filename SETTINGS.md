# Settings

A dedicated page, not a dialog, styled like Apple's System Settings. Opening it (⌘, / Ctrl+,, the profile menu, the palette) swaps the app sidebar for a settings sidebar in the same spot and width; the content column shows one section. "Back to app" at the bottom of the settings sidebar (and Esc) returns to the exact layout you left. The sidebar toggle stays where it is.

Every setting lives once in `src/settings/catalog.ts` (label, control, where its value lives, read and write); sections lay rows out in groups with their footers and render each row with `CatalogRow`, which the settings widget agents open in a thread renders too (RUNTIME.md › Mochi tools).

Sidebar: a search field (filters sections and individual settings by label), the sections below in three groups, "Back to app" at the bottom. Content: inset grouped lists (`SettingsGroup` / `SettingsRow` in `src/settings/parts.tsx`): rows on one card surface split by inset hairlines, label (and a short secondary line) left, control right, the explanation as a footnote under the group. A section scrolls on its own; deep links (`openSettings('git', 'branchPrefix')`) scroll to and flash the row.

Status: **now** = a value exists in code today (hardcoded or local state) and only needs wiring; **R1** = built by the runtime sessions; **later** = depends on unbuilt features, show nothing until then.

## App

### Account
Your Mochi account (Clerk), for linking computers (DEVICES.md); not a Claude or Codex login. Signed out: Sign in, which opens your browser (OAuth code + PKCE, loopback redirect, `electron/account/`). Signing in: Cancel. Signed in: avatar, name, email, Sign out (revokes the refresh token, best effort). The refresh token lives only in main, encrypted with `safeStorage`; the renderer gets `{ status, user, isPersistent }`. Linux without a secret service keeps the session for this run only and says so. Builds without a Clerk app say sign-in isn't set up (`MOCHI_CLERK_ISSUER`, `MOCHI_CLERK_CLIENT_ID`). Done.

### General
| Setting | Control | Default | Status | Today |
|---|---|---|---|---|
| Theme | Light / Dark / System | System | now | src/App.tsx:27, cycled from the sidebar |
| Color themes | the theme per appearance + Browse themes (opens Themes) | Mochi / Mochi | done | src/settings/sections/general.tsx |
| Reduce motion | System / On / Off | System | now | only per browser page (src/browser/Toolbar.tsx:263) |
| Projects folder | path + Browse | `~/dev` | now | src/ProjectPicker.tsx:96 |
| Open files in | Harness / VS Code / Cursor / Zed (only installed ones) | Harness | now | electron/fs/editors.ts:8 |
| Restore layout on launch | switch | on | now | src/store/layout.ts:61 |

### Themes
VS Code color themes, one per appearance like VS Code's preferred light and dark themes, so System keeps switching (`lightTheme` / `darkTheme` prefs; `mochi` is the built-in). `src/settings/sections/themes.tsx`. Done.

| Group | Rows |
|---|---|
| Color theme | Light, Dark: a select of Mochi plus the installed themes of that kind; the highlighted item previews live |
| Installed | every marketplace and custom theme: swatch, name, source and kind, Use / In use, Edit (custom), Uninstall or Delete (falls back to Mochi when in use); Custom theme: Import file (.json/.jsonc, `include` resolved next to it, inlined on import), Paste JSON (validated inline) |
| Open VSX | search over the Themes category, most downloaded first, only extensions whose package.json contributes color themes; icon, name, namespace, downloads, theme count, live swatches (each downloads the .vsix once it scrolls into view); hovering a row or swatch previews it, a swatch click installs and uses that theme, Install installs them all |

Hovering or focusing any theme repaints the app until the pointer leaves; picking is instant, persisted, no reload. Applying a light theme while Dark is forced switches to Light (and the reverse); under System it waits for the OS. Storage: desktop `userData/themes/<namespace>.<name>.json` (the themes already read out of the .vsix) and `userData/themes/custom/*.json` (Edit opens it in the OS's JSON editor, changes show on window focus); web build in localStorage. GAP: a theme whose `tokenColors` is a `.tmTheme` plist only recolours the UI, not code.

### Notifications
| Setting | Control | Default | Status | Today |
|---|---|---|---|---|
| System alerts when Harness is in the background | one switch per kind: needs you, review ready, CI failed, PR review, file overlap, race lost | all on | now | src/notify/model.ts:31 |
| Toasts for watched threads | switch | on | now | src/notify/useNotifications.ts:31 |
| Dock badge counts | Needs you / Off | Needs you | now | src/notify/useNotifications.ts |
| Quiet hours | switch + from/to | off, 22:00–08:00 | now | moved from NotificationBell.tsx:146 |
| Muted threads | list with Unmute | — | now | src/notify/slice.ts:21 |

### Keyboard
One keymap (`src/keymap.ts`): every app-level shortcut is a named command with a default chord and where it listens (global, inside a side pane, Queue and Review's lists); handlers ask `isCommand` / `commandOf` instead of matching keys, on `e.code` so any layout works. Rebound chords live in prefs (`keybindings`, only the changed ones, `''` = none) and apply live everywhere a chord shows (`<BoundShortcut>` / `useBinding`: palette, menus, tooltips, sidebar, Files, split menu, thread peek). Done.

| Part | Behaviour |
|---|---|
| Rows | Each command in its group (General, Threads, Splits, Side pane, Profiles, Lists) with its chord as caps, from the settings catalog (`keybinding.<id>`), so the agent's widget shows the same control |
| Record | Click the chord: the next chord pressed is taken (captured on `window` before every app shortcut); Esc cancels, Backspace removes the shortcut |
| Clash | Same chord where both listen (same scope, or one global): "⌘P is already used by Go to file" with Cancel, Replace (the other loses its shortcut) and Swap (it gets this one's old chord); nothing is saved until you choose |
| Reserved | Refused with the reason: ⌘Q, ⌘H, ⌥⌘H, ⌘M, ⌘Tab, ⌘`, ⌘Space, ⌃Space, ⌃←/→/↑/↓ (Mission Control), ⇧⌘3/4/5, ⌃⌘Q/Space/F on macOS; Alt Tab, Alt F4, Alt Space, Ctrl Alt Delete and the Windows key elsewhere; Copy, Paste, Cut, Select all, Undo, Redo everywhere; a chord without ⌘/⌃/⌥ (Ctrl/Alt) unless it ends in a letter, digit or F-key. Plain-letter chords never fire while typing |
| Reset | Per row (↺, asks again if another command took the default meanwhile) and Reset all (with Undo) |
| Fixed | Listed, not rebindable: composer Enter / Shift Enter, hold mod to queue or steer, ↑ to edit, hold Alt for Orbit, Esc, mod 1–9 inside a pane with tabs, Alt ↑/↓ on a pinned row, annotate undo/redo, viewer arrows, drift card 1–3, mod Enter in review notes, text editing, terminal and simulator keys |
| Agents | `get_keybindings` (read) and `set_keybinding(command, keys, onConflict?, reason)` (setting tier): the settings widget shows current → proposed (and the other command's row on a swap or replace), same reserved and clash checks; `update_settings` refuses `keybinding.*` keys |

Default on macOS for focusing a split by direction is ⌥⌘ + arrow (⌃ arrows belong to Mission Control); Alt + arrow elsewhere.

## Agents

### Harnesses
One section for every agent harness, rendered from the registry in `src/settings/harnesses.ts` (Claude Code and Codex today); a new harness is one registry entry plus its login check in `electron/settings/detect.ts`, never a new section. Per harness:

| Group | Rows | Status |
|---|---|---|
| Header | name, detected version and path, Check again; install command when missing | R1 (done) |
| — | Custom path, Default model (opus-5.5 / harness default) | R1 (done); model picker from src/ModelControls.tsx later |
| Accounts | each login in its own config folder (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`): name, folder, profiles using it, login state + plan, the sign-in command; add, rename, remove (not the default, not while a profile uses it). Harness never signs in | R1 (done) |
| Profiles | each profile's account for this harness; one account can serve several profiles | R1 (done) |
| API key | only for harnesses with one (`ANTHROPIC_API_KEY`), keychain, last 4 shown | R1 (done) |
| — | Starred models (the scroll dock), Default effort, Default speed (Standard / Fast: new threads run Fast on models that report a faster tier, standard elsewhere; agents can read it, never propose it) | now (src/ModelControls.tsx:32-33) |

### Defaults for new threads
| Setting | Control | Default | Status | Today |
|---|---|---|---|---|
| Agent | Claude Code / Codex | Claude Code | now | src/NewThreadView.tsx:37 |
| Permissions | Manual / Auto / Full access (Plan too in Claude threads; per-harness meaning in `src/runtime/access.ts`) | Auto | now | src/Composer.tsx |
| Runs on | This computer / each paired computer (shown once you've paired one; another computer's thread starts folderless there) | This computer | now | src/remote/RunsOnMenu.tsx |
| Agents running at once | stepper 1–16 | 6 | R1 | RUNTIME.md:91 |
| When a usage limit hits | Fixed: each harness's own behaviour (Claude Code waits and continues; Codex stops). Resume at reset, API key and handoff are per-thread choices on the limit card | — | done | RUNTIME.md › Usage limits |

### Background tasks
One model per task, each a picker over both harnesses' models (`src/settings/sections/background.tsx`): Thread titles, Commit messages, Pull requests, Goal steps, Handoff summaries. Default Haiku 5.5; a task falls back to Haiku 5.5, then GPT-6-Luna, then Mochi's own text (RUNTIME.md › Background tasks). Stored in agent settings (`utilityModels`), since main runs the calls. Done.

### Goals and drift
| Setting | Control | Default | Status | Today |
|---|---|---|---|---|
| Drift sensitivity for new threads | slider 5–40% | 15% | now | src/drift.ts:14 |
| Off-goal work branches from | Current branch / Base branch | Current | now | src/goals/DriftGuard.tsx:114 |
| New step size | S / M / L | M | now | src/runtime/apply.ts:73 |

### Devices
Let devices control this computer (the server, off by default), Allow devices on this network (LAN and Tailscale), Computer name, Reach this computer from anywhere (Mochi's relay; needs the account and the server on, shows the relay connection's state). Paired devices: each device this computer approved, connected or when it paired, its scopes as toggles (Read, Operate, Manage, Code, Terminal; a change ends its connections so the next runs under them), Remove (confirm; it pairs again with a new approval). Your other computers: your account's machines from the relay, online or not, Pair (a dialog with the code to compare, waiting for the other computer's approval, its refusal shown verbatim) or Forget. A device pairing through the relay shows "Allow <device>?" with the same code on this computer, wherever you are in the app (`DeviceApprovalLayer`). DEVICES.md › Pairing. Done.

## Workspace

### Profiles
One group per profile: name, icon, GitHub account, linked Claude and Codex accounts, its own browser session (Clear browsing data). Add (up to 9, one per ⌥ digit) / remove (only an empty profile; undo toast). Profiles live in `src/profiles.ts` (localStorage, seeded from `DEFAULT_SPACES`). Done. The GitHub account picks one of gh's own logins on any host (`gh auth status`; stored as `login`, or `host/login` off github.com). Push, PR creation and PR status run as that login: gh gets its token in `GH_TOKEN` (github.com, `*.ghe.com`) or `GH_ENTERPRISE_TOKEN` (Enterprise Server); push goes over HTTPS to origin's repo with the token from a credential helper reading the environment. Tokens come from gh's store in the main process, never in arguments or the renderer. Empty = gh's active account and your own git credentials. A repo on another host than the account is refused.

Per profile, Instructions / MCP servers / Skills / Import rows (`src/settings/ProfileAgentConfig.tsx`) read and write the linked accounts' own files, so the tools load them natively: Claude `CLAUDE.md`, `.claude.json` `mcpServers` (`~/.claude.json` for the default account), `settings.json` `deniedMcpServers` / `skillOverrides`; Codex `AGENTS.md`, `config.toml` `[mcp_servers.*]` `enabled` and `[[skills.config]]` (formats in `src/settings/agentConfig.ts`). Every write is a diff to review, backed up to `~/.harness/backups/<time>/` and refused if the file changed since. Import copies from the other harness or another profile; secret-looking env, header, arg and URL values become `${VAR}` and the row shows "Needs VAR". An account shared by several profiles shares its config. GAP: project `.mcp.json` servers are listed read-only, Codex project config isn't read.

### Schedules
Every thread's trigger in one list (`src/settings/sections/schedules.tsx`): name, when it runs and the next run, the last run's outcome; Run now, Pause / Resume, Edit (the schedule dialog), Delete. Triggers live in main (`schedules.json` in userData, `electron/schedule/scheduler.ts`), so they fire with every window closed while Mochi runs. Done. Notifications for finished runs are the "Scheduled run finished" alert in Notifications.

### Git
| Setting | Control | Default | Status | Today |
|---|---|---|---|---|
| Worktrees folder | path + Browse | `~/.harness/worktrees` | now | electron/git/run.ts:6 |
| Branch prefix | text | `harness/` | now | — |
| Open pull requests as drafts | switch | off | now | electron/ipc/git.ts:74 |
| Diffs | Unified / Split (Changes tab and work log) | Unified | now | src/pane/ChangesTab.tsx:36 |
| Prepare worktrees before starting | switch | on | done | electron/git/setup.ts (RUNTIME.md › Worktree setup) |
| Ignored files to copy | text, gitignore patterns, comma separated; the project's `.worktreeinclude` adds to them | `.env*` | done | electron/git/setup.ts |
| Setup command, per project folder | one text row per project your threads use; empty runs the project's `.mochi/setup.sh` | — | done | `setupCommands` in agent settings |
| Remove settled worktrees | Never / After 1, 7, 30 days | After 7 days | done | src/git/useWorktreeManager.ts |

### Terminal
| Setting | Control | Default | Status | Today |
|---|---|---|---|---|
| Shell | path | `$SHELL` | now | electron/pty/shell.ts:28 |
| Font size | stepper | 12 | now | src/terminal/sessions.ts:150 |
| Scrollback lines | stepper | 5000 | now | src/terminal/sessions.ts:152 |
| Restore terminals on launch | switch | on | now | src/terminal/sessions.ts:61 |

### Browser and devices
| Setting | Control | Default | Status | Today |
|---|---|---|---|---|
| Search engine | DuckDuckGo / Google / Bing / Kagi | DuckDuckGo | now | src/browser/url.ts:11 |
| Clear address history | button | — | now | src/browser/pages.ts:39 |
| Default simulator | device picker | first booted | now | src/pane/SimulatorTab.tsx:28 |

### Data
Show demo data (desktop only, off by default; the web build and the artifact always show it): the fixture threads, queue and profiles next to your own, unsaved, applied with a reload. Storage used, Clear pins / side chats / terminal history / everything (each with an undo toast where possible, a confirm only for "everything"). About: version, Electron/Chromium, links to RUNTIME and docs. now.
Replay: Record threads for replay (on by default; `recordReplays` in prefs) and Recordings, the threads recorded and their size on disk, cleared behind a confirm. now.

## Not settings
Internal caps and timings (patch size, poll intervals, animation durations, drift cut-offs, pin slots) stay constants. Usage budgets and prices come from the providers, not the user.
