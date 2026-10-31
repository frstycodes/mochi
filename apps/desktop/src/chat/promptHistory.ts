import type { EditorView } from '@codemirror/view';
import { persistedSlice } from '../lib/uiStorage.ts';

export const PROMPT_HISTORY_MAX = 200;

const sentPrompts = persistedSlice<string[]>('mochi.promptHistory', []);

/** Where Up and Down stand in the sent prompts: `null` on your own draft, else how many steps back from the newest. */
export type HistoryCursor = { at: number | null; draft: string };

export function rememberPrompt(text: string) {
  const prompt = text.trim();
  if (!prompt) return;
  sentPrompts.setState(({ value }) => ({ value: addPrompt(value, prompt) }));
}

/** Like a shell with `HIST_IGNORE_ALL_DUPS`: sending a prompt again moves it to the newest. */
export function addPrompt(
  prompts: string[],
  prompt: string,
  max = PROMPT_HISTORY_MAX,
) {
  return [...prompts.filter((p) => p !== prompt), prompt].slice(-max);
}

/** The cursor one step older (`-1`) or newer (`1`), or `null` when there is nowhere to go. */
export function stepHistory(
  count: number,
  at: number | null,
  direction: -1 | 1,
): { at: number | null } | null {
  if (direction === -1) {
    const next = at === null ? 0 : at + 1;
    return next < count ? { at: next } : null;
  }
  if (at === null) return null;
  return { at: at === 0 ? null : at - 1 };
}

/**
 * Up on the first line recalls older prompts, Down on the last line newer ones, back to the draft you were writing, like a
 * terminal. The caret lands where the next press keeps going: the start after Up, the end after Down.
 */
export function browseHistory(
  view: EditorView,
  cursor: HistoryCursor,
  direction: -1 | 1,
) {
  const { state } = view;
  const { main } = state.selection;
  if (!main.empty) return false;
  const line = state.doc.lineAt(main.head).number;
  if (direction === -1 ? line !== 1 : line !== state.doc.lines) return false;
  const prompts = sentPrompts.getState().value;
  const step = stepHistory(prompts.length, cursor.at, direction);
  if (!step) return false;
  if (cursor.at === null) cursor.draft = state.doc.toString();
  cursor.at = step.at;
  const text =
    step.at === null ? cursor.draft : prompts[prompts.length - 1 - step.at];
  view.dispatch({
    changes: { from: 0, to: state.doc.length, insert: text },
    selection: { anchor: direction === -1 ? 0 : text.length },
    scrollIntoView: true,
  });
  return true;
}
