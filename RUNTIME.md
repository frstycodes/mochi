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
- **When an account hits its limit:** the thread waits for the reset on the same account, the way its harness does it (Claude Code holds the turn and continues; Codex stops until you resume, or the Resume at reset you chose). The user can instead choose, explicitly and per thread, to continue on their API key (pay per use) or to hand the thread off to the other provider (existing handoff). Never automatic, never silent. States and sources in [Usage limits](#usage-limits).

## Usage limits

Mochi relays what each harness does as a plan window (5-hour, weekly) fills and runs out, and adds no logic of its own: no thresholds, no wrap-up prompts, no holding other threads (decision, 2026-10-13). Sources checked 2026-10-13 against Agent SDK 0.3.296 / Claude Code 2.1.296, codex-cli 0.155.1, and T3 Code's adapters (`pingdotgg/t3code` at `98a6246`).

**Claude** (verified in `sdk.d.ts` unless marked).
- `rate_limit_event` → `rate_limit_info: { status: 'allowed' | 'allowed_warning' | 'rejected', resetsAt?, rateLimitType?: 'five_hour' | 'seven_day' | …, utilization?, overageStatus?, isUsingOverage?, overageInUse?, … }` (`sdk.d.ts:5704`). `resetsAt` is unix seconds, `utilization` 0–1 (read in the 2.1.296 binary).
- Claude Code wraps up by itself near the limit: the 2.1.296 binary holds the hint "[Usage limit approaching. Checkpoint now: finish the current step, …]", at utilization 0.95 (0.99 on Max 5x, 0.9975 on Max 20x), skipped while extra usage is allowed. Not verified: that it fires in an SDK session.
- `rejected` without extra usage: Claude Code holds the turn and continues it after the reset. Source: T3 Code's adapter ("Rejected windows pause the SDK without ending its turn", `ClaudeAdapterV2.ts:6682`) and its docs; not verified here. With `overageStatus` allowed or extra usage in use it keeps running, billed.

**Codex** (verified in the app-server schema).
- `account/rateLimits/updated` (sparse) / `read`: `RateLimitSnapshot { primary, secondary: { usedPercent, windowDurationMins, resetsAt } | null, … }`. No warning of its own.
- At the limit the turn ends: `turn/completed` `failed`, `turn.error.codexErrorInfo` `usageLimitExceeded` (or `rateLimitExceeded`, which T3 Code treats the same). Codex doesn't continue by itself.

**What Mochi shows** (`src/runtime/limits.ts`, tests in `limits.test.ts`, mappers in `electron/agents/*/map.ts`).

| Harness says | Event | Mochi |
|---|---|---|
| Claude `allowed_warning` | `limit-notice` | a transcript line ("Claude's 5-hour limit is 92% used"), once per window and reset |
| Claude `rejected` with extra usage | `limit-notice` | a line: "Claude is past its 5-hour limit and using extra usage, billed per use"; nothing stops |
| Claude `rejected` | `limit` `isTurnHeld` | the turn stays working; the limit card says Claude Code continues after the reset; queued messages wait for the turn as usual |
| Claude window open again | `limit-cleared` | "The limit reset; the turn continues"; a notification |
| Codex `usageLimitExceeded` / `rateLimitExceeded` | `limit` + `turn-end` | the thread stops (needs you), queue paused; the card offers Resume, Resume at reset (sends "Continue where you left off." then, only if you chose it), Hand off |
| plan windows | `onLimits` | the context ring's outer arc for the fullest window at 70% and up |

Everywhere: the limit card in the transcript where it happened (countdown), header chip and sidebar/summary line ("Waiting · resets 3:40 PM" / "Stopped · resets …"), the composer's note, a notification. Use API key (Claude, when a key is stored) and Hand off are per-thread clicks; nothing is automatic. Your own message or settling cancels a Codex Resume at reset. Other threads and new threads on the same account are not held: each harness answers for itself.

GAP: Claude's held turn and `limit-cleared` follow T3 Code's reading; if a real run ends the turn with an error instead, the card goes with the turn and the error shows as the turn's failure.

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
  | { threadId: string; type: 'limit-notice'; text: string }
  | { threadId: string; type: 'limit'; resetsAt?: string; label?: string; isTurnHeld?: boolean }
  | { threadId: string; type: 'limit-cleared' }
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

Sizes for new steps default to 2 until the agent says otherwise.

Being replaced by Goals v2 below: steps mirror the plan with no sizes, and new plan items stop bumping the goal version.

## Approvals

- Claude: keep the `canUseTool` promise's resolver in a map keyed by `toolUseID`, emit `approval`, resolve when the queue card is answered; abort through the callback's `signal` if the turn is interrupted. It only fires when nothing earlier approved the call; to gate every call, use a `PreToolUse` hook (docs). The composer's permissions menu sets `permissionMode` per harness (`PERMISSIONS` in `src/runtime/access.ts`):

| Mode | Claude | Codex |
|---|---|---|
| Manual | `default`, WebSearch pre-allowed | `on-request` + `read-only` |
| Auto | `auto` (classifier; falls back to `acceptEdits` where unavailable), WebSearch and WebFetch pre-allowed | `on-request` + `workspace-write`, `approvalsReviewer: auto_review` |
| Full access | `bypassPermissions` + `allowDangerouslySkipPermissions` (Claude Code still asks before dangerous `rm`) | `never` + `danger-full-access` |
| Plan | `plan` | not offered; runs as Manual |
- Codex: answer the server request with `accept`, `acceptForSession`, `decline` or `cancel`. Interrupting a turn clears pending approvals and the server sends `serverRequest/resolved` (docs), which removes the queue card.
- Queue ranking stays as is (`rankQueue` in `src/store/queue.ts`, verified: `steps × 2 + threads × 3`, +4 for overlaps); an approval blocks its thread's running step.

## Checkpoints, rewind, handoff

- Rewind already snapshots thread state and git refs under `refs/harness/checkpoints/` (verified, `src/rewind/`). Claude adds real file rewind: `enableFileCheckpointing: true` + `query.rewindFiles(userMessageId)`; it tracks Write/Edit/NotebookEdit only, not Bash edits, and restores files, not the conversation (docs). Keep git refs as the source of truth and use the SDK rewind only to keep Claude's own view consistent. Codex: git refs only.
- Built (`rewindClaude`, `electron/agents/claude/sessions.ts`): each sent message carries a uuid we generate; a files rewind saves the git `undo` snapshot, calls `host.agent.rewindFiles`, then restores the git checkpoint. Verified against a real thread (Claude Code 2.1.296, 2026-10-13): our client uuid is accepted, a dry run listed the edited file and the rewind returned `canRewind: true`. It only works for messages sent to the live session this launch. GAP: matched by message text until activity entries carry the uuid.
- Two rewind modes (`src/rewind/`): **Rewind chat** (transcript, steps and the agent's session go back, files stay) and **Rewind chat and files** (the worktree too, after a preview of the files and a confirm when files changed since the agent's last turn, tracked by the `turn` ref). Every rewind and undo is refused while the agent works. The session goes back by forking: Claude `resume` + `resumeSessionAt` + `forkSession` (verified: the fork lacked the dropped request), Codex `thread/fork` with `lastTurnId` (not run yet); when this launch doesn't know the point, a fresh session gets the transcript as its first message. Undo resumes the original session, which the fork left whole (verified for Claude).
- Handoff (`src/rewind/handoff.ts`, verified GAP) becomes: stop the current agent, start the other provider in the same worktree with the generated summary as its first prompt.

## Side chat, drift guard, usage

- Side chat `ask` (built, `electron/agents/ask.ts`): one model setting for either provider (Settings › Defaults, migrated from the Claude-only one), switchable per chat; same context and caps both ways. Claude: an Agent SDK query on the profile's Claude account with `tools: []`, no settings files and no saved transcript (`oneshot.ts`). Codex: an ephemeral, read-only, never-approve thread on the account's app-server with the tool features off (`CodexAdapter.ask`); no prewarm, first token ~7–9s measured on 0.155.1.
- Models (built, `electron/agents/models.ts`): `host.agent.models(provider, spaceId)` lists the profile's account's own models: Claude from the Agent SDK's `supportedModels()` (built-in fallback list when it fails), Codex from app-server `model/list` (ids, names, default, reasoning efforts). Cached per account, dropped when detection sees that account's login change. Every thread start and side chat ask sends an explicit model the account offers: a stored model it no longer offers (or none) becomes the account default, an effort the model doesn't take becomes the model's own default, and a speed goes only to a model that lists it (`speeds`: Claude's `supportsFastMode`, Codex's `serviceTiers`); the picker shows such a model as Unavailable.
- Background tasks (built, `utility` in `electron/agents/ask.ts`): thread titles (after the first exchange with a real goal; never over a title you or the agent renamed, `isTitleRenamed`), commit messages and PR title/body (drafts in the ship flow, editable), goal steps (goal editor's Draft steps) and handoff summaries. Each task has a model in Settings › Background tasks (`utilityModels`, default `claude-haiku-5-5`); a call tries it, then `claude-haiku-5-5`, then `gpt-6-luna` (`utilityCandidates`), skipping a model the account doesn't list, on the side chat askers (no API key, Claude through the prewarm spare), within 20s; null keeps the local text (truncated title, the thread's title and goal for a PR, the handoff template). Measured 2026-10-13: Haiku 2.2–3.5s warm, Luna 10.4s. Drift classify keeps its fixed Haiku: its 4s budget fits no Codex start. GAP: in dev, StrictMode runs a dialog's draft effect twice, so the PR and handoff drafts cost two calls.
- Compaction (built, `src/chat/compact.ts`): `/compact [focus]` is Mochi's command; it runs now when the agent is idle, waits in the queue behind a turn in queue mode, and is off with a reason otherwise (steer mode, waiting on you, detached, already compacting). Mochi asks every compaction to keep the goal, its criteria and your pins word for word, in transcript order (each pin ≤2000 chars, all ≤8000). Claude: `/compact <focus>` goes in as a message; a PreCompact callback hook returns Mochi's instructions as `systemMessage`, which Claude Code 2.1.296 appends to the compaction's custom instructions for manual and auto-compact alike (read in the binary; run live 2026-10-14: a pinned codeword survived a `/compact` told to drop everything else). `compact_boundary` gives the sizes, the PostCompact hook the summary. Codex: `thread/compact/start` takes no instructions (0.155.1 schema; `compact_prompt` only at thread start and replaces the whole prompt), so after a `contextCompaction` item ends Mochi leaves what to keep (and your focus) as a note for the next message; Codex reports no summary and no size after it (run live 2026-10-14). GAP: a Codex auto-compaction mid-turn restores the pins only with your next message.
- Codex `model/list` (checked 2026-10-13, codex-cli 0.155.1, ChatGPT Plus): `gpt-6-astra` (default), `gpt-6-sol`, `gpt-6-luna`, `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`; hidden: `gpt-reserve`, `gpt-5.5`, `codex-auto-review`. `gpt-6.1-sol` is absent even with `includeHidden`, and `codex exec -m gpt-6.1-sol` fails with "not supported when using Codex with a ChatGPT account": it needs an API key login. The picker's Codex row says "Some models need an API key" on ChatGPT logins.
- Drift classifier (built): `classify` in main with `claude-haiku-5-5`, answering `{ verdict: 'on-goal' | 'scope-add' | 'off-goal', reason }` as JSON within 4s, else the local classifier (`classifyWithModel`, `src/drift.ts`). The local `similarity()` pass still decides clear cases first. Not `outputFormat`: it is fixed at prewarm and the spare is shared with side chat.
- Startup: a cold Claude Code start costs ~3–5s, more than the 4s budget, so both share one SDK `prewarm()` spare per account (parked when a side chat opens, a Claude thread starts, and after every claim; closed after 10 min unused and on quit). `prewarm` is `@alpha`; without it both fall back to cold starts.
- Usage: Claude reports cost; Codex reports tokens only, so Codex cost comes from a pricing constant marked TODO until checked against OpenAI's published prices.

## Worktree setup

A new worktree gets ready before the agent's first turn (`prepareWorktree`, `electron/git/setup.ts`), between `createWorktree` and the agent start in `startAgent` (`electron/ipc/agent.ts`). Only when main just made the worktree and Settings › Git › Prepare worktrees before starting is on; project-folder threads, restarts and a reused worktree skip it.

1. **Copy** ignored files matching Settings › Git › Ignored files to copy (default `.env*`) plus the project's `.worktreeinclude`, gitignore patterns. Only files git ignores are copied (`git ls-files --others --ignored --exclude-standard --directory`, so `node_modules/` is never walked), so a copy never lands in a commit. `.worktreeinclude` is Claude Code's convention for the same thing (docs, code.claude.com/docs/en/worktrees); its `WorktreeCreate` hook replaces worktree creation entirely, so it's not matched. Codex's setup scripts live in `.codex` but their file format isn't documented: not read.
2. **Install** from the lockfile at the worktree's top, in the manager's frozen mode: pnpm (`--frozen-lockfile --prefer-offline`, links from the global store: 6s for this repo, measured 2026-10-13), bun, yarn (Berry `--immutable`), npm `ci`, uv, Poetry, Bundler, `go mod download`, `cargo fetch --locked` (`installCommand`).
3. **Setup command**: Settings › Git's command for the project folder, else the project's `.mochi/setup.sh`; `/bin/sh -c` in the worktree with `MOCHI_ROOT_PATH` and `MOCHI_WORKTREE_PATH`.

Each step streams as a `setup` agent event carrying the whole setup (status, steps, elapsed, tail-capped output; 250ms throttle) into `Thread.setup`, shown as the "Setting up worktree" row at the top of the thread (`src/chat/SetupRow.tsx`) and "Setting up worktree…" on the sidebar row and header. Commands run in their own process group.

- **Gating.** `start` returns once the worktree exists; setup and the agent launch go on in main and report through events (a failure is `turn-end failed`). It can't wait the setup out: the renderer runs agent calls one after another (`callAgent`), so a Stop, and every other thread's calls, would queue behind it. A `send` meanwhile waits on the start (`Starts`, `electron/agents/starts.ts`), so a steer isn't lost or turned into a second start.
- **Failure.** A failed step waits for `setupChoice`: Retry runs it again, Skip setup starts the agent without the rest; Open terminal opens the worktree's terminal. The thread is needs-you meanwhile. A background agent's setup skips a failed step on its own.
- **Cancel.** Stop (`interrupt`) or settling during setup kills the running command, the setup ends `cancelled`, the turn ends interrupted and the thread stays. The next message starts the agent in the worktree as it is. A setup Mochi quit during restores as cancelled. GAP: a worktree whose setup never finished (quit mid-setup) isn't set up again.
- **Cleanup.** Settings › Git › Remove settled worktrees (default after 7 days; `useWorktreeCleanup`): on launch and hourly, worktrees of threads settled that long (counted from when cleanup first saw them settled, wall clock) are removed with `git worktree remove`, which keeps any with uncommitted changes; branches stay. A message to such a thread makes the worktree again on its branch at the same path, so Claude's `resume` finds the session, and runs the setup again.

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

**Tiers.** Every tool runs without asking except deletes, which wait on their card, and settings, which only the user changes (decision, 2026-10-13).

| Tier | Runs | The user sees |
|---|---|---|
| read | always | nothing; the call shows in the work log |
| change | when the setting allows it | the change, a line in the calling thread ("Claude settled 2 threads"), a toast with Undo where it can be put back (`create_thread`'s Undo stops and removes the new thread; a sent message has none) |
| destructive | only after Delete, never automatically | a widget in the calling thread where the agent asked, naming exactly what goes (thread titles, worktree paths), Cancel / red Delete, options as checkboxes |
| setting | never: the call only shows the widget and returns at once, with no answer for the agent | a live settings widget in the thread: each suggested setting's real Settings row, changing the setting as you use it, with the agent's value under it (Use) and the agent's reason; several settings group in one widget; Done closes it into a record of what changed |

Settings › Agents › **Agents can change Mochi**: Read only / Changes, never deletes or settings / Everything, asking before deletes and settings (default; the old Reversible default migrates to it). A call above the setting fails with a reason the agent can relay, and the thread shows that setting as a widget, so the user changes it where they are.

**Widgets.** A widget is a queue item plus an `event` entry in the caller's activity carrying `card: { id, isOpen }`; the transcript renders the live widget in that entry's place. Enter acts on the focused button only, Esc anywhere in the widget says no. Answered (or closed with Done), `card-record` turns it into a one-line record ("Deleted \"X\"", "Set Diffs to Split", "Expired: …"). The Queue lists open widgets and its "Show in thread" scrolls to and focuses them; the composer tray keeps only the agent's own questions and approvals.

- **Undo** restores the slices the call changed (threads one by one, panes, layouts) only where they still hold the call's result; anything changed since is kept, and the toast says so. Layout and own-goal bookkeeping (`set_step_status`, `add_step`, pane tabs) are changes but quiet: logged, no toast, since they fire constantly.
- **Scope.** Every thread id is resolved in the caller's profile; another profile's thread is "not found". Browser tools only reach the caller's own pane tabs. An agent can't settle, delete or message its own thread.
- **Approval lifetime.** Widgets wait up to 30 minutes (`APPROVAL_TIMEOUT_MS`); main and both harnesses give every Mochi call a minute more (`MOCHI_TIMEOUT_MS`; Claude `MCP_TOOL_TIMEOUT`, Codex `tool_timeout_sec`), whatever its tier, since a change tool can stop mid-run on a browser escalation. After that the widget is withdrawn and the agent gets "expired". A reload or renderer crash fails every waiting call at once with "Mochi reloaded before it answered; nothing was done" (`electron/mcp/calls.ts`), and the widget's entry reads "Not answered before Mochi reloaded".
- **Result.** Every write answers with what changed, as JSON (`{ changed: "Settled 2 threads", threads: [...] }`); errors say what to call instead.

**Tools** (verb_noun; `threadId` defaults to the caller; plural `threadIds` where the sidebar has bulk actions).

| Area | read | change | destructive / setting (asks) |
|---|---|---|---|
| Threads | `list_threads` (status, pinned, project), `get_thread` | `rename_thread`, `settle_thread`, `reactivate_thread`, `pin_thread`, `unpin_thread`, `reorder_threads` (before/after one, or the whole pinned order), `watch_thread`, `create_thread` (starts an agent; optional `model`/`effort`, capped by Settings › Tools › Models for threads agents start: Default or cheaper (default), Any model, Always the default), `send_to_thread` | `delete_thread` |
| Goals | `get_goal` | `set_step_status`, `add_step`, `edit_goal` (text, step criteria), `reorder_steps`, `drop_step`, `settle_goal` | |
| Browser | `browser_tabs`, `browser_snapshot`, `browser_screenshot`, `browser_console`, `browser_wait_for` | `browser_open`, `browser_click`, `browser_hover`, `browser_type`, `browser_select`, `browser_drag`, `browser_upload` (worktree files), `browser_press`, `browser_scroll`, `browser_eval` (local pages), `browser_back`, `browser_forward`, `browser_reload`, `browser_set_device` | per call: typing, Enter, or clicking a submit control on a non-local origin; `browser_eval` on a non-local origin (the widget shows the origin and the whole script); `browser_upload` of a file outside the worktree |
| Layout | | `open_pane_tab`, `focus_thread`, `split_with`, `close_pane`, `show_file`, `open_changes` | |
| User | | `ask_side_chat`, `notify_user` (1 per thread per minute) | |
| Settings | `get_settings` (every setting with value, allowed values and whether it's locked; a profile's with `profileId`; `section`; shortcuts only with `section: keyboard`), `get_keybindings` (every command's chord now and default, the fixed keys, this platform's reserved chords) | | `update_settings(changes[], reason)`, `set_keybinding(command, keys, onConflict?, reason)` (setting) |
| Profiles | `list_profiles` (accounts with login state, GitHub account, which is yours) | | setting: `add_mcp_server`; destructive: `remove_mcp_server`, `remove_profile` |

**Settings** (`src/runtime/settingsTools.ts`, catalog in `src/settings/catalog.ts`). One catalog holds every setting in Mochi once: label, control, where the value lives (prefs, theme, quiet hours, main's settings, account links, the profile, its config files), how it's read and written, and whether an agent may suggest it. Settings' sections and the widget both render its rows (`CatalogRow`), so a setting looks and works the same in both. `get_settings` reads it; `update_settings` validates each change (known key, not locked, a value the control takes, not the current one, plus account and model rules) and opens one widget with all of them. Locked for agents: `agentControl`, `permissions`, `threadModels` (an agent can't widen its own reach) and each harness's custom path (it picks the program that runs every agent with your login); API keys and account creation aren't settings here at all. Profile settings are the caller's profile unless a change names another `profileId`; the widget names that profile, and reading another profile's settings asks on a card first (so it needs Everything). Config-file rows (instructions, MCP servers, skills) write through Settings' own diff review (PR #31: preview, backup, stale check); an instructions suggestion opens the editor on the agent's text, unsaved. `add_mcp_server` fills Settings' add form (as JSON, so env and headers come along) and refuses any value `stripSecrets` would strip. Secrets never reach the agent: reads drop env and header values, mask credentials in commands and instructions (`[redacted]`, and a suggestion still holding it is refused), and list unset variables as "needs VAR". The widget is saved with the thread, so it keeps instructions as a hash for its Done record, never their text. `env.settings` is a `Pick` of `host.settings` with no setter at all: the tools read, and only the destructive card writes. Account suggestions only name an existing account, only for a profile still on its harness's default, never with active threads on that harness (Auth above: never rotated). `remove_profile` refuses the last profile and any profile with threads, settled or not (Settings refuses the same), so never the caller's own. GAP: `section: profile` starts each enabled server for its tool count, like Settings' Test (up to 20s each, in parallel).

**Delete** (`delete` action): stops the live agent, removes the thread with its queue items, pane, side chats, checkpoints, fork records, layout leaves and saved state; the card's "Also remove its worktree" checkbox runs `git worktree remove` after. Not undoable.

**Browser.** `browser_snapshot` walks the page's DOM in an isolated world (the page can't see or touch it) and returns an indented role/name tree like Playwright's, with `[ref=eN]` on interactive elements; refs live in that world and reset on each snapshot. Clicks and keys go through CDP `Input.*` (trusted events); typing selects the field's text and inserts. While Mochi's window is on another Space the page is `hidden` and gets no hit testing, so a click falls back to a DOM `click()` and the result says it wasn't trusted; screenshots fall back from `capturePage` (empty or `UnknownVizError` there) to CDP `Page.captureScreenshot` (both seen in a production build, 2026-10-12). Local means `localhost`, `127.*`, `[::1]`, `0.0.0.0`, `*.localhost`, `*.test`, `about:`. Navigating to any other origin is allowed, logged, and toasts with Undo (= back). Tools act on a tab whose page is on screen: they select their tab in the pane, and fail with "focus_thread first" when the thread isn't showing, because a hidden native view has no size to render at. GAP: CDP coordinates are not checked against a zoomed or device-emulated page.


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

**Mochi background agents** (`start_background_agent`, `list_background_agents`, `stop_background_agent`): for work that should outlive the current turn. The tool adds a `mochi` subagent and starts it as a session of its own in `host.agent` (thread id `<thread>--<id>`), so it runs on the profile's account and, for Claude, counts toward the concurrency cap like any session (Codex has no cap yet). `worktree: same` runs it in the thread's worktree; `new` makes a worktree on `<branch>-<id>` branched off the thread's branch (`workspace.base`). Its events are folded into the parent as subagent events in the renderer (`fromBackground`): approvals and questions land on the parent's queue named after the agent, its spend counts toward the thread, its context doesn't. Its session stops after its first turn. On end it logs a line in the thread and leaves a note (`live.notes`) that goes to the thread's agent ahead of your next message; "Send to thread" sends it now. Start and stop are `change` tools (list is `read`), quiet: the chat row is their notice. A restart marks running agents stopped.

## Goals v2

Design in CHECKLIST §10–12 (decided 2026-10-13). Runtime pieces:

- **Drafting.** On a thread's first message, and on later messages while the thread has no goal, one background-model call returns `{ kind: 'task' | 'chat', outcome, criteria[], similar[] }`. `similar` judges a shortlist (word overlap against active goals and settled records in the profile). The agent starts at once; the draft lands when it returns and never blocks the send.
- **Plan prompting.** Goal threads get an instruction to keep their own plan current (Claude task tools, Codex `turn/plan/updated`); the plan still maps through `applyPlan`, without sizes and without a revision.
- **Mochi tools.** `report` (decisions, what's left, one question for you; once per turn), `claim_criterion` (criterion id + one line of evidence), `get_report` (read, for coordinators). `edit_goal` edits outcome and criteria; `add_step` and friends edit the plan without a revision. `propose_goal`: after its first look the agent proposes the concrete outcome and criteria; it waits for your Accept (`thread.proposal`, the row reads Goal to accept) or, with Settings › Goals › Apply, with undo, applies at once with an Undo. The background drafter still writes the provisional goal at send time.
- **Verification.** A checkable criterion's command runs in the thread's worktree (`threadCwd`), through main, with a timeout; output is kept on the criterion. It runs from the Run check button and when the agent goes idle after a turn that edited files (`useIdleChecks`); a claim alone doesn't run it.
- **Idle verdict.** When the agent goes idle, Mochi records `thread.idle` (uncommitted files, the transcript audit, gaps you accepted) and `idleVerdict` (`src/goals/verdict.ts`) reads it with the criteria checks, PR state and the stop itself: Done, Needs you, Gaps, Stalled, or plain Idle for a chat. Never from the agent's report.
- **Phase.** Derived in the renderer from what the thread already holds: no steps and no edits → Planning; edits → Building; a check run or claim → Verifying; all criteria met → Ready for review.
- **Context.** Report cards and simplifications are Mochi's own data: never sent to the agent, never in fork seeding or handoff summaries.

## Not verified yet (check before building on it)

- Env var the Agent SDK reads for the API key; the `user` tool_result message shape.
- Per-process memory of a Claude Agent SDK session; safe concurrency count.
- Whether app-server picks up an existing `codex login` without a login call; concurrent-turn limits.
- Whether `TaskCreate` / `TaskUpdate` replace `TodoWrite` on the default model (docs say "on certain models"; `CLAUDE_CODE_ENABLE_TASKS=0` forces TodoWrite).
- Whether runtime events say clearly enough when a test or check ran to drive the Verifying phase (check `src/runtime/apply.ts` event kinds before goals PR 5).
- How reliably Claude and Codex call an end-of-turn Mochi tool when asked; the background-model fallback covers misses.
- How to block `gh pr create` in Codex; the fallback replaces the body after the fact.
- How to attach screenshots to a PR body without a GitHub upload API (side branch or release assets).
- Whether a thread records the files it actually edited outside the plan's `footprint` (check before goals PR 4).
