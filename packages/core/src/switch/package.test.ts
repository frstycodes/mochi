import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import { contextPackage, tokensOf, type PackageInput } from './package.ts';
import type { TranscriptItem } from './transcript.ts';

const brief: NonNullable<PackageInput['brief']> = {
  throughSeq: 1900,
  brief: {
    goal: 'Migrate the auth store',
    decisions: Array.from({ length: 40 }, (_, i) => `Decision ${i}: kept`),
    ruledOut: [],
    state: 'tests red on refresh',
    open: [],
    preferences: [],
    chapters: [{ fromSeq: 412, toSeq: 530, line: 'migrated the auth store' }],
  },
};

const long: TranscriptItem[] = Array.from({ length: 2000 }, (_, i) => ({
  seq: i + 1,
  kind: i % 3 === 0 ? 'you' : i % 3 === 1 ? 'agent' : 'tool',
  text: `item ${i + 1} `.repeat(20),
  ...(i % 3 === 2 && { detail: 'output line\n'.repeat(300) }),
}));

const input = (over: Partial<PackageInput>): PackageInput => ({
  from: 'claude',
  brief,
  items: long,
  sinceSeq: 0,
  ground: '',
  budget: 32_000,
  ...over,
});

test('a 2,000-event thread fits a 32k window: the brief, then the newest turns that fit', () => {
  const pkg = contextPackage(input({}));
  assert.ok(pkg.tokens <= 32_000, `${pkg.tokens} tokens`);
  assert.equal(pkg.tokens, tokensOf(pkg.text));
  assert.match(pkg.text, /Decision 39: kept/);
  assert.match(pkg.text, /\[2000\] Agent/, 'the newest item');
  assert.doesNotMatch(
    pkg.text,
    /\[1\] User/,
    'the oldest left to thread_history',
  );
  assert.match(pkg.text, /older ones: thread_history/);
  assert.match(pkg.contents, /^brief, \d+ recent turns, [\d.]+k tokens$/);
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

test('a zero budget degrades to the brief outline instead of failing', () => {
  const pkg = contextPackage(input({ budget: 0 }));
  assert.match(pkg.text, /\*\*Goal:\*\* Migrate the auth store/);
  assert.match(pkg.text, /412–530 · migrated the auth store/);
  assert.doesNotMatch(pkg.text, /Decision 0/);
  assert.match(pkg.contents, /^brief outline, [\d.]+k tokens$/);
});

test('a resumed session gets only what it missed, and the brief outline once that overflows', () => {
  const missed = contextPackage(input({ sinceSeq: 1998 }));
  assert.doesNotMatch(missed.text, /## Brief/);
  assert.match(missed.text, /\[1999\] User/);
  assert.doesNotMatch(missed.text, /\[1998\]/);
  const overflow = contextPackage(input({ sinceSeq: 10, budget: 4_000 }));
  assert.match(overflow.text, /## Brief/);
});
