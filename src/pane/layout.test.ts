import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import {
  CHAT_MIN_W,
  closeKind,
  dropTarget,
  EMPTY_LAYOUT,
  GAP,
  moveKind,
  openKind,
  PANE_HEADER_H,
  PANE_MIN_H,
  resizeRows,
  resolveLayout,
  type PaneLayout,
} from './layout.ts';

const open = (...kinds: Parameters<typeof openKind>[1][]) =>
  kinds.reduce(openKind, EMPTY_LAYOUT);

test('opening splits the focused pane’s column and puts the new pane below it, focused', () => {
  const l = open('browser', 'terminal');
  assert.deepEqual(l.columns, [['browser', 'terminal']]);
  assert.equal(l.focused, 'terminal');
  const below = openKind({ ...l, focused: 'browser' }, 'files');
  assert.deepEqual(below.columns, [['browser', 'files', 'terminal']]);
});

test('opening an open kind focuses it instead of adding it twice, and leaves another pane’s expand', () => {
  const l = openKind(
    { ...open('browser', 'terminal'), expanded: 'terminal' },
    'browser',
  );
  assert.deepEqual(
    [l.columns, l.focused, l.expanded],
    [[['browser', 'terminal']], 'browser', undefined],
  );
});

test('a full-height pane gets a column of its own, and the next pane goes beside it, not under it', () => {
  const l = open('browser', 'simulator');
  assert.deepEqual(l.columns, [['browser'], ['simulator']]);
  assert.deepEqual(openKind(l, 'terminal').columns, [
    ['browser', 'terminal'],
    ['simulator'],
  ]);
  assert.deepEqual(open('simulator', 'files').columns, [
    ['files'],
    ['simulator'],
  ]);
});

test('closing drops empty columns and hands focus to the pane above, else below', () => {
  const l = open('browser', 'files', 'terminal');
  assert.equal(closeKind(l, 'terminal').focused, 'files');
  assert.equal(
    closeKind({ ...l, focused: 'browser' }, 'browser').focused,
    'files',
  );
  const sim = closeKind(open('browser', 'simulator'), 'simulator');
  assert.deepEqual([sim.columns, sim.focused], [[['browser']], 'browser']);
  assert.equal(
    closeKind({ ...l, expanded: 'files' }, 'files').expanded,
    undefined,
  );
  assert.deepEqual(closeKind(open('browser'), 'browser').columns, []);
});

test('moving reorders within a column, moves between columns and makes new ones', () => {
  const l = open('browser', 'files', 'terminal');
  assert.deepEqual(moveKind(l, 'terminal', 0, 0).columns, [
    ['terminal', 'browser', 'files'],
  ]);
  assert.deepEqual(moveKind(l, 'browser', 0, 3).columns, [
    ['files', 'terminal', 'browser'],
  ]);
  assert.deepEqual(moveKind(l, 'files', 1, 0).columns, [
    ['browser', 'terminal'],
    ['files'],
  ]);
  assert.deepEqual(moveKind(l, 'files', -1, 0).columns, [
    ['files'],
    ['browser', 'terminal'],
  ]);
  const two = moveKind(l, 'files', 1, 0);
  assert.deepEqual(moveKind(two, 'files', 0, 1).columns, [
    ['browser', 'files', 'terminal'],
  ]);
});

test('one pane fills the column beside the chat, which keeps its minimum width', () => {
  const r = resolveLayout(open('browser'), 1400, 900);
  const rect = r.rects.browser!;
  assert.equal(rect.h, 900 - GAP);
  assert.equal(rect.x + rect.w, 1400 - GAP);
  assert.ok(r.chatWidth >= CHAT_MIN_W);
  assert.equal(rect.x, r.chatWidth);
});

test('two and three panes share the column height evenly, gaps included', () => {
  const two = resolveLayout(open('browser', 'files'), 1400, 900);
  assert.equal(two.rects.browser!.h + two.rects.files!.h + GAP, 900 - GAP);
  assert.equal(two.rects.files!.y, two.rects.browser!.h + GAP);
  const three = resolveLayout(open('browser', 'files', 'terminal'), 1400, 900);
  assert.ok(
    Object.values(three.rects).every(
      (r) => !r.isCollapsed && r.h >= PANE_MIN_H,
    ),
  );
});

test('a column too short for its panes splits into a second column when one fits beside the chat', () => {
  const r = resolveLayout(open('browser', 'files', 'terminal'), 1600, 600);
  assert.equal(r.columns.length, 2);
  assert.deepEqual(
    r.columns.map((c) => c.kinds),
    [['browser', 'files'], ['terminal']],
  );
  assert.ok(Object.values(r.rects).every((rect) => !rect.isCollapsed));
});

test('with no room for another column, panes fold to their header, never the focused one and never below the minimum', () => {
  const l = {
    ...open('browser', 'files', 'terminal'),
    focused: 'files' as const,
  };
  const r = resolveLayout(l, 1000, 600);
  assert.equal(r.columns.length, 1);
  assert.equal(r.rects.files!.isCollapsed, false);
  assert.ok(r.rects.files!.h >= PANE_MIN_H);
  const folded = Object.values(r.rects).filter((rect) => rect.isCollapsed);
  assert.ok(
    folded.length >= 1 && folded.every((rect) => rect.h === PANE_HEADER_H),
  );
  assert.ok(
    Object.values(r.rects).every(
      (rect) => rect.isCollapsed || rect.h >= PANE_MIN_H,
    ),
  );
  const total =
    Object.values(r.rects).reduce((a, rect) => a + rect.h, 0) + 2 * GAP;
  assert.equal(total, 600 - GAP);
});

test('a full-height pane folds into the other column’s pane headers when the two don’t fit side by side', () => {
  const l = open('browser', 'simulator');
  const wide = resolveLayout(l, 1600, 900);
  assert.equal(wide.columns.length, 2);
  assert.equal(wide.rects.simulator!.h, 900 - GAP);
  const narrow = resolveLayout(l, 1000, 900);
  assert.equal(narrow.columns.length, 1);
  assert.deepEqual(
    [narrow.rects.browser!.isCollapsed, narrow.rects.simulator!.isCollapsed],
    [true, false],
  );
  assert.equal(narrow.rects.simulator!.h, 900 - GAP - PANE_HEADER_H - GAP);
  const picked = resolveLayout({ ...l, focused: 'browser' }, 1000, 900);
  assert.deepEqual(
    [picked.rects.browser!.isCollapsed, picked.rects.simulator!.isCollapsed],
    [false, true],
  );
});

test('expand fills the whole box over the chat and hides the other panes', () => {
  const r = resolveLayout(
    { ...open('browser', 'terminal'), expanded: 'terminal' },
    1400,
    900,
  );
  assert.deepEqual(r.rects.terminal, {
    x: GAP,
    y: 0,
    w: 1400 - 2 * GAP,
    h: 900 - GAP,
    isCollapsed: false,
    isHidden: false,
  });
  assert.equal(r.rects.browser!.isHidden, true);
});

test('with the chat hidden (narrow split) the column takes the whole width', () => {
  const r = resolveLayout(open('browser'), 500, 800, 0);
  assert.deepEqual(
    [r.rects.browser!.x, r.rects.browser!.w, r.chatWidth],
    [GAP, 500 - 2 * GAP, GAP],
  );
});

test('dragging a divider moves height between the two neighbours and stops at the minimum', () => {
  const l = open('browser', 'files');
  const r = resolveLayout(l, 1400, 900);
  const upper = { kind: 'browser' as const, h: r.rects.browser!.h };
  const lower = { kind: 'files' as const, h: r.rects.files!.h };
  const taller = resolveLayout(resizeRows(l, upper, lower, 600), 1400, 900);
  assert.ok(Math.abs(taller.rects.browser!.h - 600) <= 1);
  const tooFar = resolveLayout(resizeRows(l, upper, lower, 800), 1400, 900);
  assert.ok(Math.abs(tooFar.rects.files!.h - PANE_MIN_H) <= 1);
});

test('an empty layout leaves the whole width to the chat', () => {
  const empty: PaneLayout = { columns: [] };
  assert.deepEqual(resolveLayout(empty, 1200, 800), {
    chatWidth: 1200,
    columns: [],
    rects: {},
  });
});

test('a pane dropped near a column’s outer edge makes a new column, elsewhere it lands between the panes it’s over', () => {
  const r = resolveLayout(open('browser', 'files'), 1400, 900);
  const [c] = r.columns;
  const files = r.rects.files!;
  assert.deepEqual(
    [dropTarget(r, c.x + 4, 100)?.col, dropTarget(r, c.x + c.w - 4, 100)?.col],
    [-1, 1],
  );
  assert.deepEqual(
    [
      dropTarget(r, c.x + 100, 10)?.row,
      dropTarget(r, c.x + 100, files.y + files.h - 10)?.row,
    ],
    [0, 2],
  );
  assert.equal(
    dropTarget(r, c.x - 100, 100),
    undefined,
    'over the chat it is a split drop, not a move',
  );
});
