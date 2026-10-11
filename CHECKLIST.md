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
- [ ] Real webview (Electron `WebContentsView` / Tauri webview), not a mock
- [ ] Address bar with history, back / forward / reload, hard reload, zoom
- [ ] Multiple browser tabs per thread
- [ ] Device emulation: preset sizes, custom size, rotate, DPR, touch
- [ ] Light / dark `prefers-color-scheme` toggle, reduced-motion toggle
- [ ] DevTools: console, network, elements (or open native DevTools)
- [ ] Console errors surface as a badge on the tab and can be sent to the agent
- [ ] Element picker: click an element, send its selector + screenshot + source location to the chat ("comment on page")
- [ ] Screenshot / full-page screenshot / screen recording into the composer as an attachment
- [ ] Annotate a screenshot (draw, arrow, note) before sending
- [ ] Agent driving indicator (already designed: "driving" state) with take-over / give-back
- [ ] Per-space browser profiles (cookies, logins isolated like spaces' accounts)
- [ ] Auto-reload on HMR / file change; keep scroll position
- [ ] Before / after compare: same URL on base branch vs thread branch, side by side or slider

### Ports and previews
- [ ] Detect listening ports from the thread's processes (lsof / netstat on the worktree's PIDs)
- [ ] Ports list: port, process, command, uptime; open in pane, open in PiP, open in system browser, copy URL, kill
- [ ] Run dev server from `package.json` scripts / `.claude/launch.json` with one click
- [ ] Toast when a new port opens: "localhost:5173 is up — open preview"
- [ ] Per-thread port isolation so parallel worktrees don't collide (auto-assign PORT)

### Terminal
- [ ] Real PTY (xterm.js + node-pty), cwd = thread worktree
- [ ] Multiple terminals per thread, split within the tab
- [ ] Agent's commands mirrored read-only, user terminals separate
- [ ] Select output → "Send to chat"; failing command → "Ask agent to fix"
- [ ] Search, clickable file paths (open in editor tab) and URLs (open in browser tab)
- [ ] Persist scrollback across reloads

### iOS simulator (and Android emulator)
- [x] List booted / available simulators (`xcrun simctl list`), boot, shutdown
- [x] Live stream of the simulator screen in a pane tab (framebuffer IOSurface via a Swift helper, ~56 FPS while moving)
- [x] Tap, swipe, type, hardware buttons (home, lock), deep link
- [ ] Rotate: GAP, no host-side API found (Purple GSEvent and Indigo device-motion attempts didn't rotate; Xcode 27 ships no Simulator.app to script)
- [x] Build & run the thread's app into it (first scheme, install + launch)
- [ ] Build logs in a Terminal tab: GAP, shown inline in the Simulator tab until the `term` session's pty API lands
- [x] Screenshot / record into the composer, same as the browser (posted as the file path; GAP: chat entries can't carry attachments yet)
- [x] Device picker (iPhone sizes, iPad), appearance toggle, Dynamic Type size
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
- [ ] Drag a thread row into the Pinned section to pin, out to unpin, within to reorder
- [ ] Drop indicator line and a placeholder gap; auto-scroll near edges
- [ ] Keyboard: Cmd Shift P pin/unpin, Alt ↑/↓ reorder
- [ ] Pinned order drives Orbit slots, Stage Manager order (§3) and Cmd 1–9 jump
- [ ] Drag a thread onto a split drop zone to open it there (§3)

## 3. Multitasking

Principles: no assumed orientation (portrait monitors are first class), every layout reachable by keyboard and by drag, layouts are saved and named, the focused session is always obvious.

### Splits
- [ ] Split any session horizontally or vertically; nest splits (tiling tree, not fixed 2-up)
- [ ] Drop zones while dragging a thread or pane tab: left / right / top / bottom / center (replace)
- [ ] Resize with handles; double-click equalizes; snap to 1/3, 1/2, 2/3
- [ ] Auto orientation from aspect ratio: portrait window defaults to stacked (top/bottom), landscape to side-by-side; user override sticks
- [ ] Each split has its own composer, header and side pane; side pane can also be shared across the split
- [ ] Focus ring on the active split; Cmd [ / ] or Ctrl Arrow moves focus; Cmd Shift Enter maximizes one split (zoom) and back
- [ ] Composer target follows focus; Cmd Enter in an unfocused split never sends there
- [ ] Swap splits, rotate layout (H ↔ V), close split
- [ ] Layout presets: 2-up, 3 columns, 2×2, main + stack, portrait stack of 3
- [ ] Save layout as a workspace per space; restore on launch
- [ ] Narrow split degrades gracefully: summary column folds into a sheet, side pane becomes a tab

### Pinned tabs, made useful
- [ ] Pinned threads show live state at a glance: progress ring, now-step, needs-you dot (already on rows; also on the Stage Manager cards)
- [ ] Cmd 1–9 jumps to pinned N; Cmd Opt 1–9 opens pinned N in a new split
- [ ] Hover a pinned thread → live peek (transcript tail + preview thumbnail) without switching
- [ ] Pinned thread can be "watched": notify on needs-you / done / CI fail even when not visible

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
- [ ] Goal editing UI: rename goal, add / remove / reorder / resize steps by hand
- [ ] Step-level approval gates ("pause before this step")
- [ ] Goal templates (e.g. "API endpoint", "migration") per space
- [ ] Goal history diff: what changed between v2 and v3
- [ ] Acceptance criteria per step, checked by the agent (tests named, command to run)
- [ ] Settled-goal archive with outcome summary, PRs, time spent, cost

## 5. Drift guard (prompt deviates from the goal)

- [ ] On send, score the prompt against the thread goal + open steps
  - Cheap first pass: reuse `similarity()` in `src/progress.ts` (token overlap) against goal and step titles and footprint paths
  - Ambiguous scores escalate to a small-model classifier: `on-goal` / `scope-add` / `off-goal`, with a one-line reason
- [ ] `on-goal` → send as normal
- [ ] `scope-add` → send and add a step (existing revision flow), show "Goal v3: +1 step" event
- [ ] `off-goal` → inline card above the composer, not a modal:
  - "This looks unrelated to *Public API rate limiting*." Buttons: **New thread** (primary), **Continue here**, and **Add to goal**
  - New thread: prefilled with the prompt, same project, branch off the current one or base (choice remembered)
  - Continue here: send, mark the message as off-goal so it doesn't skew progress
- [ ] Goal at 100% (or in `review`) and user picks New thread → settle the current thread (with its review item resolved or carried to the Queue), then create and open the new one; one undo toast for both
- [ ] Never block: Enter again on the card = Continue here; Esc dismisses
- [ ] Threshold and "don't ask again for this thread" setting
- [ ] Log every decision as a harness event so the timeline shows where scope came from

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

Inline visuals in agent messages, like Claude's and Codex's. Streamdown's code, math, mermaid and CJK plugins are already dependencies but were dropped from the prototype (DESIGN.md, Known gaps).

- [ ] Re-enable Streamdown plugins: syntax-highlighted code, KaTeX math, Mermaid diagrams, CJK
- [ ] Charts from data in a message (recharts, already a dependency), using the thread line palette and both themes
- [ ] Inline SVG / HTML widgets rendered in a sandboxed iframe (no access to the app, its storage or the network)
- [ ] Interactive widgets can send a prompt back to the chat (like `sendPrompt`)
- [ ] Tables: sortable, copy as CSV / Markdown
- [ ] Image output: rendered with a lightbox, can be dropped into the composer
- [ ] Each visual: expand to a side-pane tab or PiP, copy, download (PNG / SVG / source)
- [ ] Streaming: placeholder while the code block is incomplete, render once it parses, show source on error instead of a broken frame
- [ ] Theme-aware: re-render on light / dark switch; contrast checked in both
- [ ] Harness-native visuals the agent can emit: burn-up chart, metro snippet of linked threads, diff summary card
