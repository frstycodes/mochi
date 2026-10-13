import assert from 'node:assert/strict';
import { test } from 'node:test';
import { claudeEventWindow, claudeUsageWindows, codexWindows, durationLabel, mergeWindows, toneFor, untilLabel } from './limits.ts';

test('a Claude rate_limit_event becomes one window, utilization 0–1 read as a percentage', () => {
  assert.deepEqual(claudeEventWindow({ status: 'allowed', rateLimitType: 'five_hour', utilization: 0.42, resetsAt: 1_760_000_000 }), {
    id: 'five_hour',
    label: '5-hour',
    usedPct: 42,
    resetsAt: '2025-10-09T08:53:20.000Z',
  });
  assert.equal(claudeEventWindow({ status: 'allowed', rateLimitType: 'seven_day_opus', utilization: 0.1 })?.label, 'Weekly · Opus');
  assert.equal(claudeEventWindow({ status: 'rejected', rateLimitType: 'seven_day' })?.usedPct, 100);
  assert.equal(claudeEventWindow({ status: 'allowed', rateLimitType: 'overage', utilization: 0.5 }), null);
  assert.equal(claudeEventWindow({ status: 'allowed' }), null);
});

test("Claude's get_usage read maps every window it reports, 0–100 as is", () => {
  const windows = claudeUsageWindows({
    five_hour: { utilization: 12, resets_at: '2026-10-13T18:00:00Z' },
    seven_day: { utilization: 63.5, resets_at: '2026-10-17T09:00:00Z' },
    seven_day_opus: { utilization: null, resets_at: null },
    seven_day_sonnet: null,
  });
  assert.deepEqual(
    windows.map((w) => [w.label, w.usedPct, w.resetsAt]),
    [
      ['5-hour', 12, '2026-10-13T18:00:00Z'],
      ['Weekly', 63.5, '2026-10-17T09:00:00Z'],
    ],
  );
  assert.deepEqual(claudeUsageWindows(null), []);
});

test("Claude's model-specific weekly windows come from model_scoped, without repeating a named one", () => {
  const windows = claudeUsageWindows({
    seven_day: { utilization: 84, resets_at: '2026-10-17T16:00:00Z' },
    seven_day_opus: { utilization: 10, resets_at: '2026-10-17T16:00:00Z' },
    model_scoped: [
      { display_name: 'Fable', utilization: 0, resets_at: '2026-10-17T16:00:00Z' },
      { display_name: 'Opus', utilization: 10, resets_at: '2026-10-17T16:00:00Z' },
    ],
  });
  assert.deepEqual(
    mergeWindows([], windows).map((w) => [w.id, w.label, w.usedPct]),
    [
      ['seven_day', 'Weekly', 84],
      ['seven_day_opus', 'Weekly · Opus', 10],
      ['model:Fable', 'Weekly · Fable', 0],
    ],
  );
});

test('Codex windows are labelled by their real duration', () => {
  const windows = codexWindows({ primary: { usedPercent: 30, windowDurationMins: 300, resetsAt: 1_760_000_000 }, secondary: { usedPercent: 71, windowDurationMins: 10_080, resetsAt: null } });
  assert.deepEqual(
    windows.map((w) => [w.id, w.label, w.usedPct, !!w.resetsAt]),
    [
      ['primary', '5-hour', 30, true],
      ['secondary', 'Weekly', 71, false],
    ],
  );
});

test('a Codex plan with only a weekly window shows only that, never an empty 5-hour bar', () => {
  const windows = codexWindows({ primary: { usedPercent: 8, windowDurationMins: 10_080, resetsAt: 1_760_000_000 }, secondary: null });
  assert.deepEqual(
    windows.map((w) => w.label),
    ['Weekly'],
  );
});

test('durations name themselves', () => {
  assert.deepEqual([durationLabel(300), durationLabel(10_080), durationLabel(1440 * 30), durationLabel(90), durationLabel(null)], ['5-hour', 'Weekly', '30-day', '90-minute', 'Usage']);
});

test('sparse updates replace by id and keep the rest, shortest window first', () => {
  const known = codexWindows({ primary: { usedPercent: 10, windowDurationMins: 300, resetsAt: null }, secondary: { usedPercent: 20, windowDurationMins: 10_080, resetsAt: null } });
  const merged = mergeWindows(known, codexWindows({ secondary: { usedPercent: 25, windowDurationMins: 10_080, resetsAt: null } }));
  assert.deepEqual(
    merged.map((w) => [w.id, w.usedPct]),
    [
      ['primary', 10],
      ['secondary', 25],
    ],
  );
  const claude = mergeWindows([claudeEventWindow({ status: 'allowed', rateLimitType: 'seven_day', utilization: 0.5 })!], [claudeEventWindow({ status: 'allowed', rateLimitType: 'five_hour', utilization: 0.1 })!]);
  assert.deepEqual(
    claude.map((w) => w.id),
    ['five_hour', 'seven_day'],
  );
});

test('colour thresholds: normal under 70%, warning 70–90%, destructive above 90%', () => {
  assert.deepEqual([0, 0.69, 0.7, 0.9, 0.91, 1].map(toneFor), ['normal', 'normal', 'warning', 'warning', 'destructive', 'destructive']);
});

test('time until a reset reads as the two largest units', () => {
  assert.deepEqual([untilLabel(-1), untilLabel(45 * 60_000), untilLabel(134 * 60_000), untilLabel(120 * 60_000), untilLabel((3 * 1440 + 4 * 60) * 60_000)], ['now', '45m', '2h 14m', '2h', '3d 4h']);
});
