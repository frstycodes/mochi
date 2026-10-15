import { BrowserWindow } from 'electron';
import type { AgentEvent } from '../../src/host/types/agent.ts';
import { mainWindow } from '../window.ts';

type Tap = (event: AgentEvent) => void;
type SeqEvent = AgentEvent & { seq: number };

const taps = new Set<Tap>();
const busy = new Set<string>();
let whenClosed: Tap = () => {};

// Starts at the clock so a number saved last launch is always below this launch's.
let seq = Date.now();
const kept = new Map<string, SeqEvent[]>();
// GAP: a reload takes a second or two; a thread logging more than this meanwhile loses the oldest. Replaying from the session transcript would lift the cap.
const MAX_KEPT = 500;

/** Every thread agent event goes through here: watchers see it first, then open windows get it; with no main window (the one holding the store), `whenClosed` keeps it. */
export function emitAgentEvent(event: AgentEvent) {
  if (event.type === 'turn-end' || event.type === 'limit') busy.delete(event.threadId);
  const numbered = { ...event, seq: ++seq };
  remember(numbered);
  for (const tap of taps) tap(event);
  if (!mainWindow()) whenClosed(event);
  for (const win of openWindows()) win.webContents.send('agent:onEvent', numbered);
}

/** The thread's events after `after`, for a window that reloaded while its agent ran. */
export const eventsSince = (threadId: string, after: number) => (kept.get(threadId) ?? []).filter((e) => e.seq > after);

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

/** Set once by the scheduler, which keeps events for the next window. */
export function keepWhenClosed(keep: Tap) {
  whenClosed = keep;
}

/** A thread's agent has a turn in flight, from `start` / `send` until it ends or hits its limit. */
export const markBusy = (threadId: string) => void busy.add(threadId);
export const markIdle = (threadId: string) => void busy.delete(threadId);
export const isBusy = (threadId: string) => busy.has(threadId);

export const openWindows = () => BrowserWindow.getAllWindows().filter((w) => !w.webContents.isDestroyed());
