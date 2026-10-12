# Settings

A dedicated page, not a dialog, styled like Apple's System Settings. Opening it (⌘, / Ctrl+,, the profile menu, the palette) swaps the app sidebar for a settings sidebar in the same spot and width; the content column shows one section. "Back to app" at the bottom of the settings sidebar (and Esc) returns to the exact layout you left. The sidebar toggle stays where it is.

Sidebar: a search field (filters sections and individual settings by label), the sections below in three groups, "Back to app" at the bottom. Content: inset grouped lists (`SettingsGroup` / `SettingsRow` in `src/settings/parts.tsx`): rows on one card surface split by inset hairlines, label (and a short secondary line) left, control right, the explanation as a footnote under the group. A section scrolls on its own; deep links (`openSettings('git', 'branchPrefix')`) scroll to and flash the row.

Status: **now** = a value exists in code today (hardcoded or local state) and only needs wiring; **R1** = built by the runtime sessions; **later** = depends on unbuilt features, show nothing until then.

## App

### General
| Setting | Control | Default | Status | Today |
|---|---|---|---|---|
| Theme | Light / Dark / System | System | now | src/App.tsx:27, cycled from the sidebar |
| Reduce motion | System / On / Off | System | now | only per browser page (src/browser/Toolbar.tsx:263) |
| Projects folder | path + Browse | `~/dev` | now | src/ProjectPicker.tsx:96 |
| Open files in | Harness / VS Code / Cursor / Zed (only installed ones) | Harness | now | electron/fs/editors.ts:8 |
| Restore layout on launch | switch | on | now | src/store/layout.ts:61 |

### Notifications
| Setting | Control | Default | Status | Today |
|---|---|---|---|---|
| System alerts when Harness is in the background | one switch per kind: needs you, review ready, CI failed, PR review, file overlap, race lost | all on | now | src/notify/model.ts:31 |
| Toasts for watched threads | switch | on | now | src/notify/useNotifications.ts:31 |
| Dock badge counts | Needs you / Off | Needs you | now | src/notify/useNotifications.ts |
| Quiet hours | switch + from/to | off, 22:00–08:00 | now | moved from NotificationBell.tsx:146 |
| Muted threads | list with Unmute | — | now | src/notify/slice.ts:21 |

### Keyboard
Read-only table of every shortcut from `src/palette/actions.ts`, grouped, rendered with `<Shortcut>`, searchable. Rebinding: later.

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
| — | Starred models (the scroll dock), Default effort | now (src/ModelControls.tsx:32-33) |

### Defaults for new threads
| Setting | Control | Default | Status | Today |
|---|---|---|---|---|
| Agent | Claude Code / Codex | Claude Code | now | src/NewThreadView.tsx:37 |
| Permissions | Ask first / Auto edit / Full access | Auto edit | now | src/Composer.tsx:136 |
| Runs on | This Mac / … | This Mac | now | src/Composer.tsx:137 |
| Agents running at once | stepper 1–16 | 6 | R1 | RUNTIME.md:91 |
| When a usage limit hits | Pause until reset (fixed copy; API key / handoff are per-thread choices) | — | R1 | RUNTIME.md Auth |

### Goals and drift
| Setting | Control | Default | Status | Today |
|---|---|---|---|---|
| Drift sensitivity for new threads | slider 5–40% | 15% | now | src/drift.ts:14 |
| Off-goal work branches from | Current branch / Base branch | Current | now | src/goals/DriftGuard.tsx:114 |
| New step size | S / M / L | M | now | src/runtime/apply.ts:73 |

## Workspace

### Profiles
One group per profile: name, icon, GitHub account, linked Claude and Codex accounts, its own browser session (Clear browsing data). Add (up to 9, one per ⌥ digit) / remove (only an empty profile; undo toast). Profiles live in `src/profiles.ts` (localStorage, seeded from `DEFAULT_SPACES`). Done. The GitHub account picks one of gh's own logins (`gh auth status`); PR creation and status run gh with that login's token (`GH_TOKEN`, read from gh, never sent to the renderer). Empty = gh's active account. GAP: pushing still uses your git credentials (SSH key or credential helper); github.com only.

### Git
| Setting | Control | Default | Status | Today |
|---|---|---|---|---|
| Worktrees folder | path + Browse | `~/.harness/worktrees` | now | electron/git/run.ts:6 |
| Branch prefix | text | `harness/` | now | — |
| Open pull requests as drafts | switch | off | now | electron/ipc/git.ts:74 |
| Diffs | Unified / Split (Changes tab and work log) | Unified | now | src/pane/ChangesTab.tsx:36 |

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
Storage used, Clear pins / side chats / terminal history / everything (each with an undo toast where possible, a confirm only for "everything"). About: version, Electron/Chromium, links to RUNTIME and docs. now.

## Not settings
Internal caps and timings (patch size, poll intervals, animation durations, drift cut-offs, pin slots) stay constants. Usage budgets and prices come from the providers, not the user.
