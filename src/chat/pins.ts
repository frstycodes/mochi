import { persistedSlice } from '../lib/uiStorage.ts';
import { useStore } from 'zustand';
import { setAmbientPins } from '../store/context.ts';

/** A pinned message, or a passage inside one, kept per thread so it can be found again from the chat's outline rail. */
export interface Pin {
  id: string;
  /** Position of the message in the thread's activity. */
  index: number;
  /** The pinned passage; empty pins the whole message. */
  text: string;
}

export const PINS_STORAGE_KEY = 'harness.pins.v1';
export type Pins = Record<string, Pin[]>;

const pinsSlice = persistedSlice<Pins>(PINS_STORAGE_KEY, {});
const getPins = () => pinsSlice.getState().value;
const EMPTY: Pin[] = [];

/** Outside React. */
export const getThreadPins = (threadId: string) => getPins()[threadId] ?? EMPTY;

setAmbientPins(getPins);

export function useThreadPins(threadId: string) {
  return useStore(pinsSlice, (s) => s.value[threadId] ?? EMPTY);
}

/** Pins the passage, or the whole message when `text` is empty; pinning the same thing twice unpins it. */
export function togglePin(threadId: string, index: number, text = '') {
  const list = getPins()[threadId] ?? [];
  const passage = normalise(text);
  const existing = list.find((p) => p.index === index && p.text === passage);
  set(
    threadId,
    existing
      ? list.filter((p) => p !== existing)
      : [...list, { id: `${index}:${Date.now()}`, index, text: passage }].sort(
          (a, b) => a.index - b.index,
        ),
  );
  return !existing;
}

export function unpin(threadId: string, id: string) {
  set(
    threadId,
    (getPins()[threadId] ?? []).filter((p) => p.id !== id),
  );
}

let pruned: { threadId: string; list: Pin[] } | null = null;

/** After a rewind the transcript is shorter: pins on messages that are gone go with them, until the rewind is undone. */
export function prunePins(threadId: string, messageCount: number) {
  const list = getPins()[threadId] ?? [];
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

export function useAllPins() {
  return useStore(pinsSlice, (s) => s.value);
}

/** Every thread's pins at once (Settings › Data and storage clears them); returns what was there, for an undo. */
export function replaceAllPins(next: Pins) {
  const previous = getPins();
  write(next);
  return previous;
}

function set(threadId: string, list: Pin[]) {
  write({ ...getPins(), [threadId]: list });
}

function write(next: Pins) {
  pinsSlice.setState({ value: next });
}
