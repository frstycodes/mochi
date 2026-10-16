import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bindingOf, checkBinding, chordOf, chordText, COMMAND_IDS, COMMANDS, conflictOf, defaultKeys, filterCommands, isCommand, parseChord, rebind, reservedReason, resetBinding } from './keymap.ts';

const key = (code: string, mods: Partial<{ metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }> = {}) => ({ code, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...mods });

for (const isMac of [true, false])
  test(`defaults on ${isMac ? 'macOS' : 'Windows and Linux'} are unique where they listen and never reserved`, () => {
    for (const id of COMMAND_IDS) {
      const keys = defaultKeys(id, isMac);
      assert.equal(reservedReason(keys, isMac), undefined, `${id}: ${chordText(keys)}`);
      assert.equal(conflictOf(id, keys, {}, isMac), undefined, `${id}: ${chordText(keys)}`);
    }
  });

test('chords read and write as text, modifiers in a fixed order, letters in any case', () => {
  assert.deepEqual(parseChord('shift+MOD+k'), ['mod', 'shift', 'K']);
  assert.deepEqual(parseChord('nav+left'), ['nav', 'left']);
  assert.equal(chordText(['shift', 'mod', '[']), 'mod+shift+[');
  for (const bad of ['cmd+K', 'mod+mod+K', 'mod+', 'mod+K+J', 'mod+Escape', '']) assert.equal(parseChord(bad), null, bad);
});

test('an override wins, an empty one clears, an unreadable one falls back to the default', () => {
  assert.deepEqual(bindingOf('palette', {}, true), ['mod', 'K']);
  assert.deepEqual(bindingOf('palette', { palette: 'mod+shift+K' }, true), ['mod', 'shift', 'K']);
  assert.equal(bindingOf('palette', { palette: '' }, true), null);
  assert.deepEqual(bindingOf('palette', { palette: 'nonsense' }, true), ['mod', 'K']);
});

test('a key press matches its command by physical key, with exactly its modifiers', () => {
  assert.equal(isCommand(key('BracketRight', { metaKey: true, shiftKey: true }), 'pinned-next', {}, true), true);
  assert.equal(isCommand(key('BracketRight', { ctrlKey: true, shiftKey: true }), 'pinned-next', {}, false), true);
  assert.equal(isCommand(key('BracketRight', { metaKey: true }), 'pinned-next', {}, true), false, 'Shift missing');
  assert.equal(isCommand(key('BracketRight', { metaKey: true, shiftKey: true, altKey: true }), 'pinned-next', {}, true), false, 'an extra modifier');
  assert.equal(isCommand(key('KeyK', { metaKey: true }), 'palette', { palette: 'mod+shift+K' }, true), false, 'the old chord stops');
  assert.equal(isCommand(key('KeyK', { metaKey: true, shiftKey: true }), 'palette', { palette: 'mod+shift+K' }, true), true, 'the new one works');
  assert.equal(isCommand(key('KeyK', { metaKey: true }), 'palette', { palette: '' }, true), false, 'a cleared command never fires');
});

test('recording turns a press into the chord the defaults are written in', () => {
  assert.deepEqual(chordOf(key('KeyP', { metaKey: true, altKey: true }), true), ['mod', 'alt', 'P']);
  assert.deepEqual(chordOf(key('KeyP', { ctrlKey: true, altKey: true }), false), ['mod', 'alt', 'P'], 'Ctrl Alt is mod alt on PC');
  assert.deepEqual(chordOf(key('Digit2', { altKey: true }), false), ['nav', '2'], 'Alt alone is nav on PC');
  assert.deepEqual(chordOf(key('Digit2', { ctrlKey: true }), true), ['nav', '2'], 'Control is nav on macOS');
  assert.equal(chordOf(key('ShiftLeft', { shiftKey: true }), true), null, 'only a modifier so far');
  assert.equal(chordOf(key('KeyE', { metaKey: true }), false), null, 'the Windows key never binds');
});

test('reserved chords are refused with the reason', () => {
  assert.match(reservedReason(['mod', 'Q'], true)!, /quits Mochi/);
  assert.match(reservedReason(['nav', 'left'], true)!, /Mission Control/);
  assert.match(reservedReason(['mod', 'Tab'], true)!, /switches apps/);
  assert.match(reservedReason(['nav', 'Tab'], false)!, /switches windows/);
  assert.match(reservedReason(['mod', 'C'], true)!, /Copy/);
  assert.match(reservedReason(['Tab'], true)!, /needs/, 'a plain Tab would break focus');
  assert.equal(reservedReason(['shift', 'J'], true), undefined);
  assert.equal(reservedReason(['nav', 'left'], false), undefined, 'Alt ← is free on PC');
});

test('a clash is caught where both listen, and settled by swap or replace', () => {
  assert.deepEqual(checkBinding('palette', ['mod', 'P'], {}, true), { ok: false, conflict: 'files-go-to' }, 'a global chord clashes with a pane one');
  assert.deepEqual(checkBinding('files-go-to', ['J'], {}, true), { ok: true }, "a pane and Queue's list never listen together");
  assert.throws(() => rebind({}, 'palette', ['mod', 'P'], undefined, true), /already used by Go to file/);
  assert.throws(() => rebind({}, 'palette', ['mod', 'Q'], 'replace', true), /quits Mochi/, 'settling a clash never unlocks a reserved chord');

  const replaced = rebind({}, 'palette', ['mod', 'P'], 'replace', true);
  assert.deepEqual(replaced, { palette: 'mod+P', 'files-go-to': '' });
  assert.equal(bindingOf('files-go-to', replaced, true), null);

  const swapped = rebind({}, 'palette', ['mod', 'P'], 'swap', true);
  assert.deepEqual(swapped, { palette: 'mod+P', 'files-go-to': 'mod+K' });
});

test('reset puts one command back, stores nothing for a default, and asks again when its default was taken', () => {
  assert.deepEqual(rebind({}, 'palette', ['mod', 'K'], undefined, true), {}, 'binding the default stores nothing');
  assert.deepEqual(rebind({ palette: 'mod+shift+K' }, 'palette', null, undefined, true), { palette: '' });
  assert.deepEqual(resetBinding({ palette: 'mod+shift+K', 'go-new': 'shift+N' }, 'palette', undefined, true), { 'go-new': 'shift+N' });
  const taken = { palette: 'mod+shift+K', 'go-settings': 'mod+K' };
  assert.throws(() => resetBinding(taken, 'palette', undefined, true), /already used by Settings/);
  assert.deepEqual(resetBinding(taken, 'palette', 'swap', true), { 'go-settings': 'mod+shift+K' });
});

test('the shortcut filter matches words in the title or group, the chord a command has now, and your rebinds', () => {
  const none = { query: '', chord: null, isChangedOnly: false };
  assert.deepEqual(filterCommands(COMMAND_IDS, none, {}, true), COMMAND_IDS, 'no filter shows everything');
  const palette = filterCommands(COMMAND_IDS, { ...none, query: COMMANDS.palette.title.toUpperCase() }, {}, true);
  assert.ok(palette.includes('palette'), 'words, any case');
  assert.deepEqual(filterCommands(COMMAND_IDS, { ...none, chord: defaultKeys('palette', true) }, {}, true), ['palette'], 'the pressed chord finds who holds it');
  const moved = { palette: 'mod+P', 'files-go-to': '' };
  assert.deepEqual(filterCommands(COMMAND_IDS, { ...none, chord: ['mod', 'P'] }, moved, true), ['palette'], 'a rebind moves the match');
  assert.deepEqual(filterCommands(COMMAND_IDS, { ...none, isChangedOnly: true }, moved, true), ['palette', 'files-go-to'].filter((id) => COMMAND_IDS.includes(id as never)), 'changed keeps rebinds only');
  assert.deepEqual(filterCommands(COMMAND_IDS, { ...none, isChangedOnly: true }, {}, true), []);
});
