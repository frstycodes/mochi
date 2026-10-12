import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_FORM, fromWhen, toWhen } from './form.ts';

test('presets round-trip through cron', () => {
  assert.deepEqual(toWhen({ ...DEFAULT_FORM, preset: 'weekdays', time: '09:30' }), { when: { kind: 'cron', cron: '30 9 * * 1-5' } });
  assert.deepEqual(fromWhen({ kind: 'cron', cron: '30 9 * * 1-5' }, 'skip'), { ...DEFAULT_FORM, preset: 'weekdays', time: '09:30', cron: '30 9 * * 1-5', missed: 'skip' });
  assert.equal(fromWhen({ kind: 'cron', cron: '0 2 * * *' }, 'run-once').preset, 'nightly');
  assert.equal(fromWhen({ kind: 'cron', cron: '0 * * * *' }, 'run-once').preset, 'hourly');
  assert.equal(fromWhen({ kind: 'cron', cron: '*/5 * * * *' }, 'run-once').preset, 'custom');
});

test('a bad cron says why; PR filters drop when empty', () => {
  assert.match((toWhen({ ...DEFAULT_FORM, preset: 'custom', cron: '61 * * * *' }) as { error: string }).error, /minute/);
  assert.deepEqual(toWhen({ ...DEFAULT_FORM, kind: 'pr', event: 'ci-failed', branch: ' ', label: 'deps' }), { when: { kind: 'pr', event: 'ci-failed', label: 'deps' } });
});
