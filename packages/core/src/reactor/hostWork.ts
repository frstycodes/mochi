import { Effect, Schedule } from 'effect';
import type { Thread } from '../../../../apps/desktop/src/model.ts';
import { startEnv } from '../../../../apps/desktop/src/runtime/startEnv.ts';
import {
  localSimplify,
  rulesKey,
  simplifyPrompt,
  wordCount,
} from '../../../../apps/desktop/src/simplify/simplify.ts';
import {
  DEFAULT_CONTEXT,
  type ProjectionPrefs,
} from '../../../../apps/desktop/src/store/context.ts';
import { seePrs } from '../../../../apps/desktop/src/store/threads.ts';
import type {
  Action,
  State,
} from '../../../../apps/desktop/src/store/types.ts';
import type { GitHub } from '../github/service.ts';
import type { Outcome } from './worker.ts';

/**
 * What the reactor's host-backed commands use: Core's dispatch, the utility model and GitHub.
 */
export interface HostWork {
  readonly apply: (action: Action) => Effect.Effect<void, unknown>;
  readonly utility: (
    thread: Thread,
    task: 'simplify',
    prompt: string,
  ) => Effect.Effect<string | null>;
  readonly github: GitHub['Service'];
  readonly current: Effect.Effect<State>;
}

/** After a push, how often and how many times Core reads the branch's PRs: GitHub lists a new PR some seconds after `gh pr create`. */
const PR_READS = { schedule: Schedule.spaced('20 seconds'), times: 5 };

/** A context Core saved before a pref joined it lacks that pref until a window migrates it: the default meanwhile. */
const prefsOf = (state: State): ProjectionPrefs => ({
  ...DEFAULT_CONTEXT.prefs,
  ...state.context.prefs,
});

/**
 * With Settings › Simplify › auto on, a long last reply gets its simplified version: the utility model's, else a plain cut.
 * Skipped when the reply no longer needs it. GAP: the reply's row doesn't show it simplifying meanwhile.
 */
export const autoSimplify = (
  work: HostWork,
  state: State,
  t: Thread | undefined,
): Effect.Effect<Outcome, unknown> =>
  Effect.gen(function* () {
    if (!t || t.live?.isWorking) return 'skipped';
    const prefs = prefsOf(state);
    const index = t.activity.findLastIndex(
      (e) => e.kind === 'message' && (e.who === 'claude' || e.who === 'codex'),
    );
    const entry = t.activity[index];
    if (
      !prefs.simplifyAuto ||
      t.status === 'running' ||
      !entry ||
      entry.simplified ||
      wordCount(entry.text) < prefs.simplifyAutoWords
    )
      return 'skipped';
    const answer = yield* work.utility(
      t,
      'simplify',
      simplifyPrompt(entry.text, prefs),
    );
    yield* work.apply({
      type: 'simplified',
      threadId: t.id,
      index,
      text: answer?.trim() || localSimplify(entry.text, prefs.simplifyLength),
      rulesKey: rulesKey(prefs),
    });
  });

/**
 * A push or `gh pr` in the thread's worktree: GitHub polls it fast for whoever watches it, and Core records the branch's PRs
 * itself for a couple of minutes, so a PR made with no window open still lands on `thread.prs`. Skipped without a worktree.
 * GAP: the reads stop with Core; the next window's PR sync picks up from there.
 */
export const refreshPrs = (
  work: HostWork,
  state: State,
  t: Thread | undefined,
): Effect.Effect<Outcome, unknown> =>
  Effect.gen(function* () {
    const worktree = t?.live && startEnv().worktreePath(t);
    if (!t || t.status === 'settled' || !t.repo?.path || !worktree)
      return 'skipped';
    const githubUser =
      state.context.profiles?.find((p) => p.id === t.spaceId)?.github ||
      undefined;
    yield* work.github
      .refresh({ cwd: worktree, githubUser, isPush: true })
      .pipe(Effect.ignore);
    const record = Effect.gen(function* () {
      const prs = (yield* work.github.worktreePrs([worktree], githubUser)).map(
        (found) => found.pr,
      );
      const now = yield* work.current;
      if (seePrs(now, t.id, prs) === now) return;
      yield* work.apply({ type: 'prs-seen', threadId: t.id, prs });
    }).pipe(Effect.ignore);
    yield* Effect.forkDetach(Effect.repeat(record, PR_READS));
  });
