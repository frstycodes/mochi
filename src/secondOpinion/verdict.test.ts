import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import type { DiffFile } from '../host/types/git.ts';
import { findingsMessage, parseVerdict, reviewPrompt } from './verdict.ts';

test('parseVerdict accepts a structured-output object and normalizes findings', () => {
  const v = parseVerdict({
    verdict: 'concerns',
    summary: ' Mostly fine. ',
    findings: [
      { file: 'b/src/a.ts', line: 12, severity: 'high', text: 'Off by one' },
      { file: 'src/b.ts', line: null, severity: 'urgent', text: 'Unknown severity becomes medium' },
      { file: 'src/c.ts', line: 3, severity: 'low', text: '  ' },
      'not a finding',
    ],
  });
  assert.deepEqual(v, {
    verdict: 'concerns',
    summary: 'Mostly fine.',
    findings: [
      { file: 'src/a.ts', line: 12, severity: 'high', text: 'Off by one' },
      { file: 'src/b.ts', severity: 'medium', text: 'Unknown severity becomes medium' },
    ],
  });
});

test('parseVerdict finds the JSON object inside prose or a fence', () => {
  const v = parseVerdict('Here is my review:\n```json\n{"verdict":"approve","summary":"Looks right.","findings":[]}\n```');
  assert.equal(v.verdict, 'approve');
  assert.deepEqual(v.findings, []);
});

test('parseVerdict rejects answers that are not a verdict', () => {
  assert.throws(() => parseVerdict('I think it is fine'), /did not answer with a verdict/);
  assert.throws(() => parseVerdict({ verdict: 'lgtm', summary: 'x', findings: [] }), /Unknown verdict "lgtm"/);
  assert.throws(() => parseVerdict({ verdict: 'block', summary: '', findings: [] }), /no summary/);
  assert.throws(() => parseVerdict('{"verdict": "block",'), /did not answer with a verdict/);
});

test('reviewPrompt caps the diff and says so', () => {
  const thread = { title: 'T', goal: 'Do X', steps: [] };
  const file = { path: 'a.ts', kind: 'modified', staged: false, binary: false, added: 1, removed: 0, patch: 'x'.repeat(100), hunks: [] } satisfies DiffFile;
  const short = reviewPrompt(thread, { base: 'main', branch: 'b', files: [file] }, 200);
  assert.equal(short.isTruncated, false);
  const long = reviewPrompt(thread, { base: 'main', branch: 'b', files: [file] }, 50);
  assert.equal(long.isTruncated, true);
  assert.match(long.prompt, /truncated to its first 50 characters/);
  assert.ok(!long.prompt.includes('x'.repeat(51)));
});

test('findingsMessage names the reviewer and each finding', () => {
  const text = findingsMessage('codex', { verdict: 'block', summary: 'Breaks login.', findings: [{ file: 'src/a.ts', line: 4, severity: 'high', text: 'Null deref' }] });
  assert.match(text, /^Codex reviewed the diff \(verdict: block\): Breaks login\./);
  assert.match(text, /- \[high\] `src\/a.ts:4` Null deref/);
});
