import type {
  AgentDecision,
  AgentRunOptions,
  AgentSendInput,
} from '../../../../apps/desktop/src/host/types/agent.ts';

/** One harness's live sessions, by Mochi thread id. Every method but `start` is a no-op (or false/null) for a thread it doesn't hold. */
export interface HarnessAdapter {
  has(threadId: string): boolean;
  /** Every thread with a session open or still starting. */
  threadIds(): string[];
  start(
    threadId: string,
    options: AgentRunOptions,
    signal?: AbortSignal,
  ): Promise<void>;
  /**
   * `input.policy` applies before the message is read; a field it leaves unset keeps the session's. Codex's `turn/steer` takes no
   * overrides, so a steered message's policy holds there from the next turn.
   */
  send(threadId: string, input: AgentSendInput): Promise<void>;
  /** False once the steered message went to the agent. */
  unsteer(threadId: string, steerId: string): Promise<boolean>;
  /** `focus` is what to keep (Claude's `/compact <focus>`); Codex's `thread/compact/start` takes none. */
  compact(threadId: string, focus: string): Promise<void>;
  interrupt(threadId: string): Promise<void>;
  stop(threadId: string): Promise<void>;
  stopTask(threadId: string, taskId: string): Promise<void>;
  /** Answers a pending approval or question; false when the request isn't this harness's. */
  respond(requestId: string, decision: AgentDecision): Promise<boolean>;
  /** The transcript point just before the latest sent message with this text, for `forkAt`; null when unknown or it was the first. */
  rewindPoint(threadId: string, text: string): Promise<string | null>;
  /** Rewinds the harness's own file checkpoints to before that message (Claude only; Codex keeps none). */
  rewindFiles?(threadId: string, text: string): Promise<void>;
  /** What a live session runs on, with the policy its latest message set. */
  runOptions(threadId: string): AgentRunOptions | undefined;
}
