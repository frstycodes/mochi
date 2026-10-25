import type { Dispatch } from 'react';
import { mayHaveEdited } from '../chat/turnChanges';
import { host } from '../host';
import { threadCwd } from '../host/cwd';
import type { Thread } from '../model';
import type { Action } from '../store';
import { getPrefs } from '../settings/prefs';
import { auditPrompt, parseAudit } from '../utility/prompts';
import { runUtility } from '../utility/runUtility';
import { runCriterionCheck } from './checks';

/** When a thread's agent goes idle (the reactor's `idle.gather`), gathers what its verdict reads (`verdict.ts`): criterion checks, then uncommitted files and the transcript audit. */
export function gatherIdle(t: Thread, dispatch: Dispatch<Action>) {
  if (!t.live) return;
  if (getPrefs().goals) void gather(t, dispatch);
  else markIdle(t, dispatch);
}

/** Without goals there is nothing to gather, but each turn still needs its own idle record: the end-of-turn card reads it. */
function markIdle(t: Thread, dispatch: Dispatch<Action>) {
  dispatch({ type: 'idle-start', threadId: t.id });
  dispatch({
    type: 'idle-update',
    threadId: t.id,
    patch: { isGathering: false },
  });
}

async function gather(t: Thread, dispatch: Dispatch<Action>) {
  dispatch({ type: 'idle-start', threadId: t.id });
  await Promise.all([
    runChecks(t, dispatch),
    countUncommitted(t, dispatch),
    audit(t, dispatch),
  ]);
  dispatch({
    type: 'idle-update',
    threadId: t.id,
    patch: { isGathering: false },
  });
}

/** One at a time: two test suites at once in one worktree fight over ports and temp files. */
async function runChecks(t: Thread, dispatch: Dispatch<Action>) {
  const when = getPrefs().idleChecks;
  // Only a turn that could have changed files can have changed a check's result; one after a plain question keeps the last
  // results, unless a check has never run: a criterion with a command isn't met until it has.
  const isUnchecked = (t.criteria ?? []).some((c) => c.command && !c.check);
  if (
    !t.goal ||
    when === 'off' ||
    (when === 'edited' && !mayHaveEdited(t.activity) && !isUnchecked)
  )
    return;
  for (const c of t.criteria ?? [])
    if (c.command) await runCriterionCheck(dispatch, t, c);
}

async function countUncommitted(t: Thread, dispatch: Dispatch<Action>) {
  const cwd = threadCwd(t);
  if (!cwd || !host.isDesktop) return;
  const status = await host.git.status(cwd).catch(() => null);
  if (status)
    dispatch({
      type: 'idle-update',
      threadId: t.id,
      patch: { uncommitted: status.files.length },
    });
}

/** Tasks only: a chat's reply is the answer you're reading anyway. */
async function audit(t: Thread, dispatch: Dispatch<Action>) {
  const { start, replies } = lastTurn(t);
  if (!t.goal || start < 0 || !replies.length || !host.isDesktop) return;
  const text = await runUtility(
    'audit',
    t.spaceId,
    auditPrompt(t.activity[start].text, replies),
    t.id,
  ).catch((error: unknown) => {
    console.warn('Turn not audited', error);
    return null;
  });
  const result = text && parseAudit(text, replies);
  if (result)
    dispatch({ type: 'idle-update', threadId: t.id, patch: { audit: result } });
}

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
