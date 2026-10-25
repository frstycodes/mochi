// No node built-ins here: the window serving the `reactor` capability imports these types.

/**
 * What a reactor rule asks for. `key` is the outbox `command_id`: a second command with the same key is never enqueued, so a
 * rule may emit the same command on every event while it stays due.
 */
export type ReactorCommand =
  | { type: 'queue.send'; key: string; threadId: string; messageId: string }
  | {
      type: 'delegate.report';
      key: string;
      threadId: string;
      subagentId: string;
    }
  | { type: 'subthread.wake'; key: string; threadId: string }
  /** Due at `resetsAt` (the outbox's `available_at`). */
  | { type: 'limit.resume'; key: string; threadId: string; resetsAt?: string }
  /** Core runs the utility model and names the thread and its temp branch. */
  | {
      type: 'title.generate';
      key: string;
      threadId: string;
      spaceId: string;
      prompt: string;
    }
  /** Goals off: the turn's idle record, which the end-of-turn card reads; Core applies it. */
  | { type: 'idle.mark'; key: string; threadId: string }
  /** Goals on: checks, uncommitted files and the audit, which need a window's host. */
  | { type: 'idle.gather'; key: string; threadId: string }
  | { type: 'simplify.auto'; key: string; threadId: string }
  | { type: 'compact.instructions'; key: string; threadId: string }
  | { type: 'pr.refresh'; key: string; threadId: string }
  | { type: 'drafts.prune'; key: string; threadId: string };

/** What Core still asks a window to do (any window that serves `reactor`): work that needs a window's host or storage. */
export type WindowCommand = Extract<
  ReactorCommand,
  { type: 'idle.gather' | 'simplify.auto' | 'pr.refresh' | 'drafts.prune' }
>;
