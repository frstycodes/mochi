import type { Dispatch } from 'react';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { toast } from '../toast/store.ts';
import { host } from '../host';
import type { Thread } from '../model';
import { getPrefs } from '../settings/prefs';
import type { Action } from '../store';
import { runUtility } from '../utility/runUtility';
import { localSimplify, rulesKey, simplifyPrompt, wordCount } from './simplify';

// Messages being simplified right now, as `threadId:index`, so the bar and the row can show it.
const pendingStore = createStore<{ keys: ReadonlySet<string> }>(() => ({
  keys: new Set(),
}));
const setPending = (key: string, isPending: boolean) =>
  pendingStore.setState(({ keys }) => {
    const next = new Set(keys);
    if (isPending) next.add(key);
    else next.delete(key);
    return { keys: next };
  });

export const useIsSimplifying = (threadId: string, index: number) =>
  useStore(pendingStore, (s) => s.keys.has(`${threadId}:${index}`));

/** Shows a reply's stored simplified version, or makes them with the Simplify settings when there are none or they're out of date. */
export async function simplify(
  thread: Thread,
  index: number,
  dispatch: Dispatch<Action>,
) {
  const entry = thread.activity[index];
  const key = `${thread.id}:${index}`;
  if (!entry || pendingStore.getState().keys.has(key)) return;
  const prefs = getPrefs();
  const rules = rulesKey(prefs);
  if (entry.simplified?.rulesKey === rules)
    return dispatch({ type: 'simplify-toggle', threadId: thread.id, index });
  setPending(key, true);
  try {
    const answer = host.isDesktop
      ? await runUtility(
          'simplify',
          thread.spaceId,
          simplifyPrompt(entry.text, prefs),
          thread.id,
        ).catch(() => null)
      : null;
    if (host.isDesktop && !answer)
      toast('Simplified without a model', {
        description:
          'No background model answered, so this is a plain cut of the reply.',
      });
    dispatch({
      type: 'simplified',
      threadId: thread.id,
      index,
      text: answer?.trim() || localSimplify(entry.text, prefs.simplifyLength),
      rulesKey: rules,
    });
  } finally {
    setPending(key, false);
  }
}

// Once per message per launch, so turning auto off and on doesn't re-run old replies.
const autoDone = new Set<string>();

/** With Settings › Simplify › auto on: a long reply is simplified once its thread goes idle (the reactor's `simplify.auto`). */
export function autoSimplify(t: Thread, dispatch: Dispatch<Action>) {
  const prefs = getPrefs();
  if (!prefs.simplifyAuto || t.live?.isWorking || t.status === 'running')
    return;
  const index = t.activity.findLastIndex(
    (e) => e.kind === 'message' && (e.who === 'claude' || e.who === 'codex'),
  );
  const entry = t.activity[index];
  const key = `${t.id}:${index}:${entry?.at}`;
  if (
    !entry ||
    entry.simplified ||
    autoDone.has(key) ||
    wordCount(entry.text) < prefs.simplifyAutoWords
  )
    return;
  autoDone.add(key);
  void simplify(t, index, dispatch);
}
