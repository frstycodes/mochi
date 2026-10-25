import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import {
  GAP,
  itemHeight,
  itemTransform,
  motionTiming,
  stackSlots,
} from './stack.ts';
import type { Toast } from './store.ts';

const toast = (id: string, isLeaving = false) => ({ id, isLeaving }) as Toast;
/** The seven durations, ignoring the slow-motion factor each is wrapped in. */
const durations = (timing: { transitionDuration: string }) =>
  [...timing.transitionDuration.matchAll(/(\d+)ms/g)].map((m) => Number(m[1]));

test('toasts stack below the ones in front; a leaving one keeps its index but gives up its height, as in Sonner', () => {
  const heights = { a: 50, b: 40, c: 60 };
  const { byId, total } = stackSlots(
    [toast('a'), toast('b'), toast('c')],
    heights,
  );
  assert.deepEqual(byId.c, { index: 2, y: 50 + GAP + 40 + GAP });
  assert.equal(total, 50 + 40 + 60 + 2 * GAP);

  const leaving = stackSlots(
    [toast('a', true), toast('b'), toast('c')],
    heights,
  ).byId;
  assert.deepEqual(
    leaving.a,
    { index: 0, y: 0 },
    'the leaving toast holds its spot',
  );
  assert.deepEqual(
    leaving.b,
    { index: 1, y: 0 },
    'a folded stack waits for it to unmount; a fanned-out one closes up at once',
  );

  const arriving = stackSlots(
    [toast('new'), toast('a'), toast('b')],
    heights,
  ).byId;
  assert.deepEqual(
    arriving.a,
    { index: 1, y: 0 },
    'a toast that has not registered its height takes no room yet',
  );
});

test('each slot enters and leaves the way Sonner does', () => {
  const front = { index: 0, y: 0 };
  const second = { index: 1, y: 64 };
  const state = { isExpanded: false, isMounted: true, isLeaving: false };
  assert.equal(
    itemTransform({ ...state, slot: front, isMounted: false }),
    'translateY(-100%)',
  );
  assert.equal(
    itemTransform({ ...state, slot: second }),
    `translateY(${GAP}px) scale(0.95)`,
  );
  assert.equal(
    itemTransform({ ...state, slot: second, isExpanded: true }),
    'translateY(64px)',
  );
  assert.equal(
    itemTransform({ ...state, slot: front, isLeaving: true }),
    'translateY(-100%)',
  );
  assert.equal(
    itemTransform({
      ...state,
      slot: second,
      isLeaving: true,
      isExpanded: true,
    }),
    'translateY(64px) translateY(-100%)',
  );
  assert.equal(
    itemTransform({ ...state, slot: second, isLeaving: true }),
    'translateY(40%)',
  );
});

test('size follows the stack except while the card morphs, so a collapse never switches curves', () => {
  const still = motionTiming({
    isLeaving: false,
    isFront: true,
    isExpanded: false,
    isMorphing: false,
  });
  assert.match(still.transitionTimingFunction, /^(ease, ){6}ease$/);
  const morphing = motionTiming({
    isLeaving: false,
    isFront: true,
    isExpanded: false,
    isMorphing: true,
  });
  assert.equal(
    morphing.transitionTimingFunction
      .split(', ')
      .slice(3)
      .every((e) => e === 'var(--ease-drawer)'),
    true,
  );
  assert.deepEqual(
    durations(morphing),
    [400, 400, 400, 400, 400, 400, 400],
    'the morph runs as long as the stack',
  );
  const dropping = motionTiming({
    isLeaving: true,
    isFront: false,
    isExpanded: false,
    isMorphing: false,
  });
  assert.deepEqual(
    durations(dropping),
    [500, 200, 200, 400, 400, 400, 400],
    'the blur leaves with the fade',
  );
});

test('heights follow Sonner: the front sizes itself, the ones behind take its height, a fanned-out one its own', () => {
  const base = {
    isFront: true,
    isExpanded: false,
    isMounted: true,
    isMorphing: false,
    canOpen: false,
    height: 64,
    frontHeight: 44,
  };
  assert.equal(itemHeight(base), undefined, 'auto');
  assert.equal(itemHeight({ ...base, isFront: false }), 44);
  assert.equal(itemHeight({ ...base, isFront: false, isExpanded: true }), 64);
  assert.equal(
    itemHeight({ ...base, isExpanded: true, isMounted: false }),
    undefined,
    'not mounted yet: auto',
  );
  assert.equal(
    itemHeight({ ...base, isMorphing: true }),
    64,
    'the morph always sizes itself',
  );
  assert.equal(
    itemHeight({ ...base, canOpen: true }),
    64,
    'a toast that can open never starts its morph from auto',
  );
});
