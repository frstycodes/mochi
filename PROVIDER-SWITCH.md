# Switching providers mid-thread

Replaces the handoff (`src/rewind/handoff.ts`, `runHandoff.ts`, the `handoff*` reducer actions, `HandoffRow`). Built on the `migration` branch after `agents-core` merges: it needs Core's `events` table, `agents` service, utility queue and reactor.

## What's wrong today

**Mochi's handoff** sends a one-shot prompt: goal, steps, your last 3 messages cut to 140 characters, diff totals, optionally rewritten by a utility model from the last 12 messages (15 s timeout, then the raw template). No tool calls, outputs, file names, diffs or images; nothing older is reachable; every handoff starts from zero.

**T3 Code** (read at `d53873b6`) does better on bookkeeping and worse on content:

|                 | T3                                                                                                                                              | Problem                                                                              |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| "Summary"       | Raw recent items, newest first, plus the first user message (`ContextHandoffService.ts:475`)                                                    | Not a summary: on a long thread the middle, where decisions were made, is gone       |
| Budget          | 16 k "tokens" counted as JSON bytes, 64 k byte ceiling (`handoffBudget.ts:109-136`)                                                             | Roughly 4–5 k real tokens of context (estimate, not measured)                        |
| Oversized items | Dropped whole (`tryAdd`), smaller older ones fill the gap                                                                                       | The long reply or big command output that held the result is the usual casualty      |
| Tool structure  | Only messages, commands, file names, errors, plans survive; `file_change` has no diff; subagents, searches, reasoning, todos, approvals dropped | The new agent can't see what was tried                                               |
| Delivery        | History prepended to the user's message for every provider but Codex                                                                            | Past assistant text sits in the user role, permanently, in the new native transcript |
| Older context   | `t3_thread_read` MCP tool, mentioned once                                                                                                       | Nothing points the agent at the specific thing it's missing                          |
| Full target     | Budget 0 → the turn fails                                                                                                                       | Switching back to a busy session errors instead of degrading                         |
| Unclear inject  | Delivery stays `pending` → native thread thrown away next turn                                                                                  | One transport hiccup loses the target's whole context                                |

What T3 gets right, and we keep: per-target delta tracking (switching back sends only what's new), a delivery ledger, explicitly detaching old sessions, a lazy switch applied on the next send.

## Design

### 1. The event log is the transcript

Core's `events` table (#324) already orders every thread event by `seq`. Every provider session the thread has used gets a binding row:

```
thread_sessions(threadId, provider, nativeSessionId, model, lastSeenSeq, state: 'active' | 'detached' | 'lost')
```

`lastSeenSeq` advances only when the provider acknowledges a turn that carried those events. That ledger is what delta delivery and retries read.

### 2. A handoff, written at the next message

Picking another provider runs nothing: it records the switch, and the start your next message makes writes the handoff. Reasoning never crosses providers (both keep it encrypted in their own sessions, and the hidden part is never streamed), so the best author is the session that ran the thread:

- **Another provider, the old session has usage left**: the old native session is resumed on a side session (`<thread>--handoff`, read-only, events kept off the thread) for one turn that writes the handoff: goal and what done means, decisions and why (including reasons never written down), what was tried or ruled out, current state, open questions and next steps, the user's stated preferences.
- **The old session ran out of usage** (another provider, or another model of the same provider): the incoming model writes its own handoff from the whole transcript, long outputs cut with pointers, and starts a fresh session from it, so it doesn't carry the full context on every turn.
- **The transcript doesn't fit the incoming model's window** and the old session can't write: the incoming model folds it part by part, oldest first, each part into the handoff so far.
- **Another model of the same provider, usage left**: no handoff; the session resumes on the new model.

The switch row says "writing the handoff" while it runs; a failed or timed-out handoff turn never blocks the switch, the package then goes without one.

### 3. The context package

Assembled in Core by a pure function `contextPackage(handoff, events, target, budget)`, so it's testable on fixtures:

1. **Handoff** (always included; it is the floor).
2. **Recent window**: the last turns, verbatim, newest first, until the budget is spent. Large items are **cut, not dropped**: head and tail kept, the middle replaced with `[… 3,912 lines, thread_history get seq=488]`. Diffs keep their hunks up to a cap, then a pointer.
3. **Live ground truth**, read from the worktree at assembly, not from the transcript: `git status`, `git diff --stat`, current branch and HEAD.
4. **What changed for you**: tools, skills and MCP servers the previous provider had that this one doesn't (and the reverse).

Budget in real tokens: an estimate (chars/4) calibrated per provider against the `usage` each turn reports, sized to the target model's window minus a reserve for the reply and for the native transcript a resumed session already holds. If the recent turns don't fit, the handoff goes alone and the tool holds the rest. **The turn never fails for lack of budget.**

### 4. Delivered as context, not as the user

- **Claude**: the package goes in the session's appended system prompt for a fresh session. For a resumed one it's a system-reminder block on the turn, never user text.
- **Codex**: `thread/inject_items` as developer and assistant items in their real roles.
- The user's message stays exactly what they typed.

### 5. `thread_history`: older parts on demand

A read-only Core procedure over `events`, served as `mcp__mochi__thread_history` (beside the existing `mcp__mochi__*` tools), scoped to the thread:

| op                                | returns                                                                   |
| --------------------------------- | ------------------------------------------------------------------------- |
| `outline`                         | each turn's first line with its seq range                                 |
| `read {fromSeq, toSeq}`           | events in range, paged, byte-capped, tool calls with inputs and outputs   |
| `search {query}`                  | FTS5 hits over message text, tool inputs and outputs: seq plus snippet    |
| `get {seq}` or `get {toolCallId}` | one item in full: complete output, the whole diff, images as image blocks |

Every pointer in the package is a `thread_history` call the agent can copy, which addresses T3's "the agent has to think of looking". The handoff should be enough, so the instruction line says to pull history only when needed: _"What is here should be enough to go on: use the tool only when you need something it doesn't cover, such as an exact command output, a whole diff or an earlier message."_ The tool is useful on its own, before any switch: after a compaction, the same agent gets back what was compacted away.

### 6. The switch

Core command `thread.switchProvider {threadId, provider, model}`:

1. Between turns: recorded at once. Mid-turn: you choose _after this turn_ (queued) or _now_ (interrupts, then records it).
2. The old session is **detached**, not deleted: its binding keeps `nativeSessionId` and `lastSeenSeq`. Pending approvals are cancelled with an event row. Its running subagents finish and report to the thread as they do today.
3. On the next send:
   - The target has a resumable binding: resume it and deliver only the delta (the events after its `lastSeenSeq`).
   - Otherwise: a fresh session with the handoff (§2) and the package.
4. Ledger: `context.delivered {provider, sessionId, throughSeq, packageHash}` is written when the provider acknowledges the turn. An unclear result retries the same package once on the same session. Only after that does it fall back to a fresh session, with an event row saying so. A detached native session is never abandoned silently.

Plan steps, goal and criteria are Mochi's and carry over untouched. The worktree is shared, so uncommitted edits carry over too.

### 7. UI

- The composer's provider and model picker stays unlocked in a live thread. Picking another provider shows _"Switches on your next message"_.
- A divider row replaces `HandoffRow`, for example: _[Claude] Opus 5.5 → [Codex] GPT-5.5 · handoff by Claude, 6 recent turns, 11.8k tokens_. It opens to the exact package that was sent, so it's always clear what the new agent knows.
- Existing `entry.handoff` rows keep rendering, read as switch rows. No migration of old data.

## Phases

1. **Schema**: `thread_sessions`, the switch row and its `context` events, `thread_history` results.
2. **`thread_history`**. Ships alone; helps after compaction today.
3. **The handoff (§2), `contextPackage`, the switch command, delta delivery.** Fixture tests:
   - the old session writes the handoff; switching back sends only the delta
   - out of usage, the incoming model writes its own from the transcript; the same provider starts fresh
   - a transcript past the window folds part by part
   - an oversized output is cut with a pointer; a zero budget keeps the handoff instead of failing
4. **UI, then delete the drafting handoff code.**

## Open questions

- Should `thread_history` also reach sub-threads and the parent (read-only)? It's cheap to add and useful for coordinators; scope creep for v1.
- The delivery ledger and retry (§6.4) and per-model budgets calibrated against `usage` are not built yet.
