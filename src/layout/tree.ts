export type View = { kind: 'queue' } | { kind: 'board' } | { kind: 'new' } | { kind: 'thread'; id: string } | { kind: 'tab'; threadId: string; tabId: string };

export type Orientation = 'row' | 'column';
export type Side = 'left' | 'right' | 'top' | 'bottom';
export type Zone = Side | 'center';

export interface Leaf {
  kind: 'leaf';
  id: string;
  view: View;
}

export interface Split {
  kind: 'split';
  id: string;
  dir: Orientation;
  children: LayoutNode[];
  /** Percentages, one per child, summing to 100. */
  sizes: number[];
}

export type LayoutNode = Leaf | Split;

export interface SpaceLayout {
  root: LayoutNode;
  focusId: string;
  zoomId?: string;
  /** The window orientation the tree was built for; while `isAuto`, a window of the other orientation shows it transposed. */
  builtFor: Orientation;
  isAuto: boolean;
}

export const PRESETS = ['2-up', '3-columns', '2x2', 'main-stack', 'stack-3'] as const;
export type Preset = (typeof PRESETS)[number];

export const PRESET_LABELS = { '2-up': '2-up', '3-columns': '3 columns', '2x2': '2 × 2', 'main-stack': 'Main + stack', 'stack-3': 'Stack of 3' } satisfies Record<Preset, string>;

const SNAP_POINTS = [100 / 3, 50, 200 / 3];
const SNAP_DISTANCE = 3;

export function newId() {
  return Math.random().toString(36).slice(2, 10);
}

export function leaf(view: View): Leaf {
  return { kind: 'leaf', id: newId(), view };
}

function split(dir: Orientation, children: LayoutNode[], sizes = equalSizes(children.length)): Split {
  return { kind: 'split', id: newId(), dir, children, sizes };
}

export function equalSizes(n: number) {
  return Array.from({ length: n }, () => 100 / n);
}

export function singleLayout(view: View, builtFor: Orientation = 'row'): SpaceLayout {
  const root = leaf(view);
  return { root, focusId: root.id, builtFor, isAuto: true };
}

export function autoOrientation(width: number, height: number): Orientation {
  return width >= height ? 'row' : 'column';
}

export function leaves(node: LayoutNode): Leaf[] {
  return node.kind === 'leaf' ? [node] : node.children.flatMap(leaves);
}

export function findLeaf(node: LayoutNode, id: string) {
  return leaves(node).find((l) => l.id === id);
}

export function parentOf(node: LayoutNode, id: string): Split | undefined {
  if (node.kind === 'leaf') return undefined;
  if (node.children.some((c) => c.id === id)) return node;
  for (const c of node.children) {
    const p = parentOf(c, id);
    if (p) return p;
  }
  return undefined;
}

function mapNode(node: LayoutNode, id: string, fn: (n: LayoutNode) => LayoutNode): LayoutNode {
  if (node.id === id) return fn(node);
  if (node.kind === 'leaf') return node;
  return { ...node, children: node.children.map((c) => mapNode(c, id, fn)) };
}

export function setLeafView(node: LayoutNode, leafId: string, view: View) {
  return mapNode(node, leafId, (n) => ({ ...n, view }) as Leaf);
}

const SIDE_DIR = { left: 'row', right: 'row', top: 'column', bottom: 'column' } satisfies Record<Side, Orientation>;

/** Opens `view` beside a leaf. Splitting along the parent's own direction adds a sibling that halves the target's share instead of nesting. */
export function splitLeaf(root: LayoutNode, leafId: string, view: View, side: Side): { root: LayoutNode; leafId: string } {
  const added = leaf(view);
  const dir = SIDE_DIR[side];
  const isBefore = side === 'left' || side === 'top';
  const parent = parentOf(root, leafId);
  if (parent && parent.dir === dir) {
    const i = parent.children.findIndex((c) => c.id === leafId);
    const at = isBefore ? i : i + 1;
    const half = parent.sizes[i] / 2;
    const children = [...parent.children.slice(0, at), added, ...parent.children.slice(at)];
    const sizes = parent.sizes.map((s, j) => (j === i ? half : s));
    sizes.splice(at, 0, half);
    return { root: mapNode(root, parent.id, () => ({ ...parent, children, sizes })), leafId: added.id };
  }
  const next = mapNode(root, leafId, (target) => split(dir, isBefore ? [added, target] : [target, added]));
  return { root: next, leafId: added.id };
}

/** Removes a leaf; a split left with one child is replaced by that child, and the freed share goes to the siblings in proportion. */
export function closeLeaf(root: LayoutNode, leafId: string): LayoutNode | null {
  if (root.kind === 'leaf') return root.id === leafId ? null : root;
  const i = root.children.findIndex((c) => c.id === leafId);
  if (i >= 0) {
    const children = root.children.filter((_, j) => j !== i);
    if (children.length === 1) return children[0];
    return { ...root, children, sizes: normalize(root.sizes.filter((_, j) => j !== i)) };
  }
  return { ...root, children: root.children.map((c) => closeLeaf(c, leafId) ?? c) };
}

function normalize(sizes: number[]) {
  const total = sizes.reduce((a, b) => a + b, 0);
  return sizes.map((s) => (s / total) * 100);
}

export function swapLeaves(root: LayoutNode, aId: string, bId: string): LayoutNode {
  const a = findLeaf(root, aId);
  const b = findLeaf(root, bId);
  if (!a || !b) return root;
  return setLeafView(setLeafView(root, aId, b.view), bId, a.view);
}

export function rotateSplit(root: LayoutNode, splitId: string): LayoutNode {
  return mapNode(root, splitId, (n) => (n.kind === 'split' ? { ...n, dir: flip(n.dir) } : n));
}

function flip(dir: Orientation): Orientation {
  return dir === 'row' ? 'column' : 'row';
}

export function transpose(node: LayoutNode): LayoutNode {
  if (node.kind === 'leaf') return node;
  return { ...node, dir: flip(node.dir), children: node.children.map(transpose) };
}

export function resizeSplit(root: LayoutNode, splitId: string, sizes: number[]): LayoutNode {
  return mapNode(root, splitId, (n) => (n.kind === 'split' && n.children.length === sizes.length ? { ...n, sizes } : n));
}

export function equalizeSplit(root: LayoutNode, splitId: string): LayoutNode {
  return mapNode(root, splitId, (n) => (n.kind === 'split' ? { ...n, sizes: equalSizes(n.children.length) } : n));
}

/** Two-way splits snap their divider to 1/3, 1/2 or 2/3 when released within a few percent of one. */
export function snapSizes(sizes: number[]): number[] {
  if (sizes.length !== 2) return sizes;
  const point = SNAP_POINTS.find((p) => Math.abs(sizes[0] - p) <= SNAP_DISTANCE);
  return point === undefined ? sizes : [point, 100 - point];
}

/** The tree as the window shows it: auto layouts built for the other orientation appear transposed. */
export function displayRoot(layout: SpaceLayout, orientation: Orientation) {
  return layout.isAuto && layout.builtFor !== orientation ? transpose(layout.root) : layout.root;
}

/** Freezes what the window currently shows before an edit, so directional ops act on what the user sees. */
export function materialize(layout: SpaceLayout, orientation: Orientation): SpaceLayout {
  return { ...layout, root: displayRoot(layout, orientation), builtFor: orientation };
}

export function buildPreset(preset: Preset, views: View[], orientation: Orientation): LayoutNode {
  const v = (i: number) => leaf(views[i] ?? { kind: 'new' });
  const across = orientation;
  const down = flip(orientation);
  switch (preset) {
    case '2-up':
      return split(across, [v(0), v(1)]);
    case '3-columns':
      return split('row', [v(0), v(1), v(2)]);
    case '2x2':
      return split(down, [split(across, [v(0), v(1)]), split(across, [v(2), v(3)])]);
    case 'main-stack':
      return split(across, [v(0), split(down, [v(1), v(2)])], [200 / 3, 100 / 3]);
    case 'stack-3':
      return split('column', [v(0), v(1), v(2)]);
  }
}

export function presetSize(preset: Preset) {
  return preset === '2-up' ? 2 : preset === '2x2' ? 4 : 3;
}

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Ctrl Arrow focus: the leaf whose rect lies in that direction and overlaps on the other axis, nearest first. */
export function neighbourInDirection(rects: Record<string, Rect>, fromId: string, side: Side): string | undefined {
  const from = rects[fromId];
  if (!from) return undefined;
  const isHorizontal = side === 'left' || side === 'right';
  const gap = (r: Rect) => ({ left: from.left - r.right, right: r.left - from.right, top: from.top - r.bottom, bottom: r.top - from.bottom })[side];
  const overlaps = (r: Rect) => (isHorizontal ? r.top < from.bottom && r.bottom > from.top : r.left < from.right && r.right > from.left);
  const candidates = Object.entries(rects).filter(([id, r]) => id !== fromId && gap(r) >= -1 && overlaps(r));
  candidates.sort(([, a], [, b]) => gap(a) - gap(b));
  return candidates[0]?.[0];
}

/** Which drop zone a point falls in: the outer quarter on each side, the middle replaces. */
export function zoneAt(rect: Rect, x: number, y: number): Zone {
  const fx = (x - rect.left) / (rect.right - rect.left);
  const fy = (y - rect.top) / (rect.bottom - rect.top);
  const edges = { left: fx, right: 1 - fx, top: fy, bottom: 1 - fy } satisfies Record<Side, number>;
  const [side, distance] = Object.entries(edges).sort(([, a], [, b]) => a - b)[0] as [Side, number];
  return distance < 0.25 ? side : 'center';
}

export function sameView(a: View, b: View) {
  return JSON.stringify(a) === JSON.stringify(b);
}
