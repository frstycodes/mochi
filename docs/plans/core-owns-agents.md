# Core owns agents

Status: steps 1–7 shipped (#509–#512 and the hidden-window fix); step 8 rejected; step 5 finished (see below). Claims marked **verified** were read in the repo on 2026-11-02; **believed** ones were not checked.

## The model

An action becomes agent calls in exactly one place: Core's `Commands.apply` (`packages/core/src/store/commands.ts`). Every
writer goes through it: this computer's windows, a paired device, the reactor, the scheduler, Mochi tools. It logs the
command, then folds the agent's lifecycle into the same log as it goes (`agent-starting` before a start, the retry after a
lost process, the failed turn), so every view folds the same events and shows the same thing. A window only folds, renders
and appends; it never calls `host.agent.*` to make a turn happen.

A browser tab belongs to the thread, on the thread's Core. Its page runs on that computer (Electron view when the app runs
there, Core's headless Chromium otherwise: the existing `browserView` capability). A view on the same computer attaches the
real view; any other view (another computer, a second window here) shows a CDP screencast of it and forwards input.

### Where it stands today (verified)

- Two deciders exist. The window's `storeDispatch` (`apps/desktop/src/store/index.tsx:268`) derives `agentCalls`, makes them
  through `host.agent.*`, dispatches `agent-starting`, retries a lost process (`resumeAfterLostProcess`), fails unsent turns,
  resolves answers, saves schedule triggers, retargets them, and clears OS notifications. Core's `Commands.apply` already
  derives and makes the same calls, resolves answers and fails unsent turns, but is used only by the reactor and by device
  store commands (`deviceCommand` in `packages/core/src/server.ts`). It never logs `agent-starting`, has no lost-process
  retry, and leaves `actedOn` as a GAP.
- Windows append commands with `events.append`, which is a raw `store.append` (`packages/core/src/store/handlers.ts:25`).
- Agents already run in Core; their events append to Core's log (`packages/core/src/agents/events.ts`). `heard()` clears
  `starting` on the first non-main agent event (`apps/desktop/src/runtime/apply.ts:300`).
- Scheduled runs start in Core, but their run and agent events go to a window, which applies them as commands; with no window
  open they wait for `drain` (`HarnessProvider` in `store/index.tsx`, `packages/core/src/schedule/scheduler.ts:82`).
  `autofix` is dispatched by the window so `agentCalls` sees it.
- Mochi tool calls go to a window (`agent:onToolCall` → `runTool` with `toolEnv(getState, dispatch)`); under `mochi serve`
  only browser tools run, in Core (`packages/core/src/browser/agentTools.ts`), a second implementation beside
  `apps/desktop/src/runtime/browserTools.ts`.
- Browser pages are window state: `pages.ts` keys them `threadId/tabId` in a module map; views live in main per window
  (`apps/desktop/electron/browser/views.ts`). Another computer's thread has no route to them.
- Device commands that aren't store commands (`create`, rewind, ship…) run in the owning computer's window via the `remote`
  capability (`inWindow`), and fail with "No interface is open on this computer" when none is.

### The stuck "Starting Claude Code" (not pinned)

Not verified: which path leaves `starting` set on the viewed thread. Step 1 ruled out the viewer's folds (verified,
`packages/core/src/store/commands.test.ts`): with the owner's log in window order (`create`, `agent-starting`, the agent's
first message), both another computer's replica (`createReplica` + `mirrorState`) and the saved-file mirror `useMachines`
shows (`applyFrame`) clear `starting`. What's left is the owner's log itself: a path that logs `agent-starting` after the
agent's first event, or never logs that event. Two writers (window appends, Core-logged agent events) racing on one
thread's lifecycle is the structural cause either way; steps 2–3 leave one writer.

### Model and effort on another computer's new thread (fixed in step 1)

Verified: the remote new-thread composer sent `controls` only when you had touched a picker (`...(picked && { controls })`
in `NewThreadView.tsx`), so the owner created the thread with `DEFAULT_CONTROLS` (account-default model, effort `high`)
while the composer showed something else. It now always sends what it shows, and the owner falls back to its own Settings
default model (`initialControls`) when an older device sends none. Still per computer: the composer's initial effort, speed
and access come from the viewing computer's prefs (`catalog` carries only default models).

## What moves

| Area                              | Change                                                                                                                                                                                                                                                                                                                                                                | Deleted                                                                                                                                                                                            |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Core `Commands.apply`             | Logs `agent-starting` (same serialized step, before the call); on `NO_AGENT_PROCESS` logs `agent-starting` and starts with `resumeAfterLostProcess`; logs failures; saves/removes/retargets schedule triggers (`scheduleCalls`, `retarget`); clears the addressed OS notification through the `notify` capability (`actedOn`).                                        | GAP comment on `actedOn`.                                                                                                                                                                          |
| Core store RPC                    | `events.append` of `type: 'command'` goes through `Commands.apply` (same `commandId` dedupe: a resend makes no second call). Raw appends of other types stay `local`.                                                                                                                                                                                                 | —                                                                                                                                                                                                  |
| Window store (`store/index.tsx`)  | `storeDispatch` = `withDispatchContext` → `recordAction` → `replica.dispatch`. Optimistic fold stays.                                                                                                                                                                                                                                                                 | `callAgent`, `pending`, `isLostProcess`, `failed`, retry block, `agent-starting` dispatches, `unsentTurns` call, `resolution` call, `scheduleCalls`/`host.schedule.*`, `retarget`, `actedOn` call. |
| Scheduler                         | Appends run and agent events to Core's log itself; `autofix` goes through `Commands.apply`.                                                                                                                                                                                                                                                                           | `HarnessProvider` schedule effect, `drain`/`keep` hand-back.                                                                                                                                       |
| Composer, sub-threads, compaction | No code change: their actions (`send`, `create`, `compact`, `subthread-wake`, tool-dispatched creates) already reach Core as commands and get Core's lifecycle. `compactGate` keeps reading `live.starting`, now Core-folded.                                                                                                                                         | —                                                                                                                                                                                                  |
| Mochi tools                       | `runTool` runs in Core with a Core `toolEnv` (`projection.current` + `Commands.apply`); the few that need a window's host go through capabilities. Browser tools: one implementation, Core's, on `browserView`.                                                                                                                                                       | `agent:onToolCall` window route, `pendingToolCalls`, `window-loaded` recovery, `runtime/browserTools.ts` duplicate.                                                                                |
| Browser                           | Tabs (id, url, title) folded on the thread in Core. Page on the owner via `browserView`. Local view attaches the `WebContentsView` by Core page id; other views get `browser.watch(pageId)` (CDP `Page.startScreencast` frames) and `browser.input` / `browser.navigate` RPCs over remote access. localhost resolves on the owner, where the agent's dev server runs. | Window-owned `pages` map as source of truth (stays as view cache).                                                                                                                                 |
| Remote viewer writes (last)       | `backends/remote.ts` appends to the other Core's `Commands.apply` with a per-action scope check, replacing store commands in `device.command`.                                                                                                                                                                                                                        | `readOnly` log, store-command half of `device.command`.                                                                                                                                            |
| Scopes                            | `visibleReplica`/`visibleItem` unchanged: lifecycle events are commands, so a `code` connection gets them live and others in snapshots. New RPCs classified in `CORE_SCOPES` (`scopes.test.ts` enforces it).                                                                                                                                                          | —                                                                                                                                                                                                  |

Multiple windows on one computer: no window does work any more, so `HarnessProvider` and `StoreProvider` converge; a
second window viewing a browser tab gets the screencast. Core restart: agents die with Core (verified, `Projection` doc);
`restoredDomain` clears `starting`; a command logged whose call never ran folds as a failed turn on restore, not resent.

## Order

Each step ships alone and leaves the app working.

1. **Repro.** Done: viewer folds pass. Also carries the remote model/effort fix.
   Steps 2–4 are done in the working tree (uncommitted):
   - `Commands.submit` logs a command and waits for it to fold (`Projection.foldedThrough`), so the next command reads the
     state it made; what it sets off runs in log order on its own queue, so a slow start never holds up logging.
     `apply` = `submit` + wait. Starts log `agent-starting` first; a lost process resumes; failures keep the agent's own
     message (the caller no longer wraps it as Effect's `UnknownError`); triggers are saved, removed and retargeted; the
     addressed OS notification is cleared through the `notify` capability.
   - `events.append` of a command goes through `Commands.submit`. The window's `storeDispatch` only folds and appends;
     the web build, which has no Core, acts on its own commands in `store/pageCommand.ts`.
   - Core's scheduler logs `schedule-run` (and `agent-starting`) itself; main appends `ci-result` and `autofix` to Core.
     The keep/drain outbox, `schedule.keep`, `host.schedule.drain`/`onEvent` and main's closed-window agent tap are gone.
2. **Lifecycle in `Commands.apply`.** `agent-starting`, lost-process retry, failures, schedule triggers, `actedOn`. Window
   unchanged. Fixes the reactor and device paths (queue sends, device `send` on a detached thread) on its own.
3. **Windows stop deciding.** `events.append` commands route through `Commands.apply`; strip `storeDispatch`. Fixes the
   cross-computer symptom if step 1 pins it on the window path.
4. **Scheduler logs directly.** Delete the window's schedule effect and `drain`.
5. **Tools split by owner (revised).** A survey of all 64 tools `runTool` handles: 27 need only state, dispatch, prefs
   and models, and some of those (`open_pane_tab`, `split_with`, `show_file`, `open_changes`, `close_pane`) change a
   window's layout, which Core doesn't hold. Every changed outcome also raises a toast with Undo through `record()`. So
   `runTool` can't simply move. Revised: the thread tools (list/get/rename/settle/reactivate/pin/unpin/reorder/watch,
   `settle_when_merged`, `move_to_project`, `create_thread`, `request_orchestration_grant`, `dismiss_thread_proposal`,
   `send_to_thread`, `delete_thread`, `report_turn`, `report_to_parent`, `update_plan`, `start_subagent`) run in Core
   on its projection and `Commands`; a window shows the toast and Undo when it folds a tool's command. Layout, browser,
   settings, connector and notification tools stay a window's; with none open they answer `NEEDS_APP`, as under
   `mochi serve` today.
   Done (uncommitted), as a first cut: Core runs those 18 tools (`CORE_TOOLS` in `packages/core/src/agents/coreTools.ts`)
   whenever no window can (no main, or main answers `NO_WINDOW`), with `runTool` on a replica of Core's own stream that
   appends through `Commands.submit`. With a window open the window still runs them, so its toast and Undo stay. Your
   agent-control level and per-tool policies joined the context Core keeps; until a window has sent them Core refuses.
   A call that would ask expires at once: approvals resolve in the window's process (`decideTool`), so nobody can answer
   one raised in Core. GAP: route every thread tool to Core once a window can show the toast and Undo from the folded
   command. Done: see "Step 5, finished" below.
   6–7. **Browser tabs on the thread, page on the owner (done, uncommitted).** A thread's browser tabs (id, url, title) fold on
   the thread (`browser-tab`, `browser-tab-close`). Core's `Browsers` (`packages/core/src/remote/browsers.ts`) opens a tab's
   page through `browserView` (`page.open`) and logs its url and title as it navigates. Main sends the events of a view Core
   opened back to Core (`relayView` in `electron/browser/views.ts`, `page.event`). The owner's window creates a thread tab's
   view through `page.open`, so its pane, its agent's browser tools and a paired device all drive one page, with localhost
   the owner's. Every window adds the thread's folded tabs to its pane (`useThreadBrowserTabs`). A device opens or shows a
   tab with `browser-open` and follows its frames over `page.watch`; `browser-input` and `browser-navigate` run in Core
   (`directCall`). All of them need `operate`. `RemoteBrowser.tsx` shows the frames and sends clicks, wheel and keys.
   Limits:
   - Pages live as long as Core's views: a restart forgets the view, and the folded tab reopens at its url when next shown.
   - Only the main window can attach a view Core opened (main makes them in it).
   - Fixed: a hidden or minimized window on the owner kept a watching device's frames from coming. A mirrored view now
     captures with `capturePage({ stayHidden: true })`, which makes the page paint, and turns background throttling off
     (Linux).
   - One viewport per page.
   - Closing a tab in another computer's pane only closes it there.
   - Popups stay window tabs.
   - Under `mochi serve`, the agent's browser tools keep their own tabs, apart from the folded ones.
6. **Remote viewer writes: rejected on review.** `device.command` decodes every device input through the relay schema
   (`Relay.RemoteCommand`) and maps it to actions itself (`storeCommand`), so a device never sends a raw store action.
   Letting another computer append arbitrary actions to this Core's `Commands.submit` would widen that trust boundary.
   The existing route already ends in `Commands`, so it gains steps 2–3's lifecycle without the change.

## Step 5, finished: every thread tool runs in Core (done)

Status: shipped in two PRs (#525, then step 3's). Claims marked **verified** were read in the repo on 2026-11-03.

### The problem

A thread tool ran in two places with two behaviours:

- **A window was open:** the window ran the tool, and approvals worked.
- **No window was open:** Core ran it, and any call that would ask expired at once.

`ask` waited on an in-process promise that only `decideTool` in the same window could resolve. Next to it was a bug:
a paired device approving a tool card dispatched `answer`, which closed the card while the call waited out its timeout.

### What shipped

1. **Tool decisions as a command (#525).** Answering a card logs `tool-decision` (`queueId`, `isApproved`, `options`).
   - It folds onto the card as `tool.decision`, and the first answer holds.
   - `hearToolDecision` resolves the waiting call where it runs. A window feeds it from the replica's `listen` and its own
     dispatch; Core feeds it from `projection.folded` (`hearDecisions`).
   - `MochiWidget` logs the action, and a device's `resolve` on a tool card maps to it, with the option picked by label or id.
2. **Thread tools always in Core.** `layer.ts` sends a `CORE_TOOLS` call to `coreToolRunner` whether or not main has a
   window. Core's calls get the normal approval deadline instead of expiring at once. The `NO_WINDOW` fallback for thread
   tools is gone.

`watch_thread` left `CORE_TOOLS`: it toggles `watched`, a window slice Core doesn't hold. In Core,
`state().watched` was undefined (verified by reading; not run).

### Dropped: tool outcomes as a command

The plan had a step 2 that logged each tool's toast and Undo (`tool-outcome`) so a window could show them for a call
Core ran. It isn't needed (verified, `toolTable.ts`):

- 15 of the 17 Core tools are `quiet`: they log a line in the thread and never toast.
- `list_threads` and `get_thread` are read-tier, and `update_plan` returns no change, so none of the three records an
  outcome.

The window tools keep their toast and Undo in the window that runs them.

Next to it, believed and not run: `applyUndo` compares by reference, so a `tool-undo` folded from JSON (Core, other
windows, the origin's own confirmation) can't put back object-valued fields or remove a thread the call created. No
toasting tool that relies on the snapshot undo creates threads today.

### Checks

| Step | Proof                                                                                                                                                                                |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1    | `tools.test.ts`: an answer folded from any view resolves the call; the first answer holds; a device's approval picks by label and is refused without one.                            |
| 2    | `coreTools.test.ts`: a thread tool set to Ask waits in Core and goes on when another client logs `tool-decision` (fails without `hearDecisions`). Not run: the app, a paired device. |

### Open questions

1. **Which windows toast.** Moot for the Core tools, since none of them toasts. A window tool still toasts in the window
   that ran it.
2. **Can a paired device undo a tool's change?** Not added: undo isn't a `RemoteCommand`, and step 8 kept the relay
   schema narrow on purpose. A device can approve a tool card (`operate`).

## Checks

| Step | Proof                                                                                                                                                                                                                                                                                     |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `tools.test.ts`: a tool set to Ask resolves on a folded `tool-decision`, approved and denied, and expires at its deadline without one. `storeCommands.test.ts`: `resolve` on a tool card yields `tool-decision`.                                                                          |
| 2    | `undo.test.ts`: a trimmed `ToolUndo` restores the same fields as the full one, and its JSON stays small with 200 threads. `tools.test.ts`: `create_thread`'s outcome carries the delete. A replica test: a live `tool-outcome` toasts once, a replayed one doesn't.                       |
| 3    | `coreTools.test.ts`: with main up and a window open, a thread tool runs in Core, asks, waits, resolves on a `tool-decision` logged by another client, and logs `tool-outcome`. Real run: rename a thread from an agent, see the toast, press Undo; close every window, run again, reopen. |

Every step: typecheck, lint and the tests above, shown verbatim in its PR.

### Rejected

- **Keep today's split** (window runs tools while open, Core otherwise): two behaviours, and nothing can approve a
  call while no window is open.
- **Core keeps undo closures in memory by id:** Undo dies with a Core restart, and `Commands` would need to know about
  the tool runner.
- **Log the full `ToolUndo` snapshot:** every thread, twice, per tool call.
- **Move all 64 tools to Core:** layout tools change a window's panes, which Core doesn't hold (open question 4 above).

### Open questions

1. **Which windows toast.** Recommend every window on the computer that owns the thread: all of them are yours, and
   choosing one focused window needs focus tracking Core doesn't have. Another computer viewing the thread doesn't
   toast.
2. **Can a paired device undo a tool's change?** Recommend no for now: undo isn't a `RemoteCommand`, and adding it
   widens the relay schema, which step 8 deliberately kept narrow. Approving a tool card from a device stays allowed
   (`operate`, as it is today).

## Checks

| Step | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | New two-Core test in `packages/core` (fake `AgentCaller` via `Layer`, `TestClock`, no real sleeps per `mochi(no-real-time-wait-in-tests)`; temp dirs, never `~/.claude`/`~/.codex`).                                                                                                                                                                                                                                                                            |
| 2    | `commands` tests: log order `command` → `agent-starting` → agent events; lost process → one retry `start`; failure → `turn-end failed`; duplicate `commandId` → zero calls; trigger saved for `create` with schedule.                                                                                                                                                                                                                                           |
| 3    | Same tests driven through the `events.append` RPC; `store/index.tsx` has no `host.agent` import (grep in test or lint); real run: start a thread on computer A from B, B shows Starting → reply.                                                                                                                                                                                                                                                                |
| 4    | Scheduler test: run with no window client logs `schedule-run` and agent events; real run with every window closed.                                                                                                                                                                                                                                                                                                                                              |
| 5    | `tools.test.ts` for the thread tools against Core's projection; a window tool with no window answers `NEEDS_APP`.                                                                                                                                                                                                                                                                                                                                               |
| 6–7  | `remote/browsers.test.ts` (Core: frames before and after subscribing, close ends the stream), `browser/headless.test.ts` (real Chromium: `input` clicks and types), `relay.test.ts` (browser commands need `operate`, bad input refused), `src/remote/browsers.test.ts` (the owner window hosts, feeds, takes input, refuses an unknown tab), `tests/e2e/browser.spec.ts` `m.` (frames while the window is hidden or minimized). Not run: two paired computers. |
| 8    | Rejected; nothing to check.                                                                                                                                                                                                                                                                                                                                                                                                                                     |

Every step: `pnpm` typecheck, lint, and the tests above, shown verbatim in its PR.

## Rejected

- **Patch the symptom** (clear `starting` on any activity in the mirror): devices, reactor and scheduler keep diverging.
- **Owner's window stays the decider, others route through it** (`inWindow`): fails with no window open, races with two windows.
- **Derive "starting" in the view** (working, no agent event yet): can't tell starting from slow, loses retry/failure states.
- **Agent calls as reactor outbox commands**: the outbox retries across restarts, and a resent `start`/`send` spends usage twice; calls aren't idempotent.
- **Open the page on the viewer's computer**: localhost and the agent's tools point at the owner; two browsers diverge.
- **WebRTC/VNC for the remote browser**: a new dependency; CDP screencast is already reachable through Electron's debugger and Playwright's `CDPSession` (believed for the Electron view, verified that `headless.ts` imports `CDPSession`).

## Open questions

1. **Scope for viewing and driving another computer's browser.** Recommend `operate`: it already lets a device message an
   agent that drives that browser. The page carries the owner's signed-in sessions, so `read` is too little.
2. **Do tools (step 5) belong in this effort?** Recommend yes: sub-thread starts and browser tools depend on it, and it
   removes the last "needs the Mochi app open" path. If not, steps 1–4 still fix the lifecycle, and the browser waits.
3. **A message logged but never sent when Core restarts.** Recommend a failed turn ("Mochi restarted before Claude Code got
   this") with the text kept, no automatic resend.
4. **Tool split (step 5).** Recommend the split above: thread tools in Core, window tools in a window. The alternative,
   Core holding every window's layout, makes windows thin clients of Core's layout too, which is a bigger move than this plan.
5. **Browser tabs as thread state (step 6).** Recommend yes: it's what lets another computer, the agent's tools and a
   second window name the same page. Cost: the pane model splits into the thread's tabs (Core) and where a window shows them.
