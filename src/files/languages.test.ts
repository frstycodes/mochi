import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import { EditorState } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import { languageFor } from './languages.ts';

test('loads the selected grammar and leaves unknown file types as plain text', async () => {
  assert.equal(await languageFor('notes.txt'), undefined);
  for (const [path, text, tree] of [
    ['sample.PY', 'def f(): return 1', 'Script'],
    ['sample.jsonc', '{"x": 1}', 'JsonText'],
    ['sample.go', 'package main', 'SourceFile'],
  ]) {
    const support = await languageFor(path);
    assert.ok(support, path);
    const state = EditorState.create({ doc: text, extensions: [support] });
    assert.equal(syntaxTree(state).type.name, tree, path);
  }
});
