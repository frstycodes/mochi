import type { Thread } from '../model';
import { shallowEqual, useHarnessSelector } from '../store';
import { answersOf, decisionsOf, NO_MARKS, proposalsOf } from './logbook';
import type { Logbook } from './LogbookRows';
import { useAllAnswerMarks, useAnswerMarks } from './marks';

export function useThreadLogbook(thread: Thread): Logbook & { now: number } {
  const marks = useAnswerMarks(thread.id);
  const now = useHarnessSelector((s) => s.now);
  return {
    now,
    answers: answersOf(thread, marks),
    decisions: decisionsOf(thread),
    proposals: proposalsOf(thread, now),
  };
}

/** Every thread in this space with its logbook; settled threads included. */
export function useSpaceLogbooks() {
  const threads = useHarnessSelector(
    (s) => s.threads.filter((t) => t.spaceId === s.spaceId),
    shallowEqual,
  );
  const allMarks = useAllAnswerMarks();
  const now = useHarnessSelector((s) => s.now);
  const logs = threads.map((thread) => ({
    thread,
    log: {
      answers: answersOf(thread, allMarks[thread.id] ?? NO_MARKS),
      decisions: decisionsOf(thread),
      proposals: proposalsOf(thread, now),
    } satisfies Logbook,
  }));
  return { logs, now };
}
