import { useSyncExternalStore } from 'react';

/** A pinned message, or a passage inside one, kept per thread so it can be found again from the chat's outline rail. */
export interface Pin {
  id: string;
  /** Position of the message in the thread's activity. */
  index: number;
  /** The pinned passage; empty pins the whole message. */
  text: string;
}

const KEY = 'harness.pins.v1';
type Pins = Record<string, Pin[]>;

let pins: Pins = load();
const listeners = new Set<() => void>();
const EMPTY: Pin[] = [];

export function useThreadPins(threadId: string) {
  return useSyncExternalStore(subscribe, () => pins[threadId] ?? EMPTY);
}

/** Pins the passage, or the whole message when `text` is empty; pinning the same thing twice unpins it. */
export function togglePin(threadId: string, index: number, text = '') {
  const list = pins[threadId] ?? [];
  const passage = normalise(text);
  const existing = list.find((p) => p.index === index && p.text === passage);
  set(threadId, existing ? list.filter((p) => p !== existing) : [...list, { id: `${index}:${Date.now()}`, index, text: passage }].sort((a, b) => a.index - b.index));
  return !existing;
}

export function unpin(threadId: string, id: string) {
  set(threadId, (pins[threadId] ?? []).filter((p) => p.id !== id));
}

let pruned: { threadId: string; list: Pin[] } | null = null;

/** After a rewind the transcript is shorter: pins on messages that are gone go with them, until the rewind is undone. */
export function prunePins(threadId: string, messageCount: number) {
  const list = pins[threadId] ?? [];
  pruned = { threadId, list };
  const kept = list.filter((p) => p.index < messageCount);
  if (kept.length !== list.length) set(threadId, kept);
}

export function restorePrunedPins(threadId: string) {
  if (pruned?.threadId !== threadId) return;
  set(threadId, pruned.list);
  pruned = null;
}

export function isMessagePinned(list: Pin[], index: number) {
  return list.some((p) => p.index === index && !p.text);
}

export function normalise(text: string) {
  return text.replace(/\s+/g, ' ').trim().slice(0, 280);
}

function set(threadId: string, list: Pin[]) {
  pins = { ...pins, [threadId]: list };
  try {
    localStorage.setItem(KEY, JSON.stringify(pins));
  } catch {
    // Private windows and blocked storage: pins still work for this session.
  }
  listeners.forEach((l) => l());
}

function load(): Pins {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Pins;
  } catch {
    return {};
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
