import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import {
  settleNavigation,
  startNavigation,
  type NavigationState,
  type PendingNavigation,
} from './pending.ts';

const GOOGLE = 'https://google.com/';

function run(states: NavigationState[]) {
  let pending: PendingNavigation | null = startNavigation(GOOGLE, {
    url: 'about:blank',
    pending: null,
  });
  return states.map((state) => {
    const settled = settleNavigation(pending, state);
    pending = settled.pending;
    return settled.url;
  });
}

const blank = (isLoading: boolean, error: string | null = null) => ({
  url: 'about:blank',
  isLoading,
  error,
});

test('shows the typed URL until a state for it arrives', () => {
  assert.deepEqual(
    run([
      blank(false),
      blank(true),
      { url: 'https://www.google.com/', isLoading: true, error: null },
      { url: 'https://www.google.com/', isLoading: false, error: null },
    ]),
    [GOOGLE, GOOGLE, 'https://www.google.com/', 'https://www.google.com/'],
  );
});

test('reverts when the load fails or stops on the old page', () => {
  assert.deepEqual(run([blank(true), blank(true, 'ERR_NAME_NOT_RESOLVED')]), [
    GOOGLE,
    'about:blank',
  ]);
  assert.deepEqual(run([blank(true), blank(false)]), [GOOGLE, 'about:blank']);
});

test("ignores the old page's stale error before the load starts", () => {
  assert.deepEqual(run([blank(false, 'old'), blank(true)]), [GOOGLE, GOOGLE]);
});
