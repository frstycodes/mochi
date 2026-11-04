import { describe, expect, it } from 'vite-plus/test';
import type { ActivityEntry } from '../model.ts';
import {
  claimSend,
  finishSend,
  handOnSend,
  newestYoursKey,
  recordSend,
  type SendOrigin,
} from './sendFlight.ts';

const origin = {
  box: { left: 0, top: 500, width: 600, height: 40 } as DOMRect,
  text: { left: 12, top: 510, height: 18 },
  radius: 16,
  opacity: 0,
} satisfies SendOrigin;

describe('claimSend', () => {
  it('gives the flight to the first bubble only, again on its remount', () => {
    recordSend('t1', origin, 0);
    expect(claimSend('t1', 'new', 10)).toBe(origin);
    expect(claimSend('t1', 'old', 20)).toBeUndefined();
    expect(claimSend('t1', 'new', 30)).toBe(origin);
  });

  it('flies only in the thread it was sent in, and only right after', () => {
    recordSend('t1', origin, 0);
    expect(claimSend('t2', 'new', 10)).toBeUndefined();
    expect(claimSend('t1', 'new', 5000)).toBeUndefined();
  });

  it('hands a flight left mid-way to the next bubble, from where it was', () => {
    recordSend('t1', origin, 0);
    claimSend('t1', 'steer', 10);
    const midway = { ...origin, opacity: 0.5 };
    handOnSend('steer', midway);
    expect(claimSend('t1', 'row', 20)).toBe(midway);
  });

  it('never flies again once landed', () => {
    recordSend('t1', origin, 0);
    claimSend('t1', 'new', 10);
    finishSend('new');
    expect(claimSend('t1', 'new', 20)).toBeUndefined();
  });
});

describe('newestYoursKey', () => {
  const entry = (who: ActivityEntry['who'], kind: ActivityEntry['kind']) =>
    ({ who, kind, at: 0, text: '' }) satisfies ActivityEntry;
  const activity = [
    entry('you', 'message'),
    entry('claude', 'message'),
    entry('you', 'message'),
    entry('claude', 'tool'),
  ];
  const row = (index: number) => ({
    kind: 'message' as const,
    key: `m${index}`,
    entry: activity[index],
    index,
    showAuthor: false,
  });

  it('keys only the last message you sent, past later agent rows', () => {
    expect(newestYoursKey(activity, row(2))).toBe('m2');
    expect(newestYoursKey(activity, row(0))).toBeUndefined();
    expect(newestYoursKey(activity, row(1))).toBeUndefined();
  });
});
