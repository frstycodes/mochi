# Settings

A dedicated page, not a dialog, Opening it (⌘, / Ctrl+,, the profile menu, the palette) swaps the app sidebar for a settings sidebar in the same spot and width; the content column shows one page under a large title. "Back to app" at the bottom of the settings sidebar (and Esc) returns to the exact layout you left. The sidebar toggle stays where it is.

Every setting lives once in `src/settings/catalog.ts` (label, control, where its value lives, read and write); sections lay rows out in groups with their footers and render each row with `CatalogRow`, which the settings widget agents open in a thread renders too (RUNTIME.md › Mochi tools).

Sidebar: a search field (filters pages and individual settings by label), the pages below in four groups (Mochi, Agents, Workspace, System), "Back to app" at the bottom. Content: a page title, then titled sections (`SettingsGroup` / `SettingsRow` in `src/settings/parts.tsx`): a heading over rows on one card surface split by inset hairlines, label and a one-line description left, control right, a footnote under the card only for caveats. Each catalog setting names its page (`section`) and its section heading (`group`); `get_settings` returns both. A page scrolls on its own; deep links (`openSettings('git', 'branchPrefix')`) scroll to and flash the row.

Status: **now** = a value exists in code today (hardcoded or local state) and only needs wiring; **R1** = built by the runtime sessions; **later** = depends on unbuilt features, show nothing until then.

## Mochi

### Account
Not a settings section: it lives in the sidebar's account menu (`src/UserMenu.tsx`). Your Mochi account (Clerk), for linking computers (DEVICES.md); not a Claude or Codex login. Signed out: Sign in, which opens your browser (OAuth code + PKCE, loopback redirect, `electron/account/`). Signing in: Cancel sign-in. Signed in: avatar, name, email, Manage account (Clerk's hosted Account Portal `/user` in your browser: profile, email, password, connected accounts, delete), Sign out (revokes the refresh token, best effort). The refresh token lives only in main, encrypted with `safeStorage`; the renderer gets `{ status, user, isPersistent }`. Linux without a secret service keeps the session for this run only and says so. Builds without a Clerk app (and the web build) show no account items. Done.

### General
| Section | Setting | Control | Default |
|---|---|---|---|
| New threads | Agent | Claude Code / Codex, each with its mark | Claude Code |
| New threads | Permissions | Manual / Auto / Full access (Plan too in Claude threads; per-harness meaning in `src/runtime/access.ts`) | Auto |
| New threads | While the agent is working, new messages | Queue / Steer | Queue |
| Running agents | Agents running at once | stepper 1–16 | 6 |
| Running agents | When a usage limit hits | Fixed: each harness's own behaviour; resume at reset, API key and handoff are per-thread choices on the limit card | — |
| Folders | Projects folder (Open folder starts here; clones and new projects land here) | path + Browse | `~/dev` |
| Startup | Restore layout on launch | switch | on |

Runs on (This computer / a paired computer) is chosen in the new-thread composer (`src/remote/RunsOnMenu.tsx`).

### Appearance
Mode: Theme (Light / Dark / System, with the user menu's sun, moon and monitor icons), Reduce motion (System / On / Off) and Translucent sidebar (macOS and Windows desktop only, on: vibrancy / Mica, electron/window.ts; off keeps the solid sidebar and its border).

VS Code color themes, one per appearance like VS Code's preferred light and dark themes, so System keeps switching (`lightTheme` / `darkTheme` prefs; `mochi` is the built-in). `src/settings/sections/appearance.tsx`, picker in `src/settings/ThemePicker.tsx`. Done.

| Section | What it holds |
|---|---|
| Color theme | Two cards, Light and Dark, each a tiny Mochi window painted in that appearance's theme ("On screen" on the one showing). A card opens the picker: search, then Starred, Built in, one group per installed package, Custom; only themes of that kind (high contrast included); the highlighted theme previews live and the list opens on the one in use. The settings widget in a thread uses the same picker |
| Themes › Library | One row per package (first theme's swatch, name, publisher, theme count, version, In use), opening to its themes (Use / In use, star, Edit and Delete for custom files); Mochi first, Custom last with Add theme (Import file: .json/.jsonc, `include` resolved next to it; Paste JSON, validated inline). ⋯ › Remove takes the whole package, falling back to Mochi where in use. From 5 packages, a filter narrows by package name or theme label (`filterPackages` in `src/themes/groups.ts`) |
| Themes › Marketplace | Open VSX search over the Themes category, most downloaded first, only extensions whose package.json contributes color themes; icon, name, namespace, downloads, theme count, live swatches (each downloads the .vsix once it scrolls into view); hovering a row or swatch previews it, a swatch click installs and uses that theme, Install installs them all |

Deep links open the right tab (`themeMarketplace` → Marketplace). Hovering or highlighting any theme repaints the app until the pointer leaves or the picker closes; picking is instant, persisted, no reload. Applying a light theme while Dark is forced switches to Light (and the reverse); under System it waits for the OS. Storage: desktop `userData/themes/<namespace>.<name>.json` (the themes already read out of the .vsix) and `userData/themes/custom/*.json` (Edit opens it in the OS's JSON editor, changes show on window focus); web build in localStorage. GAP: a theme whose `tokenColors` is a `.tmTheme` plist only recolours the UI, not code.

### Notifications
| Setting | Control | Default | Status | Today |
|---|---|---|---|---|
| System alerts when Harness is in the background | one switch per kind: needs you, review ready, CI failed, PR review, file overlap, race lost | all on | now | src/notify/model.ts:31 |
| Toasts for watched threads | switch | on | now | src/notify/useNotifications.ts:31 |
| Dock badge counts | Needs you / Off | Needs you | now | src/notify/useNotifications.ts |
| Quiet hours | switch + from/to | off, 22:00–08:00 | now | moved from NotificationBell.tsx:146 |
| Idle threads: notify when a thread you aren't looking at goes idle with gaps / a question / stalled / done | one switch each | gaps, question | now | src/notify/model.ts |
| Muted threads | list with Unmute; one line when there are none | — | now | src/notify/slice.ts:21 |

System alerts has Turn all off (any on) / Turn all on.

### Keyboard shortcuts
A filter on top: words match a command's title or group; Find by keys takes the next chord pressed and shows who holds it (or says it's free); Changed keeps your rebinds; Reset all.
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

### Profiles
One tab per profile (its icon and name), opening on the profile you're in, or the one a deep link names (`<profileId>-<row>`); adding a profile switches to it. Per profile: name, icon, GitHub account, linked Claude and Codex accounts, its own browser session (Clear browsing data). Add (up to 9, one per ⌥ digit) / remove (only an empty profile; undo toast). Profiles live in `src/profiles.ts` (localStorage, seeded from `DEFAULT_SPACES`). Done. The GitHub account picks one of gh's own logins on any host (`gh auth status`; stored as `login`, or `host/login` off github.com). Push, PR creation and PR status run as that login: gh gets its token in `GH_TOKEN` (github.com, `*.ghe.com`) or `GH_ENTERPRISE_TOKEN` (Enterprise Server); push goes over HTTPS to origin's repo with the token from a credential helper reading the environment. Tokens come from gh's store in the main process, never in arguments or the renderer. Empty = gh's active account and your own git credentials. A repo on another host than the account is refused.

Per profile, Instructions / MCP servers / Skills / Import rows (`src/settings/ProfileAgentConfig.tsx`) read and write the linked accounts' own files, so the tools load them natively: Claude `CLAUDE.md`, `.claude.json` `mcpServers` (`~/.claude.json` for the default account), `settings.json` `deniedMcpServers` / `skillOverrides`; Codex `AGENTS.md`, `config.toml` `[mcp_servers.*]` `enabled` and `[[skills.config]]` (formats in `src/settings/agentConfig.ts`). Every write is a diff to review, backed up to `~/.harness/backups/<time>/` and refused if the file changed since. Import copies from the other harness or another profile; secret-looking env, header, arg and URL values become `${VAR}` and the row shows "Needs VAR". An account shared by several profiles shares its config. GAP: project `.mcp.json` servers are listed read-only, Codex project config isn't read.

## Agents

### Harnesses
One tab per agent harness (its mark and name), rendered from the registry in `src/settings/harnesses.ts` (Claude Code and Codex today); deep links (`claudePath`) open their harness's tab; a new harness is one registry entry plus its login check in `electron/settings/detect.ts`, never a new section. Per harness:

| Group | Rows | Status |
|---|---|---|
| Header | name, detected version and path, Check again | R1 (done) |
| Not installed / Install | when missing, the install command and the custom path in one card; otherwise the custom path alone | done |
| Accounts | each login in its own config folder (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`): name, folder, profiles using it, login state + plan, the sign-in command; add, rename, remove (not the default, not while a profile uses it). Harness never signs in | R1 (done) |
| Profiles | each profile's account for this harness; one account can serve several profiles | R1 (done) |
| API key | only for harnesses with one (`ANTHROPIC_API_KEY`), keychain, last 4 shown | R1 (done) |

### Models
Every model choice in one place (`src/settings/sections/models.tsx`).

| Section | Rows |
|---|---|
| Composer | Starred models (the scroll dock), Default effort, Default speed (Standard / Fast: new threads run Fast on models that report a faster tier; agents can read it, never propose it) |
| Claude Code, Codex (one per harness, headed by its mark) | Default model, Second opinion model |
| Side chats | Side chat model |
| Background tasks | Model for every task (sets all of them at once; names the tasks that differ), with each task's own picker behind Choose per task, open while they differ or when a deep link names one. One model per task, each a picker over both harnesses' models: Thread titles, Commit messages, Pull requests, Goal steps, Handoff summaries. Default Haiku 5.5; a task falls back to Haiku 5.5, then GPT-6-Luna, then Mochi's own text (RUNTIME.md › Background tasks). Stored in agent settings (`utilityModels`), since main runs the calls. Done. |

### Goals and checks
Sections: Drift (Drift guard, Off-goal work branches from), Writing goals (Agent-proposed goals), When a thread goes idle (Run criterion checks), Before a pull request (Gaps when opening a pull request). The idle alerts live in Notifications.

| Setting | Control | Default | Status | Today |
|---|---|---|---|---|
| Drift sensitivity for new threads | slider 5–40% | 15% | now | src/drift.ts:14 |
| Off-goal work branches from | Current branch / Base branch | Current | now | src/goals/DriftGuard.tsx:114 |
| New step size | S / M / L | M | now | src/runtime/apply.ts:73 |

### Simplify
Style (Length, Put what needs you first, Your rules) and Automatic (Simplify long replies automatically, Long means more than). The model is Models › Background tasks.

### Mochi access
What agents can do: the agent-control level as three cards (Read only / Changes / Everything, each saying what it allows; the in-thread widget keeps the select). Threads agents start: Models for threads agents start. Both the user's alone. Tools: a filter, then every tool in its group (Threads, Goals and progress, Background agents, Reading the browser, Using the browser, Your screen, Reaching you, Settings and profiles), each with a plain name, its id, what it lets an agent do (`src/settings/toolGuide.ts`), and its own choice: Default (what the level gives it), Allow, Ask first or Off. Deletes offer only Ask first or Off, settings only Suggest or Off. Each group shows how many tools differ from the level and has Set all (Allow / Ask first / Off, skipping what a tool doesn't offer, or Follow the level). Enforcement: RUNTIME.md › Mochi tools. `src/settings/sections/access.tsx`. Done.

### Schedules
Empty: what a schedule is, where one starts, and New thread (the composer holds the clock). Every thread's trigger in one list (`src/settings/sections/schedules.tsx`): name, when it runs and the next run, the last run's outcome; Run now, Pause / Resume, Edit (the schedule dialog), Delete. Triggers live in main (`schedules.json` in userData, `electron/schedule/scheduler.ts`), so they fire with every window closed while Mochi runs. Done. Notifications for finished runs are the "Scheduled run finished" alert in Notifications.

## Workspace

### Git and worktrees
Sections: Worktrees (New threads work in, Worktrees folder, Remove settled worktrees), Worktree setup (Prepare worktrees, Ignored files to copy), Setup commands, Branches and pull requests (Branch prefix, Open as drafts), Changes (Diffs).

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
Sections: Shell (Shell, Restore terminals on launch) and Display (Font size, Scrollback lines).

| Setting | Control | Default | Status | Today |
|---|---|---|---|---|
| Shell | path | `$SHELL` | now | electron/pty/shell.ts:28 |
| Font size | stepper | 12 | now | src/terminal/sessions.ts:150 |
| Scrollback lines | stepper | 5000 | now | src/terminal/sessions.ts:152 |
| Restore terminals on launch | switch | on | now | src/terminal/sessions.ts:61 |

### Browser and simulator
| Setting | Control | Default | Status | Today |
|---|---|---|---|---|
| Search engine | DuckDuckGo / Google / Bing / Kagi | DuckDuckGo | now | src/browser/url.ts:11 |
| Clear address history | button | — | now | src/browser/pages.ts:39 |
| Default simulator | device picker | first booted | now | src/pane/SimulatorTab.tsx:28 |

## System

### Remote access
This computer: Let devices control this computer (the server, off by default), Allow devices on this network (LAN and Tailscale), Computer name, Reach this computer from anywhere (Mochi's relay; needs the account and the server on, shows the relay connection's state). Paired devices: each device this computer approved, connected or when it paired, its scopes as toggles (Read, Operate, Manage, Code, Terminal; a change ends its connections so the next runs under them), Remove (confirm; it pairs again with a new approval). Your other computers: your account's machines from the relay, online or not, Pair (a dialog with the code to compare, waiting for the other computer's approval, its refusal shown verbatim) or Forget. A device pairing through the relay shows "Allow <device>?" with the same code on this computer, wherever you are in the app (`DeviceApprovalLayer`). DEVICES.md › Pairing. Done.

### Data and storage
Stored on this computer: Storage used, Clear pins / side chats / terminal history (an undo toast where possible). Start over, last: Clear everything, behind a confirm. Developer: Show demo data (desktop only, off by default; the web build and the artifact always show it: the fixture threads, queue and profiles next to your own, unsaved, applied with a reload), Record threads for replay (on by default; `recordReplays` in prefs) and Replay recordings, the threads recorded and their size on disk, cleared behind a confirm. now.

### About
Versions (Mochi, Electron, Chromium) and links to the README, RUNTIME and SETTINGS docs (`src/settings/sections/about.tsx`).

## Not settings

### Projects page
Its own page in the app (sidebar › Projects, ⌘K › Go to Projects), not a Settings page, since projects are things you work in rather than preferences. The folders threads work in, per profile, kept by main in `userData/projects.json` (`electron/projects/registry.ts`): id, name, path, origin (the `origin` remote normalised by `normalizeOrigin` in `src/git/origin.ts`, the same project on every computer; null for a folder that isn't a repo) and when it was added. A profile's first load takes in, once, the folders it used before the registry (this window's recents and its threads' folders). Each row: an icon tile (the folder's favicon from the usual places: root, `public/`, `app/`, `static/`, `assets/`, `build/`; or an uploaded image kept in `userData/project-icons/`; or the letter; click it to choose), the name, origin with GitHub's mark, thread count and last use, the path; one ⋯ menu with New thread here, Show folder, Rename (the list's name, never the folder's), Relocate (a folder that moved; refused when the new folder is a clone of something else), Remove (from the list only, never from disk; undo toast). A folder that's gone shows "Folder not found" in the warning colour with Relocate… beside it. Add project opens the same flow as the project picker. Below, each other computer you follow that's online, its list read with `projects` and Add project running there. The same icon shows in thread rows, the picker and the composer's shortcuts. Done.

Add project, in the new-thread composer's project chip (bottom of the list) and here:

| Source | What happens |
|---|---|
| Open folder | The path field with Tab completion and Browse, as before |
| Clone from GitHub | `gh repo list` as the profile's GitHub login, searchable; a typed `owner/repo` clones any other. Cloned over HTTPS with the login's token from a credential helper (never in the URL or the repo's config), or `gh repo clone` when the profile has no login |
| Clone from a URL | Any https://, ssh:// or `git@host:path` remote, with your own git credentials (GitLab, Bitbucket and other hosts this way for now); options, `ext::` and local paths are refused before git runs |
| New project | `git init` in the projects folder; optionally Private or Public on GitHub through `gh repo create` (a failed publish keeps the local project and says so) |

Clones land in General › Projects folder under the repo's name, refused if that folder exists. Progress shows git's latest line; a failure shows git's own words. On another computer (Runs on) the same calls run there, in its projects folder, as its login; GitHub there takes a typed `owner/repo` (its repositories can't be listed from here) and its progress isn't streamed, only the outcome.

Internal caps and timings (patch size, poll intervals, animation durations, drift cut-offs, pin slots) stay constants. Usage budgets and prices come from the providers, not the user.
