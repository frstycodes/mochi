import type { PaneTabKind } from '../model.ts';

/**
 * Where a thread's panes sit: columns of pane kinds to the right of the chat, top to bottom. Persisted per thread;
 * `resolveLayout` turns it into rects for the space actually on screen, so a window too small for the stored shape folds
 * columns together or collapses panes to their header instead of squeezing them.
 */
export interface PaneLayout {
  columns: PaneTabKind[][];
  focused?: PaneTabKind;
  expanded?: PaneTabKind;
  /** Relative height of each pane against the others in its column. */
  weights?: Partial<Record<PaneTabKind, number>>;
  /** Fraction of the thread's width the pane columns take. */
  share?: number;
  /** Relative width of each column, by index. */
  columnWeights?: number[];
}

export const PANE_HEADER_H = 40;
export const PANE_MIN_H = 240;
export const COLUMN_MIN_W = 340;
export const CHAT_MIN_W = 420;
export const GAP = 8;
export const DEFAULT_SHARE = 0.42;

/** Panes that need the whole column (a phone screen is tall); the others move to a column beside it or fold to their header. */
const FULL_HEIGHT = new Set<PaneTabKind>(['simulator']);

export const wantsFullHeight = (kind: PaneTabKind) => FULL_HEIGHT.has(kind);

export const EMPTY_LAYOUT: PaneLayout = { columns: [] };

export function openKinds(layout: PaneLayout) {
  return layout.columns.flat();
}

/** Opens `kind` below the focused pane (a full-height one in a column of its own), or focuses it if it's already open. */
export function openKind(layout: PaneLayout, kind: PaneTabKind): PaneLayout {
  const expanded = layout.expanded === kind ? kind : undefined;
  if (openKinds(layout).includes(kind))
    return { ...layout, focused: kind, expanded };
  if (wantsFullHeight(kind))
    return {
      ...layout,
      columns: [...layout.columns, [kind]],
      focused: kind,
      expanded,
    };
  const at =
    layout.focused && !wantsFullHeight(layout.focused)
      ? locate(layout, layout.focused)
      : undefined;
  const col =
    at?.col ?? layout.columns.findIndex((c) => !c.some(wantsFullHeight));
  if (col < 0)
    return {
      ...layout,
      columns: [[kind], ...layout.columns],
      columnWeights: layout.columnWeights && [1, ...layout.columnWeights],
      focused: kind,
      expanded,
    };
  const row = at ? at.row + 1 : layout.columns[col].length;
  return {
    ...layout,
    columns: layout.columns.map((c, i) =>
      i === col ? [...c.slice(0, row), kind, ...c.slice(row)] : c,
    ),
    focused: kind,
    expanded,
  };
}

/** Focus passes to the pane above it, else below, else the first one left open. */
export function closeKind(layout: PaneLayout, kind: PaneTabKind): PaneLayout {
  const at = locate(layout, kind);
  if (!at) return layout;
  const column = layout.columns[at.col].filter((k) => k !== kind);
  const columns = layout.columns.map((c, i) => (i === at.col ? column : c));
  const kept = columns.map((c, i) => (c.length ? i : -1)).filter((i) => i >= 0);
  const next =
    layout.focused === kind
      ? (column[at.row - 1] ?? column[at.row] ?? columns.flat()[0])
      : layout.focused;
  return {
    ...layout,
    columns: kept.map((i) => columns[i]),
    columnWeights:
      layout.columnWeights && kept.map((i) => layout.columnWeights![i] ?? 1),
    focused: next,
    expanded: layout.expanded === kind ? undefined : layout.expanded,
  };
}

/** Moves `kind` into column `col` at `row`; `col` -1 makes a new first column, `columns.length` a new last one. */
export function moveKind(
  layout: PaneLayout,
  kind: PaneTabKind,
  col: number,
  row: number,
): PaneLayout {
  const from = locate(layout, kind);
  if (!from) return layout;
  const isNewColumn = col < 0 || col >= layout.columns.length;
  const isOnlyPane = layout.columns[from.col].length === 1;
  if (
    !isNewColumn &&
    col === from.col &&
    (row === from.row || row === from.row + 1)
  )
    return layout;
  if (
    isNewColumn &&
    isOnlyPane &&
    (col < 0 ? from.col === 0 : from.col === layout.columns.length - 1)
  )
    return layout;
  const columns = layout.columns.map((c, i) => {
    if (i !== col) return c.filter((k) => k !== kind);
    const target = i === from.col && from.row < row ? row - 1 : row;
    const rest = c.filter((k) => k !== kind);
    return [...rest.slice(0, target), kind, ...rest.slice(target)];
  });
  const weights = layout.columnWeights ?? layout.columns.map(() => 1);
  const placed =
    col < 0
      ? [[kind], ...columns]
      : col >= columns.length
        ? [...columns, [kind]]
        : columns;
  const placedWeights =
    col < 0
      ? [1, ...weights]
      : col >= columns.length
        ? [...weights, 1]
        : weights;
  const kept = placed.map((c, i) => (c.length ? i : -1)).filter((i) => i >= 0);
  return {
    ...layout,
    columns: kept.map((i) => placed[i]),
    columnWeights: kept.map((i) => placedWeights[i] ?? 1),
    focused: kind,
  };
}

export interface PaneRect {
  x: number;
  y: number;
  w: number;
  h: number;
  isCollapsed: boolean;
  isHidden: boolean;
}

export interface ResolvedColumn {
  x: number;
  w: number;
  kinds: PaneTabKind[];
}

export interface ResolvedLayout {
  /** Width left for the chat on the left; the panes start where it ends. */
  chatWidth: number;
  columns: ResolvedColumn[];
  rects: Partial<Record<PaneTabKind, PaneRect>>;
}

/**
 * Lays the panes out in a `width` × `height` box whose left part is the chat (`chatMinWidth` 0 when the panes replace it).
 * Columns that don't fit beside the chat fold into their neighbour; a column too short for its panes splits in two when
 * another column fits, else its panes fold to their header, the focused one last. A full-height pane folds the rest of its
 * column to headers. The expanded pane fills the box and hides the others.
 */
export function resolveLayout(
  layout: PaneLayout,
  width: number,
  height: number,
  chatMinWidth = CHAT_MIN_W,
): ResolvedLayout {
  const room = width - chatMinWidth - GAP;
  const fits = Math.max(1, Math.floor((room + GAP) / (COLUMN_MIN_W + GAP)));
  const columns = fitColumns(layout, fits, height);
  if (!columns.length) return { chatWidth: width, columns: [], rects: {} };

  const minTotal = columns.length * COLUMN_MIN_W + (columns.length - 1) * GAP;
  const maxTotal = Math.max(minTotal, width - chatMinWidth - GAP);
  const total =
    chatMinWidth === 0
      ? width - 2 * GAP
      : clamp((layout.share ?? DEFAULT_SHARE) * width, minTotal, maxTotal);
  const left = width - GAP - total;
  const colWeights = columns.map((c) => c.weight);
  const colWidths = distribute(
    total - (columns.length - 1) * GAP,
    colWeights,
    COLUMN_MIN_W,
  );

  const rects: ResolvedLayout['rects'] = {};
  const resolved: ResolvedColumn[] = [];
  let x = left;
  columns.forEach((c, i) => {
    const w = colWidths[i];
    const heights = columnHeights(c.kinds, layout, height - GAP);
    let y = 0;
    c.kinds.forEach((kind, row) => {
      rects[kind] = {
        x,
        y,
        w,
        h: heights[row].h,
        isCollapsed: heights[row].isCollapsed,
        isHidden: false,
      };
      y += heights[row].h + GAP;
    });
    resolved.push({ x, w, kinds: c.kinds });
    x += w + GAP;
  });

  const expanded =
    layout.expanded && rects[layout.expanded] ? layout.expanded : undefined;
  if (expanded) {
    for (const kind of Object.keys(rects) as PaneTabKind[])
      rects[kind] = { ...rects[kind]!, isHidden: kind !== expanded };
    rects[expanded] = {
      x: GAP,
      y: 0,
      w: width - 2 * GAP,
      h: height - GAP,
      isCollapsed: false,
      isHidden: false,
    };
  }
  return { chatWidth: Math.max(0, left), columns: resolved, rects };
}

/** The stored columns reshaped for `fits` columns: full-height panes split off while there's room, extra columns folded right to left. */
function fitColumns(layout: PaneLayout, fits: number, height: number) {
  let cols = layout.columns
    .filter((c) => c.length)
    .map((kinds, i) => ({ kinds, weight: layout.columnWeights?.[i] ?? 1 }));
  for (let i = 0; i < cols.length && cols.length < fits; i++) {
    const tall = cols[i].kinds.find(wantsFullHeight);
    if (!tall || cols[i].kinds.length === 1) continue;
    cols = [
      ...cols.slice(0, i),
      { ...cols[i], kinds: cols[i].kinds.filter((k) => k !== tall) },
      { kinds: [tall], weight: cols[i].weight },
      ...cols.slice(i + 1),
    ];
  }
  while (cols.length > fits)
    cols = [
      {
        kinds: [...cols[0].kinds, ...cols[1].kinds],
        weight: cols[0].weight + cols[1].weight,
      },
      ...cols.slice(2),
    ];
  for (let i = 0; i < cols.length && cols.length < fits; i++) {
    const { kinds } = cols[i];
    if (
      kinds.some(wantsFullHeight) ||
      kinds.length * PANE_MIN_H + (kinds.length - 1) * GAP <= height - GAP
    )
      continue;
    const half = Math.ceil(kinds.length / 2);
    cols = [
      ...cols.slice(0, i),
      { kinds: kinds.slice(0, half), weight: cols[i].weight },
      { kinds: kinds.slice(half), weight: cols[i].weight },
      ...cols.slice(i + 1),
    ];
  }
  return cols;
}

/**
 * Heights in one column: beside a full-height pane, one pane takes all but the others' headers (the focused one, else the
 * full-height one); otherwise by weight, folding the smallest non-focused pane to its header until the rest reach the minimum.
 */
function columnHeights(
  kinds: PaneTabKind[],
  layout: PaneLayout,
  height: number,
) {
  const tall = kinds.find(wantsFullHeight);
  const owner =
    tall && layout.focused && kinds.includes(layout.focused)
      ? layout.focused
      : tall;
  const collapsed = new Set(owner ? kinds.filter((k) => k !== owner) : []);
  const open = () => kinds.filter((k) => !collapsed.has(k));
  const sizes = () => {
    const free =
      height - collapsed.size * PANE_HEADER_H - (kinds.length - 1) * GAP;
    const ks = open();
    const hs = distribute(
      free,
      ks.map((k) => layout.weights?.[k] ?? 1),
      0,
    );
    return new Map(ks.map((k, i) => [k, hs[i]]));
  };
  for (let s = sizes(); open().length > 1; s = sizes()) {
    const short = open().filter(
      (k) => k !== layout.focused && s.get(k)! < PANE_MIN_H,
    );
    if (!short.length && [...s.values()].every((h) => h >= PANE_MIN_H)) break;
    const victim = (
      short.length ? short : open().filter((k) => k !== layout.focused)
    ).sort(
      (a, b) => s.get(a)! - s.get(b)! || kinds.indexOf(b) - kinds.indexOf(a),
    )[0];
    collapsed.add(victim);
  }
  const s = sizes();
  return kinds.map((k) =>
    collapsed.has(k)
      ? { h: PANE_HEADER_H, isCollapsed: true }
      : { h: s.get(k)!, isCollapsed: false },
  );
}

/** Splits `total` by `weights`, each share at least `min` while the total allows; rounded to whole pixels that still sum to `total`. */
function distribute(total: number, weights: number[], min: number) {
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  const raw = weights.map((w) => (total * w) / sum);
  const floored =
    min * weights.length <= total ? floorAt(raw, min, total) : raw;
  const rounded = floored.map(Math.floor);
  rounded[rounded.length - 1] +=
    Math.round(total) - rounded.reduce((a, b) => a + b, 0);
  return rounded;
}

/** Raises shares under `min` to it, taking the difference from the others in proportion. */
function floorAt(sizes: number[], min: number, total: number) {
  const low = sizes.map((s) => s < min);
  if (!low.some(Boolean)) return sizes;
  const rest = total - low.filter(Boolean).length * min;
  const restSum = sizes.reduce((a, s, i) => (low[i] ? a : a + s), 0) || 1;
  return sizes.map((s, i) => (low[i] ? min : (s * rest) / restSum));
}

/** New weights for two neighbouring panes after dragging the divider between them to make the upper one `upperHeight` tall. */
export function resizeRows(
  layout: PaneLayout,
  upper: { kind: PaneTabKind; h: number },
  lower: { kind: PaneTabKind; h: number },
  upperHeight: number,
): PaneLayout {
  const total = upper.h + lower.h;
  const h = clamp(upperHeight, PANE_MIN_H, total - PANE_MIN_H);
  const sum =
    (layout.weights?.[upper.kind] ?? 1) + (layout.weights?.[lower.kind] ?? 1);
  return {
    ...layout,
    weights: {
      ...layout.weights,
      [upper.kind]: (sum * h) / total,
      [lower.kind]: (sum * (total - h)) / total,
    },
  };
}

/** New column weights after dragging the divider between column `i` and `i + 1` so column `i` is `leftWidth` wide. */
export function resizeColumns(
  layout: PaneLayout,
  columns: ResolvedColumn[],
  i: number,
  leftWidth: number,
): PaneLayout {
  const total = columns[i].w + columns[i + 1].w;
  const w = clamp(leftWidth, COLUMN_MIN_W, total - COLUMN_MIN_W);
  const weights = layout.columns.map((_, j) => layout.columnWeights?.[j] ?? 1);
  if (weights.length !== columns.length) return layout;
  const sum = weights[i] + weights[i + 1];
  weights[i] = (sum * w) / total;
  weights[i + 1] = (sum * (total - w)) / total;
  return { ...layout, columnWeights: weights };
}

/** The share of the width the columns take when the chat/pane divider sits at `x`. */
export function shareAt(width: number, x: number) {
  return clamp((width - GAP - x) / width, 0.2, 0.8);
}

/** How close to the outer edge of the first or last column a released pane makes a new column there. */
const EDGE = 32;

/** Where a pane released at (x, y) lands: a new column past either edge, else between the panes of the column it's over. */
export function dropTarget(
  { columns, rects }: ResolvedLayout,
  x: number,
  y: number,
) {
  const first = columns[0];
  const last = columns.at(-1);
  if (!first || !last || x < first.x - GAP) return undefined;
  const bar = (left: number, top: number, w: number, h: number) => ({
    left,
    top,
    width: w,
    height: h,
  });
  if (x < first.x + EDGE)
    return {
      col: -1,
      row: 0,
      line: bar(first.x - GAP / 2 - 1, 0, 2, rects[first.kinds[0]]!.h),
    };
  if (x > last.x + last.w - EDGE)
    return {
      col: columns.length,
      row: 0,
      line: bar(last.x + last.w + GAP / 2 - 1, 0, 2, rects[last.kinds[0]]!.h),
    };
  const col = Math.max(
    0,
    columns.findLastIndex((c) => x >= c.x - GAP),
  );
  const c = columns[col];
  const row = c.kinds.filter((k) => rects[k]!.y + rects[k]!.h / 2 < y).length;
  const above = c.kinds[row - 1];
  const lineY = above ? rects[above]!.y + rects[above]!.h + GAP / 2 - 1 : -1;
  return { col, row, line: bar(c.x + 16, Math.max(0, lineY), c.w - 32, 2) };
}

export function locate(layout: PaneLayout, kind: PaneTabKind) {
  const col = layout.columns.findIndex((c) => c.includes(kind));
  return col < 0 ? undefined : { col, row: layout.columns[col].indexOf(kind) };
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}
