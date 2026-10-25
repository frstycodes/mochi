import { Effect, Schedule } from 'effect';
import { mayHaveEdited } from '../../../../apps/desktop/src/chat/turnChanges.ts';
import type {
  CheckRun,
  GitStatus,
} from '../../../../apps/desktop/src/host/types/git.ts';
import type { Criterion, Thread } from '../../../../apps/desktop/src/model.ts';
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
import {
  auditPrompt,
  parseAudit,
} from '../../../../apps/desktop/src/utility/prompts.ts';
import type { GitHub } from '../github/service.ts';
import type { Outcome } from './worker.ts';

/**
 * What the reactor's host-backed commands use: Core's dispatch, main's `host` through the capability client (no desktop
 * client, as under `serve`, fails a call at once with `CapabilityUnavailable`), the utility model and GitHub.
 */
export interface HostWork {
  readonly apply: (action: Action) => Effect.Effect<void, unknown>;
  readonly host: (
    tag: 'git.status' | 'git.runCheck',
    args: ReadonlyArray<unknown>,
  ) => Effect.Effect<unknown, unknown>;
  readonly utility: (
    thread: Thread,
    task: 'audit' | 'simplify',
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

/** A turn's end with goals on: criterion checks, uncommitted files and the transcript audit, then the idle record says it's done. */
export const gatherIdle = (
  work: HostWork,
  state: State,
  t: Thread | undefined,
): Effect.Effect<Outcome, unknown> =>
  Effect.gen(function* () {
    if (!t?.live || t.live.isWorking) return 'skipped';
    yield* work.apply({ type: 'idle-start', threadId: t.id });
    yield* Effect.all(
      [
        runChecks(work, t, prefsOf(state)),
        countUncommitted(work, t),
        audit(work, t),
      ],
      { concurrency: 'unbounded', discard: true },
    );
    yield* work.apply({
      type: 'idle-update',
      threadId: t.id,
      patch: { isGathering: false },
    });
  });

/** One at a time: two test suites at once in one worktree fight over ports and temp files. */
const runChecks = (work: HostWork, t: Thread, prefs: ProjectionPrefs) =>
  Effect.gen(function* () {
    // Only a turn that could have changed files can have changed a check's result; one after a plain question keeps the last
    // results, unless a check has never run: a criterion with a command isn't met until it has.
    const isUnchecked = (t.criteria ?? []).some((c) => c.command && !c.check);
    if (
      !t.goal ||
      prefs.idleChecks === 'off' ||
      (prefs.idleChecks === 'edited' &&
        !mayHaveEdited(t.activity) &&
        !isUnchecked)
    )
      return;
    for (const c of t.criteria ?? []) yield* runCheck(work, t, c);
  });

const runCheck = (work: HostWork, t: Thread, criterion: Criterion) =>
  Effect.gen(function* () {
    const cwd = checkFolder(t, criterion);
    if (!cwd || !criterion.command) return;
    const result = (yield* work
      .apply({
        type: 'criterion-check',
        threadId: t.id,
        criterionId: criterion.id,
        result: 'running',
      })
      .pipe(
        Effect.andThen(work.host('git.runCheck', [cwd, criterion.command])),
        Effect.catch((error) =>
          Effect.succeed<CheckRun>({
            exitCode: null,
            output: messageOf(error),
            ms: 0,
          }),
        ),
      )) as CheckRun;
    yield* work.apply({
      type: 'criterion-check',
      threadId: t.id,
      criterionId: criterion.id,
      result,
    });
  });

/** The thread's worktree (or its folder-mode project), as `checkBlockedReason` in src/goals/checks.ts allows it. */
function checkFolder(t: Thread, criterion: Criterion) {
  if (!t.repo || criterion.check?.status === 'running') return null;
  // Running in the project folder would test someone else's checkout, not this thread's changes.
  if (t.repo.mode !== 'folder' && !startEnv().worktreePath(t)) return null;
  return startEnv().threadCwd(t);
}

const countUncommitted = (work: HostWork, t: Thread) =>
  Effect.gen(function* () {
    const cwd = startEnv().threadCwd(t);
    if (!cwd) return;
    const status = (yield* work.host('git.status', [cwd])) as GitStatus;
    yield* work.apply({
      type: 'idle-update',
      threadId: t.id,
      patch: { uncommitted: status.files.length },
    });
  }).pipe(Effect.ignore);

/** Tasks only: a chat's reply is the answer you're reading anyway. */
const audit = (work: HostWork, t: Thread) =>
  Effect.gen(function* () {
    const { start, replies } = lastTurn(t);
    if (!t.goal || start < 0 || !replies.length) return;
    const text = yield* work.utility(
      t,
      'audit',
      auditPrompt(t.activity[start]!.text, replies),
    );
    const result = text && parseAudit(text, replies);
    if (result)
      yield* work.apply({
        type: 'idle-update',
        threadId: t.id,
        patch: { audit: result },
      });
  });

/** Your newest message's index (-1 for none) and the agents' replies after it, oldest first. */
function lastTurn(t: Thread) {
  const start = t.activity.findLastIndex(
    (e) => e.who === 'you' && e.kind === 'message',
  );
  const replies = t.activity
    .slice(start + 1)
    .flatMap((e) =>
      e.kind === 'message' && (e.who === 'claude' || e.who === 'codex')
        ? [e.text]
        : [],
    );
  return { start, replies };
}

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

// `CapabilityUnavailable` says no desktop client is connected to run it.
const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
