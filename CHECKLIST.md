# Harness checklist

Status: `[x]` shipped in the prototype, `[ ]` to build. Goal items marked shipped were read from `src/store.tsx`, `src/progress.ts`, `src/model.ts` and `DESIGN.md`.

## 1. Right panel (side pane), fully functional

Today: tabs for Preview (browser), Changes, Terminal, New tab; pop-out PiP (`src/SidePane.tsx`, `src/Browser.tsx`). Most of it is mocked.

### Panel shell
- [x] Browser-style tab strip, `+` new tab, close, active chip
- [x] Pop a Preview tab out to a PiP window
- [x] Drag tabs to reorder (Alt ← / → from the keyboard)
- [ ] Drag a tab out of the pane to make a split (ties into §3)
- [x] Pop any tab kind out, not just Preview
- [x] Tabs persist per thread across reloads
- [x] Cmd 1–9 / Ctrl Tab to switch pane tabs; Cmd W closes the active one
- [x] New-tab page lists every tab kind
- [ ] New-tab page lists detected ports and recent files (needs `term`, `files`)

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
- [ ] Annotate a screenshot (draw, arrow, note) before sending
- [x] Agent driving indicator (already designed: "driving" state) with take-over / give-back
- [x] Per-space browser profiles (cookies, logins isolated like spaces' accounts)
- [ ] Auto-reload on HMR / file change; keep scroll position (GAP: dev servers with HMR already reload; needs `fs` watch for the rest)
- [ ] Before / after compare: same URL on base branch vs thread branch, side by side or slider (GAP: needs the `git` worktree manager to serve the base branch)

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
- [ ] List booted / available simulators (`xcrun simctl list`), boot, shutdown
- [ ] Live stream of the simulator screen in a pane tab
- [ ] Tap, swipe, type, hardware buttons, rotate, deep link
- [ ] Build & run the thread's app into it; show build logs in a Terminal tab
- [ ] Screenshot / record into the composer, same as the browser
- [ ] Device picker (iPhone sizes, iPad), appearance toggle, Dynamic Type size
- [ ] Android emulator through the same tab (`adb`, `emulator`) — later

### Side chat
- [ ] A throwaway chat about the current thread that doesn't touch its goal or transcript ("why did it pick Redis?")
- [ ] Reads the thread's context; can be promoted to a real message or a new thread
- [ ] Ask about a selection (diff hunk, terminal output, file range)

### Diffs (Changes)
- [ ] Real git diff of the worktree vs base, file tree with `+/−`
- [ ] Unified / split view toggle, word-level highlighting (already on `@pierre/diffs`)
- [ ] Per-step diff: filter changes by the step that made them (uses `Step.footprint`)
- [ ] Stage / unstage / revert per file and per hunk
- [ ] Comment on a line → goes to the agent as a review note
- [ ] Commit, push, open PR from the tab; PR checks inline

### File preview / editor
- [ ] File tree for the worktree with search (Cmd P)
- [ ] Monaco or CodeMirror 6 editor: syntax highlight, find/replace, save, dirty state
- [ ] Image, SVG, PDF, Markdown (rendered), JSON tree previews
- [ ] Conflict warning when the agent edits a file you have open with unsaved changes
- [ ] "Open in VS Code / Cursor / Zed" escape hatch

## 2. Drag to pin threads

- [x] Pinned list exists in the sidebar; `reorder` action takes `pinned` / `unpinned` (`src/reorder.ts`)
- [x] Drag a thread row into the Pinned section to pin, out to unpin, within to reorder
- [x] Drop indicator line and a placeholder gap; auto-scroll near edges
- [x] Keyboard: Cmd Shift P pin/unpin, Alt ↑/↓ reorder
- [x] Pinned order drives Orbit slots, Stage Manager order (§3) and Cmd 1–9 jump (`pinnedThreads` in `src/reorder.ts` is the one order)
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
- [ ] Pinned threads show live state at a glance: progress ring, now-step, needs-you dot (already on rows; also on the Stage Manager cards)
- [x] Cmd 1–9 jumps to pinned N; Cmd Opt 1–9 opens pinned N in a new split
- [x] Hover a pinned thread → live peek (transcript tail + preview thumbnail) without switching
- [ ] Pinned thread can be "watched": notify on needs-you / done / CI fail even when not visible (watch toggle + in-app toast for needs-you / done done; OS notifications and CI fail wait for `notify`)

### Stage Manager mode
The main session (or split) sits centered; pinned sessions hover at both screen edges as 3D cards, sticking out slightly.

- [ ] Center stage: one session or a split group, scaled to ~85–90% width so the edge cards stay visible
- [ ] Edge cards in pinned order: pins before the current one on the left, after it on the right (a carousel, so position = order)
- [ ] Cards are rotated toward the center (`rotateY` ~35–50°), recede in depth, ~24–40px visible; the nearer one is larger
- [ ] Live thumbnails: a cheap snapshot (title, progress ring, now-step, last message, preview frame), not a live React tree per card
- [ ] Horizontal two-finger scroll / swipe moves 1:1 with the fingers; crossing a detent swaps the center; release snaps with a critically damped spring (reuse the model-picker carousel physics from `ModelControls.tsx`)
- [ ] Ctrl ← / → steps one card; no animation on keyboard nav (DESIGN.md rule) or a short one — decide
- [ ] Hover an edge card → it slides out further with a peek; click brings it center
- [ ] Drag an edge card into the center → opens it as a split beside the current session
- [ ] Needs-you cards pulse their amber dot and sort nearer the center (optional, setting)
- [ ] Group stacking: more than ~3 per side collapses into a stack with a count
- [ ] Portrait monitor: cards on top / bottom edges, vertical scroll switches
- [ ] Reduced motion: flat cards, crossfade only
- [ ] Exit back to normal layout keeps the current center as the active thread
- [ ] Performance budget: 60fps on scroll with 9 pinned; thumbnails throttled to ~1 fps

### Decided
- Stage Manager order is pinned order, not recency: positions never move (same rule as Orbit). The edge-card item above follows this.
- Unpinned running threads stay off stage; the Queue covers them.
- [ ] Multi-window: tear a split into its own OS window, one per monitor
- [ ] Mission-control overview (Cmd ↑): all sessions as a grid of live cards

## 4. Goal features (everything that exists, so nothing gets lost)

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
- [ ] Settled-goal archive with outcome summary, PRs, time spent, cost (outcome summary, PRs and time spent done in the summary panel; cost and a dedicated archive view open)

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

- [ ] **Notifications center + OS notifications** for needs-you, CI fail, PR review, race lost — with "jump to" and quiet hours.
- [ ] **Cost and usage per thread / space** next to context usage: tokens, $, plan limits remaining, rate-limit warnings before an agent stalls.
- [ ] **Checkpoints / rewind**: restore files and transcript to any step boundary (the timeline scrubber already picks the moment).
- [ ] **Worktree manager**: one worktree per thread, disk usage, clean up settled ones, sync with base.
- [ ] **Handoff between agents**: move a thread or a single step from Claude to Codex (or back) with the goal and context summary.
- [ ] **Command palette actions**, not just search: every action in the app reachable from Cmd K.
- [ ] **Thread forking**: fork at a message to try an alternative approach, then compare diffs and keep one (pairs with race).
- [ ] **Review mode**: walk all threads in `review` one after another — diff, preview, approve / request changes — like an inbox.
- [ ] **Scheduled and background threads**: run nightly, on a PR event, or on a cron; land in the Queue when done.
- [ ] **Shared / team spaces**: see teammates' threads on the metro board so overlaps catch cross-person duplication too.
- [ ] **Session recording / replay** of a thread for demos and debugging.
- [ ] **Voice**: dictate is designed; add push-to-talk global hotkey and spoken status ("Rate limiting is 60% done, waiting on you").
- [ ] **Mobile companion / Remote control**: answer Queue items from the phone.
- [ ] **Settings sync and import** of `CLAUDE.md`, MCP servers, skills per space.

## 7. Chat visualizations

Inline visuals in agent messages, like Claude's and Codex's. Fences: ```` ```chart ````, ```` ```svg ````, ```` ```html ````, ```` ```harness-burnup ````, ```` ```harness-metro ````, ```` ```harness-diff ```` (schemas in `src/viz/fence.ts`, examples in `src/viz/fixtures.ts`).

- [x] Re-enable Streamdown plugins: syntax-highlighted code, KaTeX math, Mermaid diagrams, CJK (lazy-loaded; artifact stays under 16 MB)
- [x] Charts from data in a message (recharts, already a dependency), using the thread line palette and both themes
- [x] Inline SVG / HTML widgets rendered in a sandboxed iframe (no access to the app, its storage or the network)
- [x] Interactive widgets can send a prompt back to the chat (like `sendPrompt`)
- [x] Tables: sortable, copy as CSV / Markdown
- [x] Image output: rendered with a lightbox, can be dropped into the composer
- [ ] Each visual: expand to a side-pane tab or PiP, copy, download (PNG / SVG / source). Copy, download and fullscreen done; side-pane tab and PiP wait for a visual tab kind in the pane registry
- [x] Streaming: placeholder while the code block is incomplete, render once it parses, show source on error instead of a broken frame
- [x] Theme-aware: re-render on light / dark switch; contrast checked in both (colours come from the theme tokens; no separate contrast measurement)
- [x] Harness-native visuals the agent can emit: burn-up chart, metro snippet of linked threads, diff summary card
