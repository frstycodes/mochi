export type AnnotationTool = 'pen' | 'arrow' | 'box' | 'note';

export interface Point {
  x: number;
  y: number;
}

/** In the screenshot's own pixels. `size` is the stroke width (font size for a note), fixed when drawn so it reads the same on screen. */
export type Shape =
  | { kind: 'pen'; color: string; size: number; points: Point[] }
  | {
      kind: 'arrow' | 'box';
      color: string;
      size: number;
      from: Point;
      to: Point;
    }
  | { kind: 'note'; color: string; size: number; at: Point; text: string };

/** Drawing colours: theme tokens, so the marks match the app; the PNG keeps the theme's value at the time it was sent. */
export const ANNOTATION_COLORS = [
  { token: '--destructive', name: 'Red' },
  { token: '--chart-4', name: 'Amber' },
  { token: '--chart-3', name: 'Green' },
  { token: '--chart-1', name: 'Blue' },
  { token: '--foreground', name: 'Ink' },
] as const;

export interface History {
  past: Shape[][];
  present: Shape[];
  future: Shape[][];
}

export type HistoryAction =
  | { type: 'add'; shape: Shape }
  | { type: 'undo' }
  | { type: 'redo' };

export const EMPTY_HISTORY: History = { past: [], present: [], future: [] };

export function history(state: History, action: HistoryAction): History {
  const { past, present, future } = state;
  if (action.type === 'add')
    return {
      past: [...past, present],
      present: [...present, action.shape],
      future: [],
    };
  if (action.type === 'undo')
    return past.length
      ? {
          past: past.slice(0, -1),
          present: past[past.length - 1],
          future: [present, ...future],
        }
      : state;
  return future.length
    ? { past: [...past, present], present: future[0], future: future.slice(1) }
    : state;
}

/** SVG path data for a shape's stroke. Arrows get a two-line head scaled to the stroke. */
export function shapePath(shape: Exclude<Shape, { kind: 'note' }>) {
  if (shape.kind === 'pen')
    return shape.points
      .map((p, i) => `${i ? 'L' : 'M'}${round(p.x)} ${round(p.y)}`)
      .join(' ');
  const { from, to } = shape;
  if (shape.kind === 'box')
    return `M${round(from.x)} ${round(from.y)} H${round(to.x)} V${round(to.y)} H${round(from.x)} Z`;
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const head = shape.size * 5;
  const wing = (turn: number) => ({
    x: to.x - head * Math.cos(angle + turn),
    y: to.y - head * Math.sin(angle + turn),
  });
  const [a, b] = [wing(Math.PI / 6), wing(-Math.PI / 6)];
  return `M${round(from.x)} ${round(from.y)} L${round(to.x)} ${round(to.y)} M${round(a.x)} ${round(a.y)} L${round(to.x)} ${round(to.y)} L${round(b.x)} ${round(b.y)}`;
}

/** A drag shorter than this (screen px) is a stray click, not a shape. */
export const MIN_DRAG = 4;

export function isTooSmall(shape: Shape, scale: number) {
  if (shape.kind === 'note') return !shape.text.trim();
  if (shape.kind === 'pen') return shape.points.length < 2;
  return (
    Math.hypot(shape.to.x - shape.from.x, shape.to.y - shape.from.y) <
    MIN_DRAG * scale
  );
}

const round = (n: number) => Math.round(n * 10) / 10;
