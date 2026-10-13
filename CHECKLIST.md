# Mochi checklist

Status: `[x]` shipped in the prototype, `[ ]` to build. Goal items marked shipped were read from `src/store.tsx`, `src/progress.ts`, `src/model.ts` and `DESIGN.md`.

## 1. Right panel (side pane), fully functional

Today: tabs for Preview (browser), Changes, Terminal, New tab; pop-out PiP (`src/SidePane.tsx`, `src/Browser.tsx`). Most of it is mocked.

### Panel shell
- [x] Browser-style tab strip, `+` new tab, close, active chip
- [x] Pop a Preview tab out to a PiP window
- [x] Drag tabs to reorder (Alt ← / → from the keyboard)
- [x] Drag a tab out of the pane to make a split (ties into §3): over a split it previews the half it takes (a pane tab never replaces a split), the tab leaves the strip while it's a split, drag its title back onto the strip (or "Put back in the pane") to dock it, Esc cancels, a new tab says on hover it can't split. GAP: dropping on another thread's strip doesn't move a tab between threads
- [x] Pop any tab kind out, not just Preview
- [x] Tabs persist per thread across reloads
- [x] Cmd 1–9 / Ctrl Tab to switch pane tabs; Cmd W closes the active one
- [x] New-tab page lists every tab kind
- [x] New-tab page lists detected ports and recent files: running dev servers open in a Preview tab, recent files (work log reads and edits, files opened in a Files tab) open in a Files tab. GAP: files opened in a Files tab are remembered in memory only, so they drop off after a reload

### Browser
- [x] Real webview (Electron `WebContentsView` / Tauri webview), not a mock
- [x] Address bar with history, back / forward / reload, hard reload, zoom
- [x] Multiple browser tabs per thread
- [x] Device emulation: preset sizes, custom size, rotate, DPR, touch
- [x] Light / dark `prefers-color-scheme` toggle, reduced-motion toggle
- [x] DevTools: console, network, elements (or open native DevTools)
- [x] Console errors surface as a badge on the tab and can be sent to the agent
- [x] Element picker: click an element, send its selector + screenshot + outerHTML to the composer ("comment on page"). GAP: source location needs a dev-server plugin (React owner stack / sourcemaps)
- [x] Screenshot / full-page screenshot into the composer as an attachment. GAP: screen recording
- [x] Annotate a screenshot (draw, arrow, note) before sending: every capture opens in the pane's annotation editor (pen, arrow, box, note, undo/redo, five token colours, Esc cancels), "Add to composer" attaches the PNG with the marks baked in. GAP: notes render in the system font in the PNG (an SVG drawn as an image can't load the app's web font); no move/resize of a placed mark
- [x] Agent driving indicator (already designed: "driving" state) with take-over / give-back
- [x] Per-space browser profiles (cookies, logins isolated like spaces' accounts)
- [x] Auto-reload on HMR / file change; keep scroll position: toolbar toggle watches the thread's worktree (recursive `fs.watch`, 250ms debounce, skips node_modules/.git/build/cache dirs and editor temp files) and reloads when the dev server didn't hot-update or reload within 1.2s (read from its `[vite]`/`[HMR]`/`[Fast Refresh]` console lines); every reload of the same URL gets its scroll back. GAP: window scroll only, not inner scroll containers; macOS/Windows (`fs.watch` recursive)
- [x] Before / after compare: same URL on base branch vs thread branch, side by side or slider (More › Compare with base). Works for projects with a dev script (package.json `dev`, then `start`/`serve`/`preview`, else `.claude/launch.json`): reuses a server already running in the project folder when it's on the base, else checks the base out into a temporary worktree (borrowing the project's `node_modules`) and runs the script; closing stops it and removes the worktree. No dev script: the pane says so and the fallback is to run the base yourself and open it in a second tab. Side by side is live and scroll-synced; the slider compares full-page captures. GAP: one compare per thread; a base with different dependencies needs its own install; captures wait while Mochi's window is hidden

### Ports and previews
- [x] Detect listening ports from the thread's processes (lsof / netstat on the worktree's PIDs)
- [x] Ports list: port, process, command, uptime; open in pane, open in PiP, open in system browser, copy URL, kill
- [x] Run dev server from `package.json` scripts / `.claude/launch.json` with one click
- [x] Toast when a new port opens: "localhost:5173 is up — open preview"
- [x] Per-thread port isolation so parallel worktrees don't collide (auto-assign PORT)

### Terminal
- [x] Real PTY (xterm.js + node-pty), cwd = thread worktree
- [x] Multiple terminals per thread, split within the tab
- [x] Agent's commands mirrored read-only, user terminals separate (fed from the thread's tool activity until a real agent runtime streams output)
- [x] Select output → "Send to chat"; failing command → "Ask agent to fix"
- [x] Search, clickable file paths (open in editor tab) and URLs (open in browser tab)
- [x] Persist scrollback across reloads

### iOS simulator (and Android emulator)
- [x] List booted / available simulators (`xcrun simctl list`), boot, shutdown
- [x] Live stream of the simulator screen in a pane tab (framebuffer IOSurface via a Swift helper, ~56 FPS while moving)
- [x] Tap, swipe, type, hardware buttons (home, lock), deep link
- [ ] Rotate: GAP, no host-side API found (Purple GSEvent and Indigo device-motion attempts didn't rotate; Xcode 27 ships no Simulator.app to script)
- [x] Build & run the thread's app into it (first scheme, install + launch)
- [x] Build logs in a Terminal tab: the build streams into a read-only Build session of the thread's Terminal tab (opened in the background if there's none); the Simulator tab keeps a one-line status with Show log. GAP: xcodebuild still runs as a child process in the main process, mirrored line by line, not inside a pty
- [x] Screenshot / record into the composer, same as the browser (posted as the file path; GAP: chat entries can't carry attachments yet)
- [x] Device picker (iPhone sizes, iPad), appearance toggle, Dynamic Type size
- [ ] Android emulator through the same tab (`adb`, `emulator`) — later

### Side chat
- [x] A throwaway chat about the current thread that doesn't touch its goal or transcript ("why did it pick Redis?"); one per side chat tab, persisted, clearable
- [x] Reads the thread's context (goal, steps, recent activity, diff summary); can be promoted to a real message or a new thread (answers are a canned preview until `agent.ask` gets a real model)
- [x] Ask about a selection (diff hunk, terminal output, file range)

### Diffs (Changes)
- [x] Real git diff of the worktree vs base, file tree with `+/−`
- [x] Unified / split view toggle, word-level highlighting (already on `@pierre/diffs`)
- [x] Per-step diff: filter changes by the step that made them (uses `Step.footprint`)
- [x] Stage / unstage / revert per file and per hunk
- [x] Comment on a line → goes to the agent as a review note
- [x] Commit, push, open PR from the tab; PR checks inline (push and PR ask first; not yet run against a real remote)

### File preview / editor
- [x] File tree for the worktree with search (Cmd P)
- [x] Monaco or CodeMirror 6 editor: syntax highlight, find/replace, save, dirty state
- [x] Image, SVG, PDF, Markdown (rendered), JSON tree previews
- [x] Conflict warning when the agent edits a file you have open with unsaved changes
- [x] "Open in VS Code / Cursor / Zed" escape hatch

## 2. Drag to pin threads

- [x] Pinned list exists in the sidebar; `reorder` action takes `pinned` / `unpinned` (`src/reorder.ts`)
- [x] Drag a thread row into the Pinned section to pin, out to unpin, within to reorder
- [x] Drop indicator line and a placeholder gap; auto-scroll near edges
- [x] Keyboard: Cmd Shift P pin/unpin, Alt ↑/↓ reorder
- [x] Pinned order drives Orbit slots, the pinned pager's page order (§3) and Cmd 1–9 jump (`pinnedThreads` in `src/reorder.ts` is the one order)
- [x] Drag a thread onto a split drop zone to open it there (§3)

## 3. Multitasking

Principles: no assumed orientation (portrait monitors are first class), every layout reachable by keyboard and by drag, layouts are saved and named, the focused session is always obvious.

### Splits
- [x] Split any session horizontally or vertically; nest splits (tiling tree, not fixed 2-up)
- [x] Drop zones while dragging a thread or pane tab: left / right / top / bottom / center (replace)
- [x] Resize with handles; double-click equalizes; snap to 1/3, 1/2, 2/3
- [x] Auto orientation from aspect ratio: portrait window defaults to stacked (top/bottom), landscape to side-by-side; user override sticks
- [x] Each split has its own composer, header and side pane; side pane can also be shared across the split (panes are per thread; a pane tab dragged out becomes its own split)
- [x] Focus ring on the active split; Cmd [ / ] or Ctrl Arrow moves focus; Cmd Shift Enter maximizes one split (zoom) and back
- [x] Composer target follows focus; Cmd Enter in an unfocused split never sends there
- [x] Swap splits, rotate layout (H ↔ V), close split
- [x] Layout presets: 2-up, 3 columns, 2×2, main + stack, portrait stack of 3
- [x] Save layout as a workspace per space; restore on launch (one saved layout per space; named workspaces not yet)
- [x] Narrow split degrades gracefully: summary column folds into a sheet, side pane becomes a tab

### Pinned tabs, made useful
- [x] Pinned threads show live state at a glance: progress ring, now-step, needs-you dot (already on rows; also on the overview cards)
- [x] Cmd 1–9 jumps to pinned N; Cmd Opt 1–9 opens pinned N in a new split
- [x] Hover a pinned thread → live peek (transcript tail + preview thumbnail) without switching
- [x] Pinned thread can be "watched": notify on needs-you / done / CI fail even when not visible (main owns the OS notifications, CI polling and dock badge, so they keep working with every window closed: `electron/notify/watch.ts`; a CI failure lands in the Queue with "Send failing log to agent")

### Pinned pager (replaced Stage Manager, decided 2026-10-13)
Always on, no mode and no extra chrome: pinned threads sit side by side and the main chat slides between them.

- [x] Pinned threads are full-width pages of one native horizontal scroller in pin order; CSS `scroll-snap` (`snap-mandatory`, `snap-always`) stops each gesture at the next page, no JS spring (`src/pager/PinnedPager.tsx`)
- [x] Non-pinned views open as before; one sits on the page before pin 1 (or, when it's a pinned thread, at its own position). Other threads open in the focused split group leave the pager
- [x] Two-finger horizontal swipe moves 1:1 (native), at most one page per swipe (Chromium lets a long 1:1 swipe run past `snap-stop: always`, so the offset is held within a page of where the swipe started); haptic per detent like the model dock
- [x] Mouse press-and-drag on empty space pages 1:1 after a 6px axis lock, releasing to the next page by distance (half a page) or flick; never starts on text (selection keeps working) or controls, a vertical lock lets go, the click after a drag is swallowed (`useDragToSwipe`)
- [x] Cmd Shift [ / ] (Ctrl Shift on Windows/Linux) steps one pinned thread, instantly: macOS's own previous/next tab keys, since Ctrl ← / → belongs to Mission Control. Cmd 1–9 jumps to pinned N. Listed in Settings › Keyboard
- [x] Reduced motion: a drag release lands instantly
- [x] Every pinned page stays mounted (pins cap at five), keyed by thread, so landing flips a read-only preview to live without a remount and a quick run of swipes never shows an empty page; when the set changes the current page and its neighbours mount first, the rest in a background render. Threads that leave the pager remember their scroll (offset + row measurements)
- [x] Off-screen neighbours: `content-visibility: auto` (no style, layout or paint, shimmers paused); Mochi's frame loop stops while off screen
- [x] Long threads: the transcript is virtualized (`@tanstack/react-virtual`, `src/chat/Transcript.tsx`). 2,000 entries in a production build: mount 1.1 s → 0.18 s, remount 1.0 s → 0.09 s, DOM 38k → 0.3k nodes, heap +219 MB → +37 MB, scroll 45–49 → 60 fps
- [ ] Find in thread over virtualized rows (none exists yet; search the store's rows, then `scrollToIndex`)

### Decided
- Pager order is pinned order, not recency: positions never move (same rule as Orbit).
- Unpinned running threads stay off the pager; the Queue covers them.
- No ⌥1–9: on macOS it types characters into the composer (⌥5 is `[` on a German layout). Cmd 1–9 already jumps to pinned N.
- No Ctrl ← / →: macOS keeps Control-arrows for Mission Control, so the pager uses the system's previous/next tab keys, Cmd Shift [ / ].
- Portrait windows page horizontally too: vertical is the chat's own scroll axis (Stage Manager switched vertically there).
- [x] Multi-window: tear a split into its own OS window, one per monitor (split menu → Move to a new window; the main window's store is the only one, torn windows mirror it over `host.windows` broadcasts; web opens a tab at `#/window/<id>`)
- [x] Mission-control overview (Cmd ↑): all sessions as a grid of live cards

## 4. Goal features (everything that exists, so nothing gets lost)

Being replaced by §10 (decided 2026-10-13): step sizes, weighted progress, the ETA, title-based overlap and the version bump per step go away as §10 lands.

### Goal model
- [x] Each thread has a one-sentence goal and a list of steps
- [x] Step: title, size (1–3), status (done / running / ready / waiting / blocked / dropped), progress, footprint (files it touches), who added it, which revision
- [x] Goal revisions (v1, v2 …) with label, author and time; scope added mid-flight bumps the version and logs a harness event
- [x] Dropped steps keep a reason ("Dropped: tiers decision limits API keys only")
- [x] Steps start automatically in order; the next ready step runs when one finishes
- [x] Thread line color (chart-1…5) as identity for the goal across every view

### Progress and pace
- [x] Progress % from size-weighted steps (`progressAt`)
- [x] Burn-up series with a scope line (`burnSeries`) and sparkline in the summary
- [x] ETA / minutes left from pace (`minutesLeft`)
- [x] Now / waiting / next step rows in the summary
- [x] Floating goal timeline: burn-up and step rows on one time axis, scrubbable to any past moment (`statusAt`)
- [x] Context usage meter per thread

### Cross-thread goals
- [x] Overlap detection between threads' steps (title similarity + shared footprint files) → overlap item in the Queue
- [x] Four resolutions: link (depend on the other thread), extract (new shared thread both depend on), race (both try, first wins), related (just note it)
- [x] Dependencies: `provided-by` / `provides-for`; when the provider finishes, the dependent step completes with cherry-picked commits
- [x] Race: loser's step auto-drops as "Superseded"
- [x] Already-landed shortcut: if the other step is done, bring it in immediately
- [x] New thread can declare a dependency on another thread's step at creation
- [x] Metro board: one line per thread, stations per step, shared steps as interchanges, pending overlap as a dashed curve

### Attention and lifecycle
- [x] Needs-you status and amber dot; Queue ranks items by how many steps and threads they block (overlaps weigh more)
- [x] All steps done → review item in the Queue, thread goes to `review`
- [x] Settle / Reactivate a thread
- [x] Orbit: needs-you inner ring, pinned threads on fixed outer slots
- [x] Goal editing UI: rename goal, add / remove / reorder / resize steps by hand (each save is one revision)
- [x] Step-level approval gates ("pause before this step" → approval item in the Queue when reached)
- [x] Goal templates (e.g. "API endpoint", "migration") per space (fixtures, applied from the goal editor)
- [x] Goal history diff: what changed between v2 and v3
- [x] Acceptance criteria per step, checked by the agent (tests named, command to run); the check is simulated until the agent runtime exists
- [ ] Settled-goal archive with outcome summary, PRs, time spent, cost (outcome summary, PRs, time spent and cost done in the summary panel: cost is what Claude reports, Codex shows tokens since it reports no spend; a dedicated archive view open)

## 5. Drift guard (prompt deviates from the goal)

- [x] On send, score the prompt against the thread goal + open steps
  - Cheap first pass: reuse `similarity()` in `src/progress.ts` (token overlap) against goal and step titles and footprint paths
  - Ambiguous scores escalate to a small-model classifier: `on-goal` / `scope-add` / `off-goal`, with a one-line reason
- [x] `on-goal` → send as normal
- [x] `scope-add` → send and add a step (existing revision flow), show "Goal v3: +1 step" event
- [x] `off-goal` → inline card above the composer, not a modal:
  - "This looks unrelated to *Public API rate limiting*." Buttons: **New thread** (primary), **Continue here**, and **Add to goal**
  - New thread: prefilled with the prompt, same project, branch off the current one or base (choice remembered)
  - Continue here: send, mark the message as off-goal so it doesn't skew progress
- [x] Goal at 100% (or in `review`) and user picks New thread → settle the current thread (with its review item resolved or carried to the Queue), then create and open the new one; one undo toast for both
- [x] Never block: Enter again on the card = Continue here; Esc dismisses
- [x] Threshold and "don't ask again for this thread" setting
- [x] Log every decision as a harness event so the timeline shows where scope came from

## 6. Additions (accepted)

Ranked by how much they help running many agents at once.

- [x] **Notifications center + OS notifications** for needs-you, CI fail, PR review, race lost — with "jump to" and quiet hours. Derived in the `notifications` slice from store transitions (`src/notify/model.ts`); bell in the sidebar, OS notifications while the window is in the background, dock badge with the needs-you count in Electron. GAP: PR review requests come from new open PRs in the simulation, the real source is GitHub's review_requested event.
- [x] **Cost and usage per thread / space** next to context usage: tokens, $, plan limits remaining, rate-limit warnings before an agent stalls. Estimated from the simulation's activity log (`src/usage/model.ts`); GAP: real numbers come from `host.agent` and provider usage APIs, and `MODEL_PRICES` / `PLAN_LIMITS` are unverified placeholders.
- [x] **Checkpoints / rewind**: restore files and transcript to any step boundary (the timeline scrubber already picks the moment). A checkpoint per finished step (transcript and steps in the threads slice, files under `refs/harness/checkpoints/<thread>/<n>` once the thread has its own worktree); rewind from the scrubber, a step row or the thread menu, confirmed, one undo. GAP: seeded threads and threads in the project folder rewind the transcript only; files are saved just after the boundary until the agent runtime checkpoints itself.
- [x] **Turn changes card** like Claude Code's: under each finished turn that changed files (Claude and Codex), "Edited N files" with Undo and the total +/−, a row per file (file-type icon, dimmed directory, name opening the Files tab, +/− with the change bar) whose chevron opens its diff inline, the first 3 then "Show N more" (`src/chat/TurnChangesCard.tsx`, data from the work log's edits in `src/chat/turnChanges.ts`; Codex file changes now carry a per-file patch). Undo puts back only that turn's files from the checkpoint saved before its message (`git.restoreFiles`, transcript untouched), asks first when a later turn or you edited the same files, toasts with Undo, and is disabled while the agent works; a goal turn with a report lists its files in the report card instead. GAP: Bash-made edits aren't listed (like Claude's checkpoints); turns from before this shipped, seeded threads and project-folder threads can't undo; the agent isn't told its files went back
- [x] **Worktree manager**: one worktree per thread, disk usage, clean up settled ones, sync with base. Worktrees live in `~/.harness/worktrees/<repo>/<thread>`; GAP: threads carry a project name, not a folder, so every project still resolves to the app's cwd (`projectRoot` in `src/host/cwd.ts`).
- [x] **Worktree setup**: a new worktree is ready before the agent's first turn: ignored local files copied (`.env*` + `.worktreeinclude`), dependencies installed from the lockfile (pnpm reuses its store), the project's setup command run; a "Setting up worktree" row at the top of the thread with each step live, Retry / Skip setup / Open terminal on failure, Stop cancels it; settled threads' clean worktrees removed after 7 days (Settings › Git). RUNTIME.md › Worktree setup. GAP: a setup interrupted by quitting Mochi isn't run again
- [x] **Handoff between agents**: move a thread or a single step from Claude to Codex (or back) with the goal and context summary. Logged as a harness event, a goal revision and the editable summary; GAP: no `host.agent` runtime yet, so the handoff only changes `Thread.providers` and the step owner.
- [x] **Command palette actions**, not just search: every action in the app reachable from Cmd K. Registry in `src/palette/actions.ts` (one entry per action, `when` rules hide actions that would do nothing); rewind / fork / handoff add theirs when they land.
- [x] **Thread forking**: fork at a message to try an alternative approach, then compare diffs and keep one (pairs with race). Fork at any message or checkpoint from the thread menu or a step row; the fork gets its own branch and a worktree seeded from the checkpoint's files; Compare shows both branch diffs side by side and keeping one settles the other. GAP: no per-message fork button in the chat yet (the chat belongs to `viz`), the fork dialog lists the messages instead.
- [x] **Review mode**: walk all threads in `review` one after another — diff, preview, approve / request changes — like an inbox. From the sidebar, the Queue and Cmd K; J/K, Skip, Esc.
- [x] **Scheduled and background threads**: run nightly, on a PR event, or on a cron; land in the Queue when done. One trigger per thread, owned by main (`electron/schedule/scheduler.ts`, `schedules.json`): cron with presets (nightly, weekdays, hourly) and a preview of the next three runs (`src/schedule/cron.ts`, local time, DST-aware), or a PR event (opened, review requested, CI failed; branch pattern or label) polled through gh every 2 minutes. Runs go through the same `startAgent` as the renderer (concurrency cap, profile account, limit pauses), never overlap, and missed ones run once on launch or are skipped. A finished run is a `run` Queue item (Open, Settle), a notification and an entry in the thread's history; while no window is open, run and agent events wait in an outbox for the next one. Editor in the thread menu and the new-thread composer's clock (also Run in background); clock badge on sidebar rows; Settings › Schedules. GAP: with no window open, the OS notification waits until a window opens; a run that started while windows were closed replays its agent output when one opens, so a window opened mid-run can show that run's early output after its later output; PR polling uses the profile's GitHub account but not webhooks.
- [x] **PR status on thread rows + PR preview cards**: a sidebar row shows all its thread's PRs as overlapping Octicon discs coloured by live state, most-needs-you first (conflicts / failing checks / changes requested, then review requested, open, draft, merged, closed; `byAttention` in `src/chat/refs.ts`), at most 3 plus a "+N" disc (`src/git/PrStack.tsx`). Every PR reference (chat chips and links, the row discs, summary chips and rows, the ship bar, header badges, the new-tab page, Review, PR-review notifications) previews on hover (300ms) or keyboard focus in one card (`src/chat/RefHoverCard.tsx`): title, `owner/repo#n`, state, author and updated time, branch → base, +/− and files, checks, review, Open on GitHub; "+N" lists them all. State comes from the one batched gh GraphQL query (`refsQuery`, extended with author, branches, diff size, review decision, updated time) through the `useRefState` cache, no second fetch. GAP: a thread PR with no URL in a project with no GitHub origin shows only what the thread recorded (title, open/draft/merged)
- [ ] **Shared / team spaces**: see teammates' threads on the metro board so overlaps catch cross-person duplication too.
- [x] **Session recording / replay** of a thread for demos and debugging. Recording (`src/replay/recorder.ts`): every store action that changes one of your threads (raw agent events, plus your messages, answers and goal edits) is appended to `replays/<thread>.jsonl` in main's userData with its wall clock and app clock, after a base line holding the thread and its queue items; runs of message deltas fold into one line, each thread caps at 8 MB (a `capped` line ends the replay there), deleting a thread deletes its recording, Settings › Data turns it off and shows the size. Replay (thread menu, ⌘K): the steps run through the store's own thread and queue slices into a scratch store (`src/replay/rebuild.ts`, snapshots every 32 steps for scrubbing) and the real chat view renders it read-only; play/pause, 1×/2×/4×/8×, skip idle gaps (pauses over 3 s play as 0.6 s), a scrubbable timeline marking your messages, tool calls, file edits, approvals and errors, and the diff at that point from the nearest checkpoint whose files were saved (`git.checkpointDiff`), else the files touched so far; Space/K, ←/→ (Shift for markers), J/L, Home/End, Esc. Export replay writes the app's own single-file page with the recording and every checkpoint diff inlined as JSON, each string passed through the profile import's secret patterns (`redactSecrets`); opened anywhere, the page renders only the replay, with no network. Demo threads replay a script built from their transcript (`src/replay/demo.ts`). GAP: a recording starts with the thread's next action, so threads from before this shipped replay from then on; a new session writes a fresh base and the replay jumps over the restart; export needs the built app (the dev server's page isn't self-contained).
- [x] **Composer drafts**: the unsent text (skill tokens and argument slots are part of it), attachments and `@thread` / `@window` mentions are kept per thread, and the new-thread page's per profile with its model, effort, permission mode and project, across switching threads, Settings, closing the window and relaunch (`src/chat/drafts.ts`). Memory first so a switch restores at once; IndexedDB in userData behind a 400 ms debounce, attachments stored as Blobs (25 MB per draft, the rest stay in the composer only). Sending clears it; a deleted thread drops its draft; queued messages are untouched (a thread's model, effort and permissions already live on the thread)
- [ ] **Mobile companion / Remote control**: full remote control between your computers (macOS, Windows, Linux), Clerk account for pairing, relay, settings and pins sync; phone PWA later. Design: [DEVICES.md](DEVICES.md) (approved 2026-10-13).
- [x] **Model speed** where the model reports one: a Standard / Fast chip beside effort in the composer (only for models with a faster tier, named as the harness names them, each with the provider's price note), Settings › Harnesses › Default speed, kept per thread like model and effort. Claude: fast mode from `supportedModels()`'s `supportsFastMode`, started through the flag-settings layer (`settings: { fastMode: true }`, also the SDK's opt-in) and switched mid-session with `applyFlagSettings`; Codex: `model/list`'s `serviceTiers`, sent as `serviceTier` on `thread/start` / `turn/start`. Every message carries the thread's speed, so a change applies from the next one. Main drops a speed the running model doesn't list. GAP: Codex's `turn/start` `serviceTier: null` read as standard by analogy with `thread/start` (checked there, not on a logged-in turn); Claude Code's own messages say fast mode on a plan draws usage credits; the menu shows only the API price
- [ ] **Settings sync and import** of `CLAUDE.md`, MCP servers, skills per space. Built (SETTINGS.md, Workspace → Profiles); open until a new thread on a signed-in test account shows a profile-enabled server in its context panel on both providers.

- [x] **VS Code color themes**: every color theme on Open VSX plus custom ones, one per appearance (Light / Dark, so System keeps switching). Settings › Themes searches the Themes category (most downloaded first, only extensions that contribute color themes), shows live swatches, previews any theme on hover or menu highlight and applies it instantly, persisted, no reload. Main downloads the .vsix (25 MB cap) and reads only `extension/package.json` and the theme files it names plus their `include` chains (4 MB per file, 8 levels, paths escaping the package refused, nothing extracted or run; `src/themes/vsix.ts`, a ~60-line zip reader on `zlib`). Custom themes: import .json/.jsonc (includes resolved next to the file), paste JSON (validated), edit opens the file. Colors map onto Mochi's tokens with fallbacks from the editor background/foreground and text nudged to 4.5:1 (DESIGN.md › Color themes); token colors drive pierre diffs, markdown code blocks and the CodeMirror file viewer. GAP: `.tmTheme` token colors are skipped; semantic token colors are passed to shiki but CodeMirror only reads TextMate scopes.

## 7. Chat visualizations

Inline visuals in agent messages, like Claude's and Codex's. Fences: ```` ```chart ````, ```` ```svg ````, ```` ```html ````, ```` ```harness-burnup ````, ```` ```harness-metro ````, ```` ```harness-diff ```` (schemas in `src/viz/fence.ts`, examples in `src/viz/fixtures.ts`).

- [x] Re-enable Streamdown plugins: syntax-highlighted code, KaTeX math, Mermaid diagrams, CJK (lazy-loaded; artifact stays under 16 MB)
- [x] Charts from data in a message (recharts, already a dependency), using the thread line palette and both themes
- [x] Inline SVG / HTML widgets rendered in a sandboxed iframe (no access to the app, its storage or the network)
- [x] Interactive widgets can send a prompt back to the chat (like `sendPrompt`)
- [x] Tables: sortable, copy as CSV / Markdown
- [x] Image output: rendered with a lightbox, can be dropped into the composer
- [x] Each visual: expand to a side-pane tab or PiP, copy, download (PNG / SVG / source). The `visual` pane tab kind re-renders the fence; Pop out opens it as a floating tab
- [x] Streaming: placeholder while the code block is incomplete, render once it parses, show source on error instead of a broken frame
- [x] Theme-aware: re-render on light / dark switch; contrast checked in both (colours come from the theme tokens; no separate contrast measurement)
- [x] Mochi-native visuals the agent can emit: burn-up chart, metro snippet of linked threads, diff summary card

## 8. Viewers

- [x] Photo viewer for chat images and composer attachments: full window, gallery per thread (or per composer) with filmstrip and ←/→, zoom at the pointer (pinch, Ctrl-scroll, double-click, +/−, 0 to fit), drag to pan, copy as PNG, download (`src/photo/`)
- [x] File viewer for attachments and files in chat (code, Markdown, PDF, CSV, JSON), reusing the Files tab's previews

## 9. Accounts and limits

- [x] Account registry: each Claude Code / Codex login in its own config directory, signed in by you in the tool itself; Mochi never handles credentials
- [x] Each profile (space) links at most one Claude and one Codex account; one account can be linked to several profiles
- [x] Threads always run on their profile's account; never rotate to another account of the same provider
- [x] Limit reached: thread pauses with the reset time and resumes on the same account; one-click, explicit options to continue on your API key or hand off to the other provider
- [x] Usage limits relayed as each harness handles them: Claude Code's warning, extra usage, held turn and continue after the reset; Codex's stop with Resume / Resume at reset per thread; limit card in the transcript, header chip, sidebar line, composer note, ring arc, notification (RUNTIME.md › Usage limits)

## 10. Goals v2 (decided 2026-10-13)

Why goals exist: you run many threads (often one coordinator plus workers) and need, at a glance, what each is for, whether it's really done, what needs you, and whether the work was already done elsewhere, without reading transcripts. A ring that lies (0% while working) is worse than none.

### Goal model
- [ ] Not every thread has a goal: a task-shaped message gets one, questions and chats get none (no ring, no %, no Goal section in the summary; the header's summary pill shows a summary icon instead of the ring). A chat whose later message is task-shaped gets a goal then. "Make this a goal" / "Remove goal" override both ways
- [ ] The goal is drafted, never copied: the background-task model writes a short outcome plus 2 to 4 criteria from the message, applied silently; the goal card at the top of the thread has Edit. Drift no longer replaces the goal with your latest message (`setGoalFrom` goes)
- [ ] Criteria live on the goal, not on steps: checkable (a command, PR open, CI green) or judged (a sentence)
- [ ] A goal version is a change to what done means: only outcome or criteria edits (and rewind or fork restoring a different goal) bump it. Plan steps added, dropped or reordered (by the agent, a tool, drift or you), and handoffs, are timeline events, not versions
- [ ] Settling keeps a record: outcome, criteria with evidence, PR, files changed, time, cost. It is the memory for duplicate detection and the archive

### Overlap
- [ ] Duplicate work, checked when the goal is drafted (before the agent starts): the new outcome and criteria against active goals and settled records, word overlap to shortlist, the background model to judge same work / related / different. The goal card shows "Similar: <title>, settled 3 days ago, PR #61 merged" with Open / Continue there / Link / Ignore
- [ ] Collision, from real edits: two active threads editing the same file → overlap item in the Queue (existing link / extract / race / related). Replaces step-title matching in `holdOverlap`

### Report card
- [ ] When a goal thread ends a turn after doing work, a report card replaces reading the reply: criteria with status and evidence, "Needs you" (the one line that asks for anything), files changed with +/−, PR and its state; the agent's reply collapsed under "Full reply". Chats get none
- [ ] Facts come from Mochi (checks it ran, diff stats, PR); judgment (decisions, what's left, the question) from the agent's `report` tool, or extracted by the background model when the agent didn't call it, marked as summarised
- [ ] Mochi runs checkable criteria itself in the thread's worktree when the agent claims one or goes idle; judged criteria read "claimed" until you accept them. All criteria green → Ready for review
- [ ] The sidebar card's detail line is the report's headline (Ready for review, Needs you: …, Docs not done)
- [ ] `get_report` for coordinator threads: criteria, files, open question as data
- [ ] Ready for review is a state, not a question: shown on the report card, the sidebar card's detail and the ring phase; no `review` item in the composer's questionnaire tray (`endTurn` in `src/runtime/apply.ts` stops queueing one), so the composer stays a normal prompt and your next message just continues the thread
- [ ] One honest primary action, "Mark done" (settles). A merge, when offered, is a separate "Merge #N" that runs `gh pr merge` as the profile's GitHub account, always confirmed (PR and merge method), destructive tier. PR state is never flipped locally (today `answer()` in `src/store/queue.ts` marks open PRs merged with no git call, and the button reads "Approve and merge")
- [ ] No "Open thread" inside the thread itself; only in the Queue (`ReviewActions` in `src/QueueView.tsx`, `src/Orbit.tsx`, `src/review/ReviewView.tsx`)
- [ ] Review uses a check/review icon, never the PR Octicon (that stays on PR chips)

### Progress
- [ ] The ring shows phase plus criteria met, not a percentage: Planning → Building → Verifying → Ready for review → Settled, Needs you / Blocked over any phase; derived from events Mochi sees, not the agent's self-report. Card text "Building · 1/3"
- [ ] The plan is a mirror of the agent's own checklist (shows what it's doing), with no sizes, weights or versions
- [ ] Remove step sizes (S/M/L), weighted progress, the ETA and the plan burn-up; the burn-up becomes a criteria timeline

### PRs
1. Goals: drafting, chats without a goal, summary without a goal, the version rule, the settled record
2. Duplicate check at drafting
3. Report card and verification, including the review rework (ready for review as a state, Mark done, a real confirmed Merge #N)
4. Collision from real edits
5. Phases on the ring; remove sizes, weighted progress, ETA

## 11. Git conventions, enforced (decided 2026-10-13)

Defaults; a repo's own `.github/pull_request_template.md`, commitlint config or branch pattern wins.

- [ ] Branch names from the goal: `type/short-slug` (`feat/per-key-overrides`), validated by `branchNameError`
- [ ] Commits checked by a `commit-msg` hook Mochi installs in its worktrees (plain git, every agent): Conventional `type(scope): subject`, subject ≤ 72 chars; rejected messages tell the agent why; tool attribution stripped when settings say none
- [ ] PR descriptions written by Mochi from the report card: the agent calls `open_pr` with a title and one line of why; body is What / Why / Checks / Screenshots with hard length limits. Raw `gh pr create` is denied for Claude (hook pointing at `open_pr`); for Codex, a PR that appears in the thread gets its body replaced with the template
- [ ] Before/after screenshots required when the diff touches UI files (`.tsx`, `.css`): captured through the browser pane on the base and the thread's branch; `open_pr` refuses without them

## 12. Simplify (decided 2026-10-13)

- [ ] Simplify action in a message's hover bar turns a long reply into bullets; optional auto-simplify of long replies once the thread is idle (off by default, word threshold)
- [ ] Animation: shimmer while the model works, then the prose blurs out as the block's height eases and bullets arrive with the chat's word reveal; Show original reverses it; reduced motion crossfades
- [ ] Code blocks, commands, file paths and PR links pass through verbatim; only prose is rewritten
- [ ] Runs on the background-task model (needs `feat/utility-models` merged)
- [ ] Settings › Simplify: model, length (Short ≤ 5 bullets / Detailed), "Put what needs me first", free-text rules, auto-simplify and threshold; changing rules marks stored simplifications stale
- [ ] Stored on the message (`simplified: { text, model, rulesHash, at }`) for display only: never sent to an agent, left out of fork seeding, handoff summaries and `get_thread`
