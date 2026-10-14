import { useEffect, useRef } from 'react';
import { isWorking } from '../agentPhase.ts';
import { host } from '../host/index.ts';
import { IS_MAC } from '../keys.ts';
import { authorName, type ActivityEntry, type Compaction, type Thread } from '../model.ts';
import { getThreadPins, useAllPins, type Pin } from './pins.ts';
import { parseSlash } from './slash.ts';

/** One pin's share of the instructions, and all of them together: the summary has to stay much smaller than what it replaces. */
export const PIN_CHARS = 2000;
export const KEEP_CHARS = 8000;

/**
 * What Mochi asks the harness to carry through a compaction: the goal and its criteria, then your pins verbatim in transcript
 * order. Pins past `KEEP_CHARS` are left out (named by count), each clipped to `PIN_CHARS`. '' when there's nothing to keep.
 */
export function keptContext(thread: Thread, pins: Pin[]) {
  const goal = thread.goal ? [`Goal: ${thread.goal}`, ...(thread.criteria ?? []).map((c) => `- Done when: ${c.text}`)] : [];
  const pinned: string[] = [];
  let left = KEEP_CHARS - goal.join('\n').length;
  const sorted = [...pins].sort((a, b) => a.index - b.index);
  for (const pin of sorted) {
    const entry = thread.activity[pin.index] as ActivityEntry | undefined;
    if (!entry) continue;
    // The agent reads this: "You" would be itself.
    const line = `${pinned.length + 1}. ${entry.who === 'you' ? 'User' : authorName(entry.who)}: ${clip(pin.text || entry.text)}`;
    if (line.length > left) break;
    pinned.push(line);
    left -= line.length + 1;
  }
  const dropped = sorted.filter((p) => thread.activity[p.index]).length - pinned.length;
  const pinBlock = pinned.length ? ['Pinned by the user, each word for word, in this order:', ...pinned, ...(dropped > 0 ? [`(${dropped} more pinned left out for length)`] : [])] : [];
  return [...goal, ...(goal.length && pinBlock.length ? [''] : []), ...pinBlock].join('\n');
}

/** The custom compaction instructions Claude Code gets from Mochi's PreCompact hook. */
export function compactInstructions(kept: string) {
  return kept && `Keep the following in the summary verbatim; it outweighs everything else in the conversation.\n\n${kept}`;
}

/** Codex takes no compaction instructions: what Mochi would have asked it to keep goes to the agent after the compaction instead. */
export function restoreNote(kept: string, focus = '') {
  if (!kept && !focus) return '';
  return ['The conversation was just compacted. Mochi restores what the user asked to keep:', ...(focus ? [`Focus from here: ${focus}`] : []), ...(kept ? ['', kept] : [])].join('\n');
}

function clip(text: string) {
  const flat = text.trim();
  return flat.length > PIN_CHARS ? `${flat.slice(0, PIN_CHARS - 1)}…` : flat;
}

/** Whether `/compact` can run now: `run`, `queue` behind the turn (the message-queue rules), or `off` with why. */
export type CompactGate = { kind: 'run' } | { kind: 'queue' } | { kind: 'off'; reason: string };

export function compactGate(thread: Thread, isQueueing: boolean, isWaitingOnYou = false): CompactGate {
  const { live } = thread;
  if (!live || !thread.session) return off('Nothing to compact until the agent has started');
  if (live.isDetached) return off('Send a message first: the agent reconnects with it');
  if (live.starting) return off('The agent is still starting');
  if (isCompacting(thread)) return off('Already compacting');
  if (isWaitingOnYou) return off('Answer the agent first');
  if (!isWorking(thread)) return { kind: 'run' };
  return isQueueing ? { kind: 'queue' } : off(`${authorName(thread.providers[0])} is working: hold ${IS_MAC ? '⌘' : 'Ctrl'} to queue it`);
}

const off = (reason: string): CompactGate => ({ kind: 'off', reason });

export function isCompacting(thread: Thread) {
  return thread.activity.findLast((e) => e.compaction)?.compaction?.status === 'running';
}

/** `/compact focus` → `'focus'`; anything else → null. Queued messages carry it as typed. */
export function compactFocus(text: string) {
  const command = parseSlash(text);
  return command?.command.name === 'compact' ? command.arg : null;
}

/** The work-log entry a compaction opens: what Mochi asked it to keep, and the context it started from. */
export function compactionEntry(thread: Thread, at: number, trigger: Compaction['trigger'], focus?: string): ActivityEntry {
  const pins = getThreadPins(thread.id).filter((p) => thread.activity[p.index]).length;
  const compaction: Compaction = { trigger, status: 'running', pins, hasGoal: !!thread.goal, ...(focus && { focus }), ...(thread.context.used > 0 && { preTokens: thread.context.used }) };
  return { at, who: 'harness', kind: 'event', text: 'Compacting the conversation', compaction };
}

/** Keeps main's copy of each live Claude thread's instructions current, so auto-compaction keeps your pins too. */
export function useCompactInstructions(threads: Thread[]) {
  const pins = useAllPins();
  const sent = useRef(new Map<string, string>());
  useEffect(() => {
    for (const thread of threads) {
      if (!thread.live || thread.session?.provider !== 'claude') continue;
      const text = compactInstructions(keptContext(thread, pins[thread.id] ?? []));
      if (sent.current.get(thread.id) === text) continue;
      sent.current.set(thread.id, text);
      host.agent.compactInstructions(thread.id, text).catch((error: unknown) => console.error('Sending compaction instructions failed', error));
    }
  }, [threads, pins]);
}
