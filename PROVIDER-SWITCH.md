# Switching providers mid-thread

Replaces the handoff (`src/rewind/handoff.ts`, `runHandoff.ts`, the `handoff*` reducer actions, `HandoffRow`). Built on the `migration` branch after `agents-core` merges: it needs Core's `events` table, `agents` service, utility queue and reactor.

## What's wrong today

**Mochi's handoff** sends a one-shot prompt: goal, steps, your last 3 messages cut to 140 characters, diff totals, optionally rewritten by a utility model from the last 12 messages (15 s timeout, then the raw template). No tool calls, outputs, file names, diffs or images; nothing older is reachable; every handoff starts from zero.

**T3 Code** (read at `d53873b6`) does better on bookkeeping and worse on content:

| | T3 | Problem |
|---|---|---|
| "Summary" | Raw recent items, newest first, plus the first user message (`ContextHandoffService.ts:475`) | Not a summary: on a long thread the middle, where decisions were made, is gone |
| Budget | 16 k "tokens" counted as JSON bytes, 64 k byte ceiling (`handoffBudget.ts:109-136`) | Roughly 4–5 k real tokens of context (estimate, not measured) |
| Oversized items | Dropped whole (`tryAdd`), smaller older ones fill the gap | The long reply or big command output that held the result is the usual casualty |
| Tool structure | Only messages, commands, file names, errors, plans survive; `file_change` has no diff; subagents, searches, reasoning, todos, approvals dropped | The new agent can't see what was tried |
| Delivery | History prepended to the user's message for every provider but Codex | Past assistant text sits in the user role, permanently, in the new native transcript |
| Older context | `t3_thread_read` MCP tool, mentioned once | Nothing points the agent at the specific thing it's missing |
| Full target | Budget 0 → the turn fails | Switching back to a busy session errors instead of degrading |
| Unclear inject | Delivery stays `pending` → native thread thrown away next turn | One transport hiccup loses the target's whole context |

What T3 gets right, and we keep: per-target delta tracking (switching back sends only what's new), a delivery ledger, explicitly detaching old sessions, a lazy switch applied on the next send.

## Design

### 1. The event log is the transcript

Core's `events` table (#324) already orders every thread event by `seq`. Every provider session the thread has used gets a binding row:

```
thread_sessions(threadId, provider, nativeSessionId, model, lastSeenSeq, state: 'active' | 'detached' | 'lost')
```

`lastSeenSeq` advances only when the provider acknowledges a turn that carried those events. That ledger is what delta delivery and retries read.

### 2. A rolling brief, kept current, never made at switch time

A reactor rule queues a `brief` job (utility queue, `handoff` priority) when a turn ends, debounced, if the brief is more than ~N events behind. The job folds the events after `brief.throughSeq` into the previous brief, so its cost is per turn, not per thread length. Output (schema in `packages/schema`):

- goal and success criteria, as the thread currently understands them
- decisions with their reasons, and what was ruled out
- current state: branch, files changed and why, what's verified, what's broken
- open questions, the plan's pending steps, user preferences stated in the thread
- **chapters**: seq ranges with one line each (`412–530 · migrated the auth store, tests red on refresh`)

Stored as `thread_briefs(threadId, throughSeq, brief)`. At switch time it's already there: no 15 s wait, no template fallback. `/compact` uses the same brief.

### 3. The context package

Assembled in Core by a pure function `contextPackage(brief, events, target, budget)`, so it's testable on fixtures:

1. **Brief** (always included; it is the floor).
2. **Delta since the brief**: the events after `throughSeq`, verbatim.
3. **Recent window**: the last turns, verbatim, newest first, until the budget is spent. Large items are **cut, not dropped**: head and tail kept, the middle replaced with `[… 3,912 lines, thread_history get seq=488]`. Diffs keep their hunks up to a cap, then a pointer.
4. **Live ground truth**, read from the worktree at assembly, not from the transcript: `git status`, `git diff --stat`, current branch and HEAD.
5. **What changed for you**: tools, skills and MCP servers the previous provider had that this one doesn't (and the reverse).

Budget in real tokens: an estimate (chars/4) calibrated per provider against the `usage` each turn reports, sized to the target model's window minus a reserve for the reply and for the native transcript a resumed session already holds. If even the brief doesn't fit, send the brief's top section plus the chapter index and rely on the tool. **The turn never fails for lack of budget.**

### 4. Delivered as context, not as the user

- **Claude**: the package goes in the session's appended system prompt for a fresh session. For a resumed one it's a system-reminder block on the turn, never user text.
- **Codex**: `thread/inject_items` as developer and assistant items in their real roles.
- The user's message stays exactly what they typed.

### 5. `thread_history`: older parts on demand

A read-only Core procedure over `events`, served as `mcp__mochi__thread_history` (beside the existing `mcp__mochi__*` tools), scoped to the thread:

| op | returns |
|---|---|
| `outline` | the brief's chapters with seq ranges |
| `read {fromSeq, toSeq}` | events in range, paged, byte-capped, tool calls with inputs and outputs |
| `search {query}` | FTS5 hits over message text, tool inputs and outputs: seq plus snippet |
| `get {seq}` or `get {toolCallId}` | one item in full: complete output, the whole diff, images as image blocks |

Every pointer in the package is a `thread_history` call the agent can copy, which addresses T3's "the agent has to think of looking". Instruction line: *"Earlier work in this thread is in thread_history; check it before redoing or contradicting something."* The tool is useful on its own, before any switch: after a compaction, the same agent gets back what was compacted away.

### 6. The switch

Core command `thread.switchProvider {threadId, provider, model}`:

1. Between turns: recorded at once. Mid-turn: you choose *after this turn* (queued) or *now* (interrupts, then records it).
2. The old session is **detached**, not deleted: its binding keeps `nativeSessionId` and `lastSeenSeq`. Pending approvals are cancelled with an event row. Its running subagents finish and report to the thread as they do today.
3. On the next send:
   - The target has a resumable binding: resume it and deliver only the delta (brief changes plus events after its `lastSeenSeq`).
   - Otherwise: a fresh session with the full package.
4. Ledger: `context.delivered {provider, sessionId, throughSeq, packageHash}` is written when the provider acknowledges the turn. An unclear result retries the same package once on the same session. Only after that does it fall back to a fresh session, with an event row saying so. A detached native session is never abandoned silently.

Plan steps, goal and criteria are Mochi's and carry over untouched. The worktree is shared, so uncommitted edits carry over too.

### 7. UI

- The composer's provider and model picker stays unlocked in a live thread. Picking another provider shows *"Switches on your next message"*.
- A divider row replaces `HandoffRow`, for example: *Switched to Codex · GPT-5.5 — brief, 6 recent turns, 11.8k tokens*. It opens to the exact package that was sent, so it's always clear what the new agent knows.
- Existing `entry.handoff` rows keep rendering, read as switch rows. No migration of old data.

## Phases

1. **Schema**: `thread_sessions`, `thread_briefs`, the package, `thread_history` results, `context.delivered`.
2. **`thread_history`**, plus FTS5 over events. Ships alone; helps after compaction today.
3. **Brief job and reactor rule.** Point `/compact` at it.
4. **`contextPackage`, the switch command, delta delivery and the ledger.** Fixture tests:
   - a 2,000-event thread fits a 32 k window
   - an oversized output is cut with a pointer
   - switching back sends only the delta
   - a zero budget degrades to the brief instead of failing
   - an unclear inject retries before detaching
5. **UI, then delete the handoff code.**

## Open questions

- Should `thread_history` also reach sub-threads and the parent (read-only)? It's cheap to add and useful for coordinators; scope creep for v1.
- How far behind the brief may run before a switch waits for it: proposed one turn, and otherwise the delta covers the gap verbatim.
