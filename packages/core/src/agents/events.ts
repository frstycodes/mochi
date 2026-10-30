import type { AgentEvent } from '../../../../apps/desktop/src/host/types/agent.ts';

type Tap = (event: AgentEvent) => void;
export type SeqEvent = AgentEvent & { seq: number };

/** What Core sends main for its windows: `channel` is the preload channel, `windowId` the one window it is for (else every window). */
export interface Push {
  readonly channel: string;
  readonly payload: unknown;
  readonly windowId?: number;
}

const taps = new Set<Tap>();
const pushes = new Set<(push: Push) => void>();
const busy = new Set<string>();
const busyListeners = new Set<() => void>();
let log: (event: SeqEvent) => void = () => {};

// Starts at the clock so a number saved last launch is always below this launch's.
let seq = Date.now();
const kept = new Map<string, SeqEvent[]>();
// GAP: a reload takes a second or two; a thread logging more than this meanwhile loses the oldest. Replaying from the session transcript would lift the cap.
const MAX_KEPT = 500;

/** Set once by the agents layer: appends each event to Core's log. */
export const useEventLog = (append: (event: SeqEvent) => void) =>
  void (log = append);

/** Every thread agent event goes through here: logged, then Core's own taps, then main relays it to the windows. */
export function emitAgentEvent(event: AgentEvent) {
  if (event.type === 'turn-end' || event.type === 'limit')
    markIdle(event.threadId);
  // As JSON from here on (log, replay, push): adapters leave optional fields undefined, which the socket's encoder refuses.
  const numbered = JSON.parse(
    JSON.stringify({ ...event, seq: ++seq }),
  ) as SeqEvent;
  remember(numbered);
  log(numbered);
  for (const tap of taps) tap(event);
  push({ channel: 'agent:onEvent', payload: numbered });
}

/**
 * To main, which hands it to the windows (`electron/agents/events.ts`). As JSON: adapters leave optional fields undefined, which
 * the socket's encoder refuses, and one refused item would end the stream.
 */
export function push(item: Push) {
  const json = JSON.parse(JSON.stringify(item)) as Push;
  for (const listener of pushes) listener(json);
}

export function onPush(listener: (push: Push) => void) {
  pushes.add(listener);
  return () => void pushes.delete(listener);
}

/** The thread's events after `after`, for a window that reloaded while its agent ran. */
export const eventsSince = (threadId: string, after: number) =>
  (kept.get(threadId) ?? []).filter((e) => e.seq > after);

/** The agent process is gone: nothing left to replay. */
export const forgetEvents = (threadId: string) => void kept.delete(threadId);

function remember(event: SeqEvent) {
  const list = kept.get(event.threadId) ?? [];
  list.push(event);
  if (list.length > MAX_KEPT) list.shift();
  kept.set(event.threadId, list);
}

export function onAgentEvent(tap: Tap) {
  taps.add(tap);
  return () => void taps.delete(tap);
}

/** A thread's agent has a turn in flight, from `start` / `send` until it ends or hits its limit. */
export const markBusy = (threadId: string) => setBusy(threadId, true);
export const markIdle = (threadId: string) => setBusy(threadId, false);
export const isBusy = (threadId: string) => busy.has(threadId);
export const busyThreads = () => [...busy];
export const isAnyBusy = () => busy.size > 0;

/** Fires when the first turn starts or the last one ends: remote access's keep-awake follows it. */
export function onBusy(listener: () => void) {
  busyListeners.add(listener);
  return () => void busyListeners.delete(listener);
}

function setBusy(threadId: string, isBusy: boolean) {
  if (busy.has(threadId) === isBusy) return;
  const was = busy.size > 0;
  if (isBusy) busy.add(threadId);
  else busy.delete(threadId);
  if (was !== busy.size > 0) busyListeners.forEach((listener) => listener());
  push({ channel: BUSY_CHANNEL, payload: busyThreads() });
}

/** Not a window channel: main drops it; a subscriber learns which threads are working. */
export const BUSY_CHANNEL = 'mochi:busy';
