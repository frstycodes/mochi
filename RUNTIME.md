# Agent runtime

How threads stop running on the `tick` simulation and start running real Claude Code and Codex agents. Read with [SESSIONS.md](SESSIONS.md) (how work is split) and [CHECKLIST.md](CHECKLIST.md).

Status labels: **verified** = read in this repo; **docs** = read in the vendor's docs or source by a research agent on 2026-10-12, not yet run here (links inline); **decision** = ours to make, made here.

## Decisions

1. **Agents run in the Electron main process**, one per thread, in that thread's worktree (`threadCwd`, `src/host/cwd.ts`, filled in by the worktree manager). The renderer never holds credentials or child processes; it talks through `host.agent`.
2. **Claude: the Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk`), one `query()` per thread with streaming input. It is Claude Code as a library: built-in tools, hooks, permissions, sessions, file checkpoints ([docs](https://code.claude.com/docs/en/agent-sdk/overview.md)).
3. **Codex: one `codex app-server` child process** speaking JSON-RPC over stdio, holding every Codex thread (`thread/start` per thread, each with its own `cwd`). OpenAI recommends app-server for deep product integrations; it is what the VS Code extension uses. The `@openai/codex-sdk` spawns `codex exec` per turn and has no approval callbacks, so it doesn't fit ([docs](https://learn.chatgpt.com/docs/app-server); `openai/codex` `sdk/typescript/src/exec.ts`).
4. **One normalized event stream.** Both adapters translate their protocol into `AgentEvent`s (below); the store only ever sees those. The `tick` simulation becomes a third adapter, `demo`, emitting the same events, so the web build and the artifact keep working with no runtime.
5. **The harness goal stays canonical.** The agent's own plan (TodoWrite / Codex plan updates) is mapped onto goal steps; it never replaces them. Overlap detection, revisions and the metro board keep working unchanged.
6. **Defaults:** Claude model `claude-opus-5-5`; the drift classifier's small model `claude-haiku-5-5` (current Haiku). Codex model: whatever the user's Codex config defaults to until the model picker sends one.

## Auth

- **Claude: API key, not the user's subscription login.** The Agent SDK overview says third-party products may not offer claude.ai login or its rate limits and should use API-key auth ([docs](https://code.claude.com/docs/en/agent-sdk/overview.md)). The key is entered once in settings, stored with Electron `safeStorage` (OS keychain), and passed to the SDK through `options.env`. `env` **replaces** the child environment, so spread `process.env` into it or `PATH` disappears (docs). Exact env var name the SDK reads: not verified, check the Quickstart before building.
- **Codex: its own account flow.** app-server exposes `account/read` and `account/login/start` with `chatgpt`, `chatgptDeviceCode` or `apiKey`; credentials live in `~/.codex/auth.json` or the keyring (docs). Whether an existing `codex login` is picked up with no extra step: not verified.
- The space's `accounts` (`Space.accounts` in `src/model.ts`, verified) become real: each space maps to a Claude key and a Codex account. Until then, one of each, app-wide.

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
- Handoff (`src/rewind/handoff.ts`, verified GAP) becomes: stop the current agent, start the other provider in the same worktree with the generated summary as its first prompt.

## Side chat, drift guard, usage

- Side chat `ask`: a separate, read-only query — Claude Agent SDK with `allowedTools: []` and `permissionMode: 'plan'`, or the plain Anthropic SDK; it never touches the thread's session. Decide at build time; the plain SDK is lighter.
- Drift classifier (`src/drift.ts`, verified GAP): `classify` in main with `claude-haiku-5-5`, structured output `{ verdict: 'on-goal' | 'scope-add' | 'off-goal', reason }`; the local `similarity()` pass still decides clear cases first.
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
| R1 | `claude`: Agent SDK adapter, `safeStorage` key, permission modes, resume/fork, file checkpoints | `electron/agents/claude/**` |
| R1 | `codex`: app-server process manager, JSON-RPC client, account login flow, approvals | `electron/agents/codex/**` |
| R1 | `settings`: accounts per space (Claude key, Codex login), concurrency cap, default models | `src/settings/**` |
| R2 | wire-ups: real side chat `ask`, drift `classify`, usage numbers, handoff, rewind through the SDK | the GAP sites listed above |

Wave 3 of SESSIONS.md (scheduled threads, team spaces, replay, voice, mobile, settings sync) starts after R2.

## Not verified yet (check before building on it)

- Env var the Agent SDK reads for the API key; the `user` tool_result message shape.
- Per-process memory of a Claude Agent SDK session; safe concurrency count.
- Whether app-server picks up an existing `codex login` without a login call; concurrent-turn limits.
- Whether `TaskCreate` / `TaskUpdate` replace `TodoWrite` on the default model (docs say "on certain models"; `CLAUDE_CODE_ENABLE_TASKS=0` forces TodoWrite).
