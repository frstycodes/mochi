import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import { contextPackage, tokensOf, type PackageInput } from './package.ts';
import type { TranscriptItem } from './transcript.ts';

const long: TranscriptItem[] = Array.from({ length: 2000 }, (_, i) => ({
  seq: i + 1,
  kind: i % 3 === 0 ? 'you' : i % 3 === 1 ? 'agent' : 'tool',
  text: `item ${i + 1} `.repeat(20),
  ...(i % 3 === 2 && { detail: 'output line\n'.repeat(300) }),
}));

const input = (over: Partial<PackageInput>): PackageInput => ({
  from: 'claude',
  to: 'codex',
  handoff: { text: '## Goal\nMigrate the auth store', by: 'claude' },
  items: long,
  sinceSeq: 0,
  ground: '',
  budget: 32_000,
  ...over,
});

test('a 2,000-event thread fits a 32k window: the handoff, then the newest turns that fit', () => {
  const pkg = contextPackage(input({}));
  assert.ok(pkg.tokens <= 32_000, `${pkg.tokens} tokens`);
  assert.equal(pkg.tokens, tokensOf(pkg.text));
  assert.match(
    pkg.text,
    /## Handoff \(written by Claude\)\n## Goal\nMigrate the auth store/,
  );
  assert.match(pkg.text, /\[2000\] Agent/, 'the newest item');
  assert.doesNotMatch(
    pkg.text,
    /\[1\] User/,
    'the oldest left to thread_history',
  );
  assert.match(pkg.text, /older ones: thread_history/);
  assert.match(
    pkg.text,
    /use the tool only when you need something it doesn't cover/,
  );
  assert.match(
    pkg.contents,
    /^handoff by Claude, \d+ recent turns, [\d.]+k tokens$/,
  );
});

test('an oversized output is cut with a pointer, head and tail kept', () => {
  const huge: TranscriptItem = {
    seq: 7,
    kind: 'tool',
    text: 'pnpm test',
    detail: `first line\n${'noise\n'.repeat(10_000)}last line`,
  };
  const pkg = contextPackage(input({ items: [huge] }));
  assert.match(pkg.text, /first line/);
  assert.match(pkg.text, /last line/);
  assert.match(pkg.text, /\[… [\d,]+ lines, thread_history get seq=7\]/);
});

test('a zero budget keeps the handoff and drops the turns instead of failing', () => {
  const pkg = contextPackage(input({ budget: 0 }));
  assert.match(pkg.text, /Migrate the auth store/);
  assert.doesNotMatch(pkg.text, /Latest turns/);
  assert.match(pkg.contents, /^handoff by Claude, [\d.]+k tokens$/);
});

test('a resumed session gets only what it missed; a fresh one after a limit says so and wrote its own handoff', () => {
  const missed = contextPackage(input({ sinceSeq: 1998, handoff: null }));
  assert.match(
    missed.text,
    /You are back on this thread after it ran on Claude/,
  );
  assert.match(missed.text, /\[1999\] User/);
  assert.doesNotMatch(missed.text, /\[1998\]/);
  const fresh = contextPackage(
    input({ to: 'claude', handoff: { text: 'Mine', by: 'claude' } }),
  );
  assert.match(
    fresh.text,
    /continues in a fresh session: the previous one ran out of usage/,
  );
  assert.match(
    fresh.text,
    /## Handoff \(written by you, from the transcript\)\nMine/,
  );
});
