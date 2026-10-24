// No node built-ins here: the window serving the `reactor` capability imports these types.

/**
 * What a reactor rule asks for. `key` is the outbox `command_id`: a second command with the same key is never enqueued, so a
 * rule may emit the same command on every event while it stays due.
 */
export type ReactorCommand =
  | { type: 'queue.send'; key: string; threadId: string; messageId: string }
  | { type: 'delegate.report'; key: string; threadId: string; subagentId: string }
  | { type: 'subthread.wake'; key: string; threadId: string }
  /** Due at `resetsAt` (the outbox's `available_at`). */
  | { type: 'limit.resume'; key: string; threadId: string; resetsAt?: string }
  /** Core runs the utility model, then sends the window `title.apply`. */
  | { type: 'title.generate'; key: string; threadId: string; spaceId: string; prompt: string }
  | { type: 'idle.gather'; key: string; threadId: string }
  | { type: 'simplify.auto'; key: string; threadId: string }
  | { type: 'compact.instructions'; key: string; threadId: string }
  | { type: 'pr.refresh'; key: string; threadId: string }
  | { type: 'drafts.prune'; key: string; threadId: string };

/** What Core asks the window that owns the store to do: every command but `title.generate`, which becomes `title.apply`. */
export type WindowCommand = Exclude<ReactorCommand, { type: 'title.generate' }> | { type: 'title.apply'; key: string; threadId: string; title: string };
