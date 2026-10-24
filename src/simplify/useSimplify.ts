import { useCallback, useSyncExternalStore, type Dispatch } from 'react';
import { toast } from '../toast/store.ts';
import { host } from '../host';
import type { Thread } from '../model';
import { getPrefs } from '../settings/prefs';
import type { Action } from '../store';
import { runUtility } from '../utility/runUtility';
import { localSimplify, rulesKey, simplifyPrompt, wordCount } from './simplify';

// Messages being simplified right now, as `threadId:index`, so the bar and the row can show it.
const pending = new Set<string>();
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));

export const useIsSimplifying = (threadId: string, index: number) => useSyncExternalStore(subscribe, () => pending.has(`${threadId}:${index}`));

/** Shows a reply's stored simplified version, or makes them with the Simplify settings when there are none or they're out of date. */
export function useSimplify(dispatch: Dispatch<Action>) {
  return useCallback((thread: Thread, index: number) => simplify(thread, index, dispatch), [dispatch]);
}

async function simplify(thread: Thread, index: number, dispatch: Dispatch<Action>) {
  const entry = thread.activity[index];
  const key = `${thread.id}:${index}`;
  if (!entry || pending.has(key)) return;
  const prefs = getPrefs();
  const rules = rulesKey(prefs);
  if (entry.simplified?.rulesKey === rules) return dispatch({ type: 'simplify-toggle', threadId: thread.id, index });
  pending.add(key);
  changed();
  try {
    const answer = host.isDesktop ? await runUtility('simplify', thread.spaceId, simplifyPrompt(entry.text, prefs), thread.id).catch(() => null) : null;
    if (host.isDesktop && !answer) toast('Simplified without a model', { description: 'No background model answered, so this is a plain cut of the reply.' });
    dispatch({ type: 'simplified', threadId: thread.id, index, text: answer?.trim() || localSimplify(entry.text, prefs.simplifyLength), rulesKey: rules });
  } finally {
    pending.delete(key);
    changed();
  }
}

// Once per message per launch, so turning auto off and on doesn't re-run old replies.
const autoDone = new Set<string>();

/** With Settings › Simplify › auto on: a long reply is simplified once its thread goes idle (the reactor's `simplify.auto`). */
export function autoSimplify(t: Thread, dispatch: Dispatch<Action>) {
  const prefs = getPrefs();
  if (!prefs.simplifyAuto || t.live?.isWorking || t.status === 'running') return;
  const index = t.activity.findLastIndex((e) => e.kind === 'message' && (e.who === 'claude' || e.who === 'codex'));
  const entry = t.activity[index];
  const key = `${t.id}:${index}:${entry?.at}`;
  if (!entry || entry.simplified || autoDone.has(key) || wordCount(entry.text) < prefs.simplifyAutoWords) return;
  autoDone.add(key);
  void simplify(t, index, dispatch);
}
