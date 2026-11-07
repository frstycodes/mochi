import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import { ITEMS } from '../../profileLibraryFixtures';
import { SEEDED, stateIn, withItems } from './model';

const item = (id: string) => ITEMS.find((i) => i.id === id)!;

test('reads each kind of state', () => {
  assert.equal(stateIn(SEEDED, item('m-docx'), 'personal'), 'added');
  assert.equal(stateIn(SEEDED, item('m-docx'), 'work'), 'not-added');
  assert.equal(stateIn(SEEDED, item('cx-writing'), 'personal'), 'off');
  assert.equal(stateIn(SEEDED, item('cx-writing'), 'work'), 'on');
  assert.equal(stateIn(SEEDED, item('cd-hook'), 'personal'), 'locked');
  assert.equal(stateIn(SEEDED, item('cd-ui'), 'work'), 'other-account');
});

test('adds Mochi items and turns native ones back on, then reverses it', () => {
  const targets = [item('m-docx'), item('cx-writing')];
  const on = withItems(SEEDED, 'work', [item('m-docx')], true);
  assert.equal(stateIn(on, item('m-docx'), 'work'), 'added');
  const back = withItems(SEEDED, 'personal', targets, true);
  assert.equal(stateIn(back, item('cx-writing'), 'personal'), 'on');
  const off = withItems(back, 'personal', targets, false);
  assert.equal(stateIn(off, item('m-docx'), 'personal'), 'not-added');
  assert.equal(stateIn(off, item('cx-writing'), 'personal'), 'off');
  assert.deepEqual(off.added.work, SEEDED.added.work);
});
