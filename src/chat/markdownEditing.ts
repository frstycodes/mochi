import { insertNewlineContinueMarkupCommand, markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { insertNewline } from '@codemirror/commands';
import type { EditorState, StateCommand } from '@codemirror/state';

/** GFM, keys bound by the composer itself, and nothing that rewrites what you type or paste. */
export const markdownSupport = markdown({ base: markdownLanguage, addKeymap: false, completeHTMLTags: false, pasteURLAsLink: false });

const LIST_ITEM = /^( *)([-*+]|\d+[.)])( +|$)/;

/** Shift+Enter: the next list item (or quote line), an empty item ends its list; a plain newline anywhere else. */
export const continueMarkup: StateCommand = (target) => continueInList(target) || insertNewline(target);

// A blank second item ends the list instead of turning it loose (CodeMirror's default inserts a blank line above it).
const continueInList = insertNewlineContinueMarkupCommand({ nonTightLists: false });

/** Tab: each selected list item nests under the item above it at its level. `false` off a list, so Tab still moves focus. */
export const nestListItems: StateCommand = ({ state, dispatch }) =>
  reindentItems(state, dispatch, (line, items) => {
    const sibling = items.findLast((item) => item.number < line.number && item.indent <= line.indent);
    return sibling?.indent === line.indent ? sibling.indent + sibling.width : line.indent;
  });

/** Shift+Tab: each selected list item moves out to its parent's level. */
export const outdentListItems: StateCommand = ({ state, dispatch }) =>
  reindentItems(state, dispatch, (line, items) => items.findLast((item) => item.number < line.number && item.indent < line.indent)?.indent ?? 0);

type Item = { number: number; from: number; indent: number; width: number };

function reindentItems(state: EditorState, dispatch: Parameters<StateCommand>[0]['dispatch'], indentFor: (line: Item, items: Item[]) => number) {
  const { from, to } = state.selection.main;
  const first = state.doc.lineAt(from).number;
  const last = state.doc.lineAt(to).number;
  const items = listItems(state, last);
  const selected = items.filter((item) => item.number >= first);
  if (!selected.length) return false;
  const changes = selected.map((item) => ({ from: item.from, to: item.from + item.indent, insert: ' '.repeat(indentFor(item, items)) }));
  dispatch(state.update({ changes, scrollIntoView: true, userEvent: 'input.indent' }));
  return true;
}

/** The list items on lines 1…`through`, read off each line's text (composer messages are short). */
function listItems(state: EditorState, through: number): Item[] {
  const items: Item[] = [];
  for (let n = 1; n <= through; n++) {
    const line = state.doc.line(n);
    const match = LIST_ITEM.exec(line.text);
    if (match) items.push({ number: n, from: line.from, indent: match[1].length, width: match[2].length + Math.max(match[3].length, 1) });
  }
  return items;
}
