import { BrowserWindow } from 'electron';
import type { AgentEvent } from '../../src/host/types/agent.ts';
import { mainWindow } from '../window.ts';

type Tap = (event: AgentEvent) => void;

const taps = new Set<Tap>();
const busy = new Set<string>();
let whenClosed: Tap = () => {};

/** Every thread agent event goes through here: watchers see it first, then open windows get it; with no main window (the one holding the store), `whenClosed` keeps it. */
export function emitAgentEvent(event: AgentEvent) {
  if (event.type === 'turn-end' || event.type === 'limit') busy.delete(event.threadId);
  for (const tap of taps) tap(event);
  if (!mainWindow()) whenClosed(event);
  for (const win of openWindows()) win.webContents.send('agent:onEvent', event);
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
