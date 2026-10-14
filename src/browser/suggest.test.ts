import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inlineCompletion, rankSuggestions, type Candidate } from './suggest.ts';

const history = (url: string, title = ''): Candidate => ({ kind: 'history', url, title });

test('rankSuggestions puts a URL prefix above title and substring matches', () => {
  const ranked = rankSuggestions('git', [history('https://example.com/digit', 'Digits'), history('https://docs.example.com', 'Git basics'), history('https://github.com/', 'GitHub')]);
  assert.deepEqual(
    ranked.map((c) => c.url),
    ['https://github.com/', 'https://docs.example.com', 'https://example.com/digit'],
  );
});

test('rankSuggestions prefers open tabs and servers, then recent and shorter history', () => {
  const ranked = rankSuggestions('local', [
    history('http://localhost:3000/settings'),
    history('http://localhost:3000/'),
    { kind: 'server', url: 'http://localhost:5173', title: 'vite' },
    { kind: 'tab', url: 'http://localhost:4000/', title: 'Admin', tabId: 't1' },
  ]);
  assert.deepEqual(
    ranked.map((c) => c.kind),
    ['tab', 'server', 'history', 'history'],
  );
  assert.equal(ranked[2].url, 'http://localhost:3000/');
});

test('rankSuggestions keeps one entry per URL, the best kind', () => {
  const ranked = rankSuggestions('exa', [history('https://example.com/'), { kind: 'tab', url: 'https://www.example.com', title: 'Example', tabId: 't' }]);
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].kind, 'tab');
});

test('rankSuggestions drops non-matches, caps the list, and lists everything for an empty query', () => {
  assert.deepEqual(rankSuggestions('zzz', [history('https://example.com')]), []);
  const many = Array.from({ length: 20 }, (_, i) => history(`https://site${i}.com`));
  assert.equal(rankSuggestions('site', many).length, 6);
  assert.equal(rankSuggestions('', many, 3).length, 3);
});

test('inlineCompletion completes the URL as shown, case-insensitively, never a search', () => {
  assert.equal(inlineCompletion('gith', 'https://www.github.com/'), 'ub.com');
  assert.equal(inlineCompletion('GitH', 'https://github.com/frstycodes'), 'ub.com/frstycodes');
  assert.equal(inlineCompletion('localhost:5', 'http://localhost:5173'), '173');
  assert.equal(inlineCompletion('github.com', 'https://github.com/'), null);
  assert.equal(inlineCompletion('react hooks', 'https://react.dev'), null);
  assert.equal(inlineCompletion('docs', 'https://example.com/docs'), null);
  assert.equal(inlineCompletion('', 'https://example.com'), null);
});
