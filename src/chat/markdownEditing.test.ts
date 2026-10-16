import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EditorSelection, EditorState, type StateCommand, type Transaction } from '@codemirror/state';
import { continueMarkup, markdownSupport, nestListItems, outdentListItems } from './markdownEditing.ts';

/** Types `keys` into an empty composer: strings are typed at the caret, commands run as their key would. */
function type(...keys: (string | StateCommand)[]) {
  let state = EditorState.create({ extensions: markdownSupport });
  const dispatch = (tr: Transaction) => void (state = tr.state);
  for (const key of keys) {
    if (typeof key === 'function') key({ state, dispatch });
    else dispatch(state.update(state.replaceSelection(key)));
  }
  return state;
}

const text = (...keys: (string | StateCommand)[]) => type(...keys).doc.toString();

test('Shift+Enter continues a list and an empty item ends it', () => {
  assert.equal(text('- one', continueMarkup, 'two', continueMarkup, continueMarkup), '- one\n- two\n');
  assert.equal(text('1. first', continueMarkup, 'second', continueMarkup), '1. first\n2. second\n3. ');
  assert.equal(text('* a', continueMarkup), '* a\n* ');
});

test('Shift+Enter outside a list is a plain newline', () => {
  assert.equal(text('hello', continueMarkup, 'world'), 'hello\nworld');
});

test('Tab nests under the item above, Shift+Tab moves back out', () => {
  assert.equal(text('- one', continueMarkup, nestListItems, 'two'), '- one\n  - two');
  assert.equal(text('1. one', continueMarkup, nestListItems, 'two'), '1. one\n   2. two');
  assert.equal(text('- one', continueMarkup, nestListItems, nestListItems, 'two'), '- one\n  - two');
  assert.equal(text('- one', continueMarkup, nestListItems, outdentListItems, 'two'), '- one\n- two');
});

test('Tab off a list is left to the browser', () => {
  const state = type('plain');
  assert.equal(nestListItems({ state, dispatch: () => {} }), false);
  assert.equal(outdentListItems({ state, dispatch: () => {} }), false);
});

test('Tab nests every selected item', () => {
  let state = type('- a\n- b\n- c');
  state = state.update({ selection: EditorSelection.range(4, state.doc.length) }).state;
  nestListItems({ state, dispatch: (tr) => void (state = tr.state) });
  assert.equal(state.doc.toString(), '- a\n  - b\n  - c');
});

test('markdown is kept exactly as typed', () => {
  const typed = '**bold** and `code` with snake_case_name\n\n```ts\nconst a = 1;\n```\n# Heading\n> quote\n* star\n3) three';
  assert.equal(text(typed), typed);
});
