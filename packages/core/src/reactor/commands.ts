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
  /** The turn's idle record, which the end-of-turn card reads; Core applies it. */
  | { type: 'idle.mark'; key: string; threadId: string }
  | { type: 'simplify.auto'; key: string; threadId: string }
  | { type: 'compact.instructions'; key: string; threadId: string }
  | { type: 'pr.refresh'; key: string; threadId: string };
