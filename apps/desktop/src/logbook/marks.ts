import { useStore } from 'zustand';
import { persistedSlice } from '../lib/uiStorage.ts';
import type { Thread } from '../model.ts';
import {
  NO_MARKS,
  toggledMarks,
  withoutAnswer,
  type AnswerMarks,
  type LoggedAnswer,
} from './logbook.ts';

// GAP: kept in this window's storage like pins, so saves and removals don't follow the thread to another computer.
const marksSlice = persistedSlice<Record<string, AnswerMarks>>(
  'harness.logbook.v1',
  {},
);
const marksOf = (threadId: string) =>
  marksSlice.getState().value[threadId] ?? NO_MARKS;

export function useAnswerMarks(threadId: string) {
  return useStore(marksSlice, (s) => s.value[threadId] ?? NO_MARKS);
}

export function useAllAnswerMarks() {
  return useStore(marksSlice, (s) => s.value);
}

export function toggleSavedReply(thread: Thread, index: number) {
  set(thread.id, toggledMarks(thread, marksOf(thread.id), index));
}

export function removeAnswer(threadId: string, answer: LoggedAnswer) {
  set(threadId, withoutAnswer(marksOf(threadId), answer));
}

function set(threadId: string, marks: AnswerMarks) {
  marksSlice.setState({
    value: { ...marksSlice.getState().value, [threadId]: marks },
  });
}
