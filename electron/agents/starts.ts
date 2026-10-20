import type { SetupChoice } from '../../src/host/types/agent.ts';

interface Pending {
  finished: Promise<void>;
  finish: () => void;
  abort: AbortController;
  answer?: (choice: SetupChoice) => void;
  keepsTitle?: boolean;
}

/**
 * Agent starts still preparing their folder (worktree setup). A message sent meanwhile waits here for the start instead of
 * finding no agent; an interrupt stops the setup; Retry / Skip setup answer a failed step.
 */
export class Starts {
  private pending = new Map<string, Pending>();

  /** Called by `start` before the folder is ready; `end()` once the agent runs or the start gave up. */
  begin(threadId: string) {
    this.pending.get(threadId)?.abort.abort();
    let finish = () => {};
    const finished = new Promise<void>((resolve) => (finish = resolve));
    const entry: Pending = { finished, finish, abort: new AbortController() };
    this.pending.set(threadId, entry);
    return {
      signal: entry.abort.signal,
      choose: () => new Promise<SetupChoice>((resolve) => (entry.answer = resolve)),
      keepsTitle: () => !!entry.keepsTitle,
      end: () => {
        if (this.pending.get(threadId) === entry) this.pending.delete(threadId);
        entry.finish();
      },
    };
  }

  /** Resolves once a start in progress for the thread has ended; at once when there is none. */
  wait(threadId: string) {
    return this.pending.get(threadId)?.finished ?? Promise.resolve();
  }

  isStarting(threadId: string) {
    return this.pending.has(threadId);
  }

  ids() {
    return [...this.pending.keys()];
  }

  /** Stops the thread's setup; false when nothing was starting. */
  abort(threadId: string) {
    const entry = this.pending.get(threadId);
    entry?.abort.abort();
    return !!entry;
  }

  /** You named the thread while it was starting: the start doesn't name it. */
  keepTitle(threadId: string) {
    const entry = this.pending.get(threadId);
    if (entry) entry.keepsTitle = true;
  }

  /** Answers a failed setup step; false when the thread isn't waiting on one. */
  choose(threadId: string, choice: SetupChoice) {
    const entry = this.pending.get(threadId);
    if (!entry?.answer) return false;
    entry.answer(choice);
    entry.answer = undefined;
    return true;
  }
}
