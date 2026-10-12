# Agent runtime

How threads stop running on the `tick` simulation and start running real Claude Code and Codex agents. Read with [SESSIONS.md](SESSIONS.md) (how work is split) and [CHECKLIST.md](CHECKLIST.md).

Status labels: **verified** = read in this repo; **docs** = read in the vendor's docs or source by a research agent on 2026-10-12, not yet run here (links inline); **decision** = ours to make, made here.

## Decisions

1. **Agents run in the Electron main process**, one per thread, in that thread's worktree (`threadCwd`, `src/host/cwd.ts`, filled in by the worktree manager). The renderer never holds credentials or child processes; it talks through `host.agent`.
2. **Claude: the Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk`), one `query()` per thread with streaming input. It is Claude Code as a library: built-in tools, hooks, permissions, sessions, file checkpoints ([docs](https://code.claude.com/docs/en/agent-sdk/overview.md)).
3. **Codex: one `codex app-server` child process** speaking JSON-RPC over stdio, holding every Codex thread (`thread/start` per thread, each with its own `cwd`). OpenAI recommends app-server for deep product integrations; it is what the VS Code extension uses. The `@openai/codex-sdk` spawns `codex exec` per turn and has no approval callbacks, so it doesn't fit ([docs](https://learn.chatgpt.com/docs/app-server); `openai/codex` `sdk/typescript/src/exec.ts`).
4. **One normalized event stream.** Both adapters translate their protocol into `AgentEvent`s (below); the store only ever sees those. The `tick` simulation becomes a third adapter, `demo`, emitting the same events, so the web build and the artifact keep working with no runtime.
5. **Mochi's goal stays canonical.** The agent's own plan (TodoWrite / Codex plan updates) is mapped onto goal steps; it never replaces them. Overlap detection, revisions and the metro board keep working unchanged.
6. **Defaults:** Claude model `claude-opus-5-5`; the drift classifier's small model `claude-haiku-5-5` (current Haiku). Codex model: whatever the user's Codex config defaults to until the model picker sends one.

## Auth

**Mochi never logs in to Claude or Codex, and never sees, stores or forwards their credentials.** It drives the user's own installed tools, which carry the user's own login, the same model as Conductor, Zed and T3 Code (decision, 2026-10-12).

- **Claude: the user's installed Claude Code.** The Agent SDK runs the Claude Code binary; point it at the user's own `claude` (the SDK's executable-path option; Zed overrides it with `CLAUDE_CODE_EXECUTABLE`, docs) so it inherits whatever that install is logged in with: Pro/Max, Team, or an API key the user set up in Claude Code. Signing in or switching accounts happens in Claude Code itself (`claude auth login`, `/login`); Mochi only reports which method is active (Claude Code's `/status` shows it) and links the user there. Don't pass `env` without spreading `process.env`: it **replaces** the child environment and would drop the user's credentials and `PATH` (docs).
- **API key, optional:** for someone without Claude Code, a key entered in settings, stored with Electron `safeStorage`, passed as the environment Claude Code reads. Exact variable name: not verified, check the Quickstart. A set `ANTHROPIC_API_KEY` makes Claude Code bill the API instead of the subscription (Zed docs, Claude Code auth docs), so Mochi never sets it unless the user chose this option, and says so in settings.
- **Codex: the user's `codex login`.** One `codex app-server` started from the user's install, reading the user's own credentials (`~/.codex/auth.json` or the keyring). `account/read` reports the state; if logged out, Mochi tells the user to run `codex login` rather than calling `account/login/start` itself. Whether app-server picks up an existing login with no extra step: not verified, check first.
- **Distribution:** before shipping Mochi to other people, re-check Anthropic's current legal page (the Agent SDK overview says products should use API keys unless approved; reports from October 2026 say the subscription rules were relaxed) and OpenAI's terms.
- **Accounts per profile (decision, 2026-10-12):** an account is one Claude Code or Codex login, kept in its own config directory so several can coexist, each signed in by the user in the tool itself. A profile (space) links **at most one Claude account and one Codex account**; one account may be linked to several profiles. Every thread runs on its profile's account for that provider, and nothing ever switches a thread to another account of the same provider (that would be working around usage limits, which both providers' terms forbid). `Space.accounts` in `src/model.ts` becomes `{ claude?: AccountId; codex?: AccountId }` against an account registry.
- **When an account hits its limit:** the thread pauses with "limit reached, resumes at <reset time>" (a needs-you-style state) and continues on the same account after the reset. The user can instead choose, explicitly and per thread, to continue on their API key (pay per use) or to hand the thread off to the other provider (existing handoff). Never automatic, never silent.

## Event contract

`src/host/types/agent.ts` today has `start` (unimplemented), `ask` (mock, used by side chat) and one `onEvent` channel (verified). It grows to:

```ts
type AgentEvent =
  | { threadId: string; type: 'session'; provider: Provider; sessionId: string }          // persist for resume
  | { threadId: string; type: 'message'; text: string; isDelta: boolean }
  | { threadId: string; type: 'reasoning'; text: string }
  | { threadId: string; type: 'tool'; id: string; phase: 'start' | 'end'; text: string; files?: string[]; exitCode?: number }
  | { threadId: string; type: 'plan'; items: { title: string; status: 'pending' | 'running' | 'done' }[] }
  | { threadId: string; type: 'approval'; requestId: string; kind: 'command' | 'edit' | 'tool'; title: string; detail: string; code?: string }
  | { threadId: string; type: 'question'; requestId: string; questions: { text: string; options: string[] }[] }
  | { threadId: string; type: 'usage'; inputTokens: number; outputTokens: number; costUsd?: number; contextUsed?: number; contextMax?: number }
  | { threadId: string; type: 'turn-end'; status: 'done' | 'interrupted' | 'failed'; error?: string };
```

Methods: `start(threadId, { provider, cwd, prompt, model, effort, permissionMode, resume? })`, `send(threadId, text)`, `interrupt(threadId)`, `resolve(requestId, decision)`, `stop(threadId)`, plus the existing `ask` (side chat) and a new `classify` (drift guard).

## Mapping

| AgentEvent | Claude Agent SDK (docs) | Codex app-server (docs) | Store |
|---|---|---|---|
| `session` | `system` message, `subtype: 'init'`, `session_id` | `thread/start` result `threadId` | save on `Thread` for resume |
| `message` | `assistant` text blocks; deltas from `stream_event` with `includePartialMessages: true` | `item/agentMessage/delta`, `item/completed` `agentMessage` | `say` (activity `message`) |
| `reasoning` | thinking blocks (summarized display) | `item/reasoning/summaryTextDelta` | activity `reasoning` |
| `tool` | `tool_use` blocks in `assistant`, results in `user` (shape not verified); or `PreToolUse`/`PostToolUse` hooks | `item/started` / `item/completed` for `commandExecution` (`exitCode`) and `fileChange` (`changes`) | activity `tool` → work log; edited files feed the step's `footprint` and overlap detection |
| `plan` | latest `TodoWrite` `tool_use` input `{ todos: { content, status, activeForm }[] }`, or `TaskCreate` / `TaskUpdate` on newer models | `turn/plan/updated { plan: { step, status }[] }`, full list each time | reconcile onto goal steps (below) |
| `approval` | `canUseTool(toolName, input, { toolUseID, signal })`, resolve later with `{ behavior: 'allow' }` or `{ behavior: 'deny', message }` | server requests `item/commandExecution/requestApproval` / `item/fileChange/requestApproval`, reply `{ decision }` | queue item `approval` (existing `Confirmation` card) |
| `question` | `canUseTool` with `toolName === 'AskUserQuestion'`, answer via `updatedInput: { questions, answers }` | none found | queue item `question` (existing `Questionnaire`) |
| `usage` | `result.usage`, `result.modelUsage` (includes subagents), `result.total_cost_usd` | `thread/tokenUsage/updated { total, last, modelContextWindow }`; no cost field | usage model (`src/usage/model.ts`), context meter |
| `turn-end` | `result` (`subtype` success / error_*) | `turn/completed` (`turn.status`) | step completion, `review` when the goal is done |

Interrupt: Claude `query.interrupt()`; Codex `turn/interrupt { threadId, turnId }`. Resume: Claude `resume: sessionId` (never `continue`, which picks the latest session in the cwd and would cross threads); Codex `thread/resume { threadId }`. Fork for thread forking: Claude `forkSession: true` with `resume`; Codex `thread/fork`. All docs.

## Plans onto goal steps

The agent's plan list arrives whole each time (TodoWrite input, `turn/plan/updated`). For each item, match an open goal step by title with `similarity()` (`src/progress.ts`, verified; already used for overlap detection):

- match → copy the status onto the step (`running` starts it, `done` completes it through the existing `completeStep`, so provided-by links and races keep working);
- no match → add the step through the existing scope-add revision flow, `addedBy` = the provider, so the timeline shows where scope came from and the drift guard's rules apply;
- a step the agent drops from its list stays, marked `dropped` with "Dropped by <provider>".

Sizes for new steps default to 2 until the agent says otherwise. Progress, burn-up and ETA keep their math.

## Approvals

- Claude: keep the `canUseTool` promise's resolver in a map keyed by `toolUseID`, emit `approval`, resolve when the queue card is answered; abort through the callback's `signal` if the turn is interrupted. It only fires when nothing earlier approved the call; to gate every call, use a `PreToolUse` hook (docs). The composer's permissions menu sets `permissionMode` (`default`, `acceptEdits`, `plan`, ...; docs).
- Codex: answer the server request with `accept`, `acceptForSession`, `decline` or `cancel`. Interrupting a turn clears pending approvals and the server sends `serverRequest/resolved` (docs), which removes the queue card.
- Queue ranking stays as is (`rankQueue` in `src/store/queue.ts`, verified: `steps × 2 + threads × 3`, +4 for overlaps); an approval blocks its thread's running step.

## Checkpoints, rewind, handoff

- Rewind already snapshots thread state and git refs under `refs/harness/checkpoints/` (verified, `src/rewind/`). Claude adds real file rewind: `enableFileCheckpointing: true` + `query.rewindFiles(userMessageId)`; it tracks Write/Edit/NotebookEdit only, not Bash edits, and restores files, not the conversation (docs). Keep git refs as the source of truth and use the SDK rewind only to keep Claude's own view consistent. Codex: git refs only.
- Built (`rewindClaude`, `electron/agents/claude/sessions.ts`): each sent message carries a uuid we generate; `rewindToMessage` calls `host.agent.rewindFiles` before the git restore. GAP: not verified against a real thread that edited a file; matched by message text until activity entries carry the uuid.
- Handoff (`src/rewind/handoff.ts`, verified GAP) becomes: stop the current agent, start the other provider in the same worktree with the generated summary as its first prompt.

## Side chat, drift guard, usage

- Side chat `ask` (built, `electron/agents/ask.ts`): one model setting for either provider (Settings › Defaults, migrated from the Claude-only one), switchable per chat; same context and caps both ways. Claude: an Agent SDK query on the profile's Claude account with `tools: []`, no settings files and no saved transcript (`oneshot.ts`). Codex: an ephemeral, read-only, never-approve thread on the account's app-server with the tool features off (`CodexAdapter.ask`); no prewarm, first token ~7–9s measured on 0.155.1.
- Models (built, `electron/agents/models.ts`): `host.agent.models(provider, spaceId)` lists the profile's account's own models: Claude from the Agent SDK's `supportedModels()` (built-in fallback list when it fails), Codex from app-server `model/list` (ids, names, default, reasoning efforts). Cached per account, dropped when detection sees that account's login change. Every thread start and side chat ask sends an explicit model the account offers: a stored model it no longer offers (or none) becomes the account default, an effort the model doesn't take becomes the model's own default; the picker shows such a model as Unavailable.
- Drift classifier (built): `classify` in main with `claude-haiku-5-5`, answering `{ verdict: 'on-goal' | 'scope-add' | 'off-goal', reason }` as JSON within 4s, else the local classifier (`classifyWithModel`, `src/drift.ts`). The local `similarity()` pass still decides clear cases first. Not `outputFormat`: it is fixed at prewarm and the spare is shared with side chat.
- Startup: a cold Claude Code start costs ~3–5s, more than the 4s budget, so both share one SDK `prewarm()` spare per account (parked when a side chat opens, a Claude thread starts, and after every claim; closed after 10 min unused and on quit). `prewarm` is `@alpha`; without it both fall back to cold starts.
- Usage: Claude reports cost; Codex reports tokens only, so Codex cost comes from a pricing constant marked TODO until checked against OpenAI's published prices.

## Concurrency and lifecycle

- Claude: the SDK runs the Claude Code binary, so each thread is a child process (docs say it "runs Claude Code"; per-process limits not documented). Cap concurrent Claude agents (start at 6, setting), queue the rest, measure memory before raising it.
- Codex: one app-server holds many threads; route every notification by `threadId` (docs). Concurrent-turn limits: not verified.
- On app quit: interrupt, persist session ids; on launch, threads show their last state and resume only when the user sends or presses Resume (never auto-resume, it spends money).
- The `demo` adapter keeps the current scripted overlap and scope events for the prototype and tests.

## Build sessions

Same rules as SESSIONS.md (own files, worktree per session, typecheck + tests + browser and Electron checks).

| Wave | Session | Owns |
|---|---|---|
| R0 | `contract`: grow `AgentHost`, move `tick` into a `demo` adapter, make the threads slice consume `AgentEvent`s (plan reconciliation, approvals and questions into the queue, usage) | `src/host/*/agent.ts`, `electron/ipc/agent.ts`, `src/store/threads.ts`, `src/runtime/**` |
| R1 | `claude`: Agent SDK adapter driving the user's installed Claude Code, optional `safeStorage` key, permission modes, resume/fork, file checkpoints | `electron/agents/claude/**` |
| R1 | `codex`: app-server process manager from the user's install, JSON-RPC client, login state (never logs in itself), approvals | `electron/agents/codex/**` |
| R1 | `settings`: which Claude Code / Codex installs and logins are detected, the optional API key, concurrency cap, default models | `src/settings/**` |
| R2 | wire-ups: real side chat `ask`, drift `classify`, usage numbers, handoff, rewind through the SDK | the GAP sites listed above |

Wave 3 of SESSIONS.md (scheduled threads, team spaces, replay, voice, mobile, settings sync) starts after R2.

## Mochi tools

The agent in a thread controls Mochi through the `mochi` MCP server (`electron/mcp/server.ts`). One table, `src/runtime/toolTable.ts`, lists every tool with its tier, its zod schema and its description; main builds the MCP servers from it and the renderer enforces tiers from it (decision, 2026-10-12).

**Flow.** main → `agent:onToolCall` → `runTool` (`src/runtime/tools.ts`) checks scope and tier, runs the handler against the store (or `host.browser` for browser tools), logs it, answers through `agent.toolResult`. Both harnesses auto-approve every `mochi` tool (Claude `allowedTools`, Codex `default_tools_approval_mode = approve`): Mochi asks with its own card, so the user is never asked twice.

**Tiers.**

| Tier | Runs | The user sees |
|---|---|---|
| read | always | nothing; the call shows in the work log |
| reversible | when the setting allows it | the change, a toast with Undo, and a line in the calling thread ("Claude settled 2 threads") |
| consequential | only after Approve, never automatically | an approval card in the Queue and the thread's composer tray saying exactly what happens ("Delete 'Fix flaky checkout e2e' and its worktree? This can't be undone"), Approve / Deny, options as checkboxes on the card |

Settings › Defaults for new threads › **Agents can change Mochi**: Read only / Reversible (default) / Everything with confirmation. A call above the setting fails with a reason the agent can relay, and the composer tray shows the same setting as an inline control (a `setting` card), so the user changes it where they are.

- **Undo** restores the slices the call changed (threads one by one, panes, layouts) only where they still hold the call's result; anything changed since is kept, and the toast says so. Layout and own-goal bookkeeping (`set_step_status`, `add_step`, pane tabs) are reversible but quiet: logged, no toast, since they fire constantly.
- **Scope.** Every thread id is resolved in the caller's profile; another profile's thread is "not found". Browser tools only reach the caller's own pane tabs. An agent can't settle, delete or message its own thread.
- **Approval lifetime.** Cards wait up to 30 minutes (`APPROVAL_TIMEOUT_MS`), the same limit main and both harnesses give a Mochi call (Claude `MCP_TOOL_TIMEOUT`, Codex `tool_timeout_sec`, both read in the installed binaries). After that the card is withdrawn and the agent gets "expired". Cards aren't persisted: after a restart nothing is waiting on them.
- **Result.** Every write answers with what changed, as JSON (`{ changed: "Settled 2 threads", threads: [...] }`); errors say what to call instead.

**Tools** (verb_noun; `threadId` defaults to the caller; plural `threadIds` where the sidebar has bulk actions).

| Area | read | reversible | consequential |
|---|---|---|---|
| Threads | `list_threads` (status, pinned, project), `get_thread` | `rename_thread`, `settle_thread`, `reactivate_thread`, `pin_thread`, `unpin_thread`, `reorder_threads` (before/after one, or the whole pinned order), `watch_thread` | `create_thread` (starts an agent), `send_to_thread`, `delete_thread` |
| Goals | `get_goal` | `set_step_status`, `add_step`, `edit_goal` (text, step criteria), `reorder_steps`, `drop_step`, `settle_goal` | |
| Browser | `browser_tabs`, `browser_snapshot`, `browser_screenshot`, `browser_console`, `browser_wait_for` | `browser_open`, `browser_click`, `browser_hover`, `browser_type`, `browser_select`, `browser_drag`, `browser_upload` (worktree files), `browser_press`, `browser_scroll`, `browser_eval` (local pages), `browser_back`, `browser_forward`, `browser_reload`, `browser_set_device` | typing, Enter, or clicking a submit control on a non-local origin; `browser_eval` on a non-local origin (card shows the origin and the whole script: it runs with the user's session); `browser_upload` of a file outside the worktree |
| Layout | | `open_pane_tab`, `focus_thread`, `split_with`, `close_pane`, `show_file`, `open_changes` | |
| User | `show_setting` | `ask_side_chat`, `notify_user` (1 per thread per minute) | |

**Delete** (`delete` action): stops the live agent, removes the thread with its queue items, pane, side chats, checkpoints, fork records, layout leaves and saved state; the card's "Also remove its worktree" checkbox runs `git worktree remove` after. Not undoable.

**Browser.** `browser_snapshot` walks the page's DOM in an isolated world (the page can't see or touch it) and returns an indented role/name tree like Playwright's, with `[ref=eN]` on interactive elements; refs live in that world and reset on each snapshot. Clicks and keys go through CDP `Input.*` (trusted events); typing selects the field's text and inserts. While Mochi's window is on another Space the page is `hidden` and gets no hit testing, so a click falls back to a DOM `click()` and the result says it wasn't trusted; screenshots fall back from `capturePage` (empty or `UnknownVizError` there) to CDP `Page.captureScreenshot` (both seen in a production build, 2026-10-12). Local means `localhost`, `127.*`, `[::1]`, `0.0.0.0`, `*.localhost`, `*.test`, `about:`. Navigating to any other origin is allowed, logged, and toasts with Undo (= back). Tools act on a tab whose page is on screen: they select their tab in the pane, and fail with "focus_thread first" when the thread isn't showing, because a hidden native view has no size to render at. GAP: CDP coordinates are not checked against a zoomed or device-emulated page.

**Widgets.** `show_setting(settingId, reason, suggested?)` puts a `setting` card in the composer tray with the real control for prefs-backed settings (enums and switches) and a deep link for the rest; Mochi's own blocked calls use the same card.

## Subagents and background agents

A thread's agent can start other agents. Their work is never flattened into the parent's log: each is one `subagent` event stream (`start` / `progress` / `end`, sparse fields: name, prompt, model, background, its own tool steps, latest message, running token total, result, error) folded into `Thread.subagents` (`src/runtime/subagents.ts`). Each is a Mochi of its own flavor and name (Matcha, Sakura, Ube, Mango, Soda, by start order in the thread). The chat shows each as one line where it started (`src/agents/SubagentRow.tsx`): live action, or its report's first line; clicking opens it in the side pane's **Agents** tab, which lists them with live logs, the full report, Send to thread, Stop and their diffs (`src/pane/AgentsTab.tsx`), and opens on its own (never taking the front tab) when a thread's first background agent starts. The sidebar card counts running background agents.

| | Claude (Agent SDK 0.3.296, Claude Code 2.1.296) | Codex (app-server 0.155.1, `multi_agent` on by default) |
|---|---|---|
| start | `Agent` (or `Task`) `tool_use`: id = the tool call's id, `description`, `prompt`, `model`, `run_in_background` | `item/completed` `subAgentActivity` `kind: started`: id = `agentThreadId`, name from `agentPath`; v1 `collabAgentToolCall` `spawnAgent` → `receiverThreadIds` |
| own steps | messages with `parent_tool_use_id` = that id (`tool_use` / `tool_result` / text) | notifications under the child's own thread id on the same connection (`item/*`, `thread/tokenUsage/updated`, `turn/*`) |
| progress | `task_started` (task id, `is_backgrounded`), `task_progress` (`usage.total_tokens`, summary), `task_updated` | child `thread/tokenUsage/updated` `total.totalTokens`; the child's spend is added to the thread's usage |
| end | `task_notification` (`completed` / `failed` / `stopped`, `summary`, usage); a foreground agent's `tool_result` (`AgentOutput` `completed`) | parent `subAgentActivity` `completed` / `interrupted`, child `turn/completed`; the first end wins |
| stop | `query.stopTask(taskId)` | `turn/interrupt` on the child's thread and turn |

All of the above verified with live runs on 2026-10-13 (tiny prompts, `electron/agents/*/fixtures/subagent.jsonl`). Claude Code starts a turn of its own when a background agent reports back; the mapper treats it as any turn. Codex child approvals route to the parent thread's queue.

**Mochi background agents** (`start_background_agent`, `list_background_agents`, `stop_background_agent`): for work that should outlive the current turn. The tool adds a `mochi` subagent and starts it as a session of its own in `host.agent` (thread id `<thread>--<id>`), so it runs on the profile's account and, for Claude, counts toward the concurrency cap like any session (Codex has no cap yet). `worktree: same` runs it in the thread's worktree; `new` makes a worktree on `<branch>-<id>` from the project's base branch. Its events are folded into the parent as subagent events in the renderer (`fromBackground`): approvals and questions land on the parent's queue named after the agent, its spend counts toward the thread, its context doesn't. Its session stops after its first turn. On end it logs a line in the thread and leaves a note (`live.notes`) that goes to the thread's agent ahead of your next message; "Send to thread" sends it now. Tier: reversible and quiet. GAP: the "auto" approvals policy the request mentions isn't on main; switch the tier when it lands. A restart marks running agents stopped.

## Not verified yet (check before building on it)

- Env var the Agent SDK reads for the API key; the `user` tool_result message shape.
- Per-process memory of a Claude Agent SDK session; safe concurrency count.
- Whether app-server picks up an existing `codex login` without a login call; concurrent-turn limits.
- Whether `TaskCreate` / `TaskUpdate` replace `TodoWrite` on the default model (docs say "on certain models"; `CLAUDE_CODE_ENABLE_TASKS=0` forces TodoWrite).
