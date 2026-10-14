import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getPrefs, setPrefs } from '../settings/prefs.ts';
import { PINNABLE_KINDS, setPinned } from './headerPins.ts';

test('pins append in order, re-pinning moves to the end, unpinning removes, a visual never pins', () => {
  setPrefs({ headerPins: ['browser'] });
  setPinned('terminal', true);
  setPinned('browser', true);
  assert.deepEqual(getPrefs().headerPins, ['terminal', 'browser']);
  setPinned('terminal', false);
  assert.deepEqual(getPrefs().headerPins, ['browser']);
  setPinned('visual', true);
  assert.deepEqual(getPrefs().headerPins, ['browser']);
  assert.ok(!(PINNABLE_KINDS as readonly string[]).includes('visual'));
});
