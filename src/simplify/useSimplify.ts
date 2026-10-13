import { useCallback, useEffect, useState, useSyncExternalStore, type Dispatch } from 'react';
import { toast } from 'sonner';
import { host } from '../host';
import type { Thread } from '../model';
import { getPrefs } from '../settings/prefs';
import type { Action } from '../store';
import { localSimplify, rulesKey, simplifyPrompt, wordCount } from './simplify';

// Messages being simplified right now, as `threadId:index`, so the bar and the row can show it.
const pending = new Set<string>();
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));

export const useIsSimplifying = (threadId: string, index: number) => useSyncExternalStore(subscribe, () => pending.has(`${threadId}:${index}`));

/** Shows a reply's stored bullets, or makes them with the Simplify settings when there are none or they're out of date. */
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
    const answer = host.isDesktop ? await host.agent.utility('simplify', thread.spaceId, simplifyPrompt(entry.text, prefs)).catch(() => null) : null;
    if (host.isDesktop && !answer) toast('Simplified without a model', { description: 'No background model answered, so this is a plain cut of the reply.' });
    dispatch({ type: 'simplified', threadId: thread.id, index, text: answer?.trim() || localSimplify(entry.text, prefs.simplifyLength), rulesKey: rules });
  } finally {
    pending.delete(key);
    changed();
  }
}

// Once per message per launch, so turning auto off and on doesn't re-run old replies.
const autoDone = new Set<string>();

/** With Settings › Simplify › auto on: a long reply is simplified once its thread goes idle. */
export function useAutoSimplify(threads: Thread[], dispatch: Dispatch<Action>) {
  useEffect(() => {
    const prefs = getPrefs();
    if (!prefs.simplifyAuto) return;
    for (const t of threads) {
      if (t.live?.isWorking || t.status === 'running') continue;
      const index = t.activity.findLastIndex((e) => e.kind === 'message' && (e.who === 'claude' || e.who === 'codex'));
      const entry = t.activity[index];
      const key = `${t.id}:${index}:${entry?.at}`;
      if (!entry || entry.simplified || autoDone.has(key) || wordCount(entry.text) < prefs.simplifyAutoWords) continue;
      autoDone.add(key);
      void simplify(t, index, dispatch);
    }
  }, [threads, dispatch]);
}

const REVEAL_MS = 1600;

/** True for a moment after a reply's bullets arrive, so they come in with the chat's word reveal. */
export function useSimplifyReveal(threadId: string, index: number) {
  const isSimplifying = useIsSimplifying(threadId, index);
  const [isRevealing, setRevealing] = useState(false);
  const [wasSimplifying, setWasSimplifying] = useState(isSimplifying);
  if (wasSimplifying !== isSimplifying) {
    setWasSimplifying(isSimplifying);
    if (!isSimplifying) setRevealing(true);
  }
  useEffect(() => {
    if (!isRevealing) return;
    const timer = setTimeout(() => setRevealing(false), REVEAL_MS);
    return () => clearTimeout(timer);
  }, [isRevealing]);
  return { isSimplifying, isRevealing };
}
