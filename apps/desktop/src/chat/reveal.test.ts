import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import { revealStep, revealedText } from './reveal.ts';

const FRAME_MS = 1000 / 60;

test('a reveal never passes its target and stands at it once caught up', () => {
  assert.equal(revealStep(0, 5, 1000), 5);
  assert.equal(revealStep(10, 10, FRAME_MS), 10);
  assert.equal(revealStep(12, 10, FRAME_MS), 10);
});

test('a small backlog still moves at the minimum pace', () => {
  const step = revealStep(0, 3, FRAME_MS);
  assert.ok(step >= 1.4 && step < 3, `step ${step}`);
});

test('a bigger backlog reveals more per frame, so the reveal catches up', () => {
  const small = revealStep(0, 40, FRAME_MS);
  const large = revealStep(0, 400, FRAME_MS);
  assert.ok(large > small * 5, `${small} vs ${large}`);
});

test('the pace does not depend on the frame rate', () => {
  let at60 = 0;
  for (let i = 0; i < 6; i++) at60 = revealStep(at60, 300, FRAME_MS);
  let at120 = 0;
  for (let i = 0; i < 12; i++) at120 = revealStep(at120, 300, FRAME_MS / 2);
  assert.ok(Math.abs(at60 - at120) < 1, `${at60} vs ${at120}`);
});

test('a chunk spreads over several frames and is all shown within half a second', () => {
  let at = 0;
  let frames = 0;
  while (at < 60 && frames < 100) {
    at = revealStep(at, 60, FRAME_MS);
    frames++;
  }
  assert.ok(frames > 5, `drained in ${frames} frames`);
  assert.ok(frames * FRAME_MS <= 500, `drained in ${frames} frames`);
});

test('a huge backlog jumps to the last stretch instead of reeling it all out', () => {
  assert.equal(revealStep(0, 10_000, FRAME_MS), 10_000 - 1200);
});

test('revealed text never splits an emoji', () => {
  assert.equal(revealedText('hi 👋 there', 4), 'hi 👋');
  assert.equal(revealedText('hi 👋 there', 3), 'hi ');
  assert.equal(revealedText('abc', 10), 'abc');
});
