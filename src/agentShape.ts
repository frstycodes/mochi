export const PHASES = ['think', 'read', 'edit', 'run', 'browse', 'wait'] as const;
export type AgentPhase = (typeof PHASES)[number];

/**
 * Every form is drawn with the same dots, so a morph moves each dot from its place in one form to its place in the next.
 * Only the globe shows them as dots; the other forms pack them tight enough to read as solid strokes and fills.
 */
export const DOTS = 160;
/** Opacity steps a dot's ink snaps to; each is one path, drawn dimmest first so near dots sit on top. */
export const SHADES = [0.28, 0.42, 0.58, 0.78, 1] as const;
const TAU = Math.PI * 2;
/** Where the pencil's line starts and ends; read while the forms are first laid out, so it must sit above them. */
const INK_START = -5.7;
const INK_END = 1.5;

/** x, y and radius in viewBox px from the glyph centre, and ink from 0 (background) to 1 (full colour). */
type Dot = [x: number, y: number, r: number, ink: number];
type Point = [x: number, y: number];

const FORMS = {
  think: (t) => {
    const scan = t * (TAU / 2.2);
    return globe(120, 7, 6.9, t * (TAU / 10), 0.4).map(([x, y, front, lon]): Dot => {
      const lit = Math.exp(-((angleDiff(lon, scan) / 0.32) ** 2)) * front;
      return [x, y, 0.16 + 0.36 * front + 0.2 * lit, Math.min(1, 0.3 + 0.55 * front + 0.4 * lit)];
    });
  },
  read: (t) => {
    const flip = Math.PI * easeInOut(Math.min(1, (t % 2.2) / 0.9));
    const edge = 6.8 * Math.cos(flip);
    const lift = -0.9 * Math.sin(flip);
    return [
      ...stroke([[0, -3.4], [-2.2, -4.1], [-4.6, -4.4], [-6.8, -4.2], [-6.8, 3.6], [-4.6, 3.8], [-2.2, 4.1], [0, 4.6], [2.2, 4.1], [4.6, 3.8], [6.8, 3.6], [6.8, -4.2], [4.6, -4.4], [2.2, -4.1], [0, -3.4], [0, 4.6]], 0.55, 0.6, 1),
      ...[-1.6, 0.4].flatMap((y) => [...stroke([[-5.4, y - 0.9], [-1.4, y - 0.4]], 0.6, 0.38, 0.42), ...stroke([[1.4, y - 0.4], [5.4, y - 0.9]], 0.6, 0.38, 0.42)]),
      ...stroke([[0, -3.4], [edge * 0.5, -4.2 + lift], [edge, -4.2 + lift], [edge, 3.6 + lift], [edge * 0.5, 4 + lift], [0, 4.6]], 0.7, 0.5, 0.78),
    ];
  },
  edit: (t) => {
    const { contact, flip } = pencilStroke((t % 3.4) / 3.4);
    const ink = Array.from({ length: 26 }, (_, i): Dot => {
      const x = INK_START + ((INK_END - INK_START) * i) / 25;
      return [x, scribble(x), 0.48 * clamp01((contact - x) / 0.4 + 1), 1];
    });
    return [...ink, ...pencil(contact, flip)];
  },
  run: (t) => {
    const spin = t * (TAU / 0.9);
    return Array.from({ length: 2 * 24 }, (_, i): Dot => {
      const tail = (i % 24) / 23;
      const a = spin + Math.floor(i / 24) * Math.PI - tail * 2.6;
      return [6 * Math.cos(a), 6 * Math.sin(a), 1.15 - 0.9 * tail, 1 - 0.75 * tail];
    });
  },
  browse: (t) => {
    const planet: Dot[] = [
      [0, 0, 4, 0.42],
      [-0.6, -0.6, 3.1, 0.62],
      [-1.2, -1.2, 1.7, 0.85],
    ];
    const count = 96;
    const ring = Array.from({ length: count }, (_, i): Dot => {
      const a = (i / count) * TAU;
      const [x, y, z] = tiltRing(7.2 * Math.cos(a), 7.2 * Math.sin(a), 0.2 * Math.sin(t * (TAU / 3.2)));
      const glint = Math.exp(-((angleDiff(a, t * (TAU / 2)) / 0.5) ** 2));
      const isHidden = z < 0 && Math.hypot(x, y) < 4.3;
      return [x, y, isHidden ? 0 : 0.5, z < 0 ? 0.42 : 0.7 + 0.3 * glint];
    });
    return [...planet, ...ring];
  },
  wait: (t) => [[0, 0, 3.3 + 0.45 * Math.sin(t * (TAU / 2.6)), 1]],
} satisfies Record<AgentPhase, (t: number) => Dot[]>;

/** Dot i of every form is the i-th by angle around the centre at rest, so a morph moves dots mostly in and out instead of across. */
const ORDER = Object.fromEntries(
  PHASES.map((phase) => {
    const dots = fill(FORMS[phase](0));
    return [phase, dots.map((_, i) => i).sort((a, b) => Math.atan2(dots[a][1], dots[a][0]) - Math.atan2(dots[b][1], dots[b][0]))];
  }),
) as Record<AgentPhase, number[]>;

const FIELDS = 4;

/** The blend of every form by its weight at time `t`, as x, y, r, ink per dot; weights sum to 1. */
export function blendDots(weights: ArrayLike<number>, t: number, out = new Float32Array(DOTS * FIELDS)) {
  out.fill(0);
  PHASES.forEach((phase, k) => {
    const w = weights[k];
    if (w < 1e-4) return;
    const dots = fill(FORMS[phase](t));
    ORDER[phase].forEach((from, i) => {
      for (let f = 0; f < FIELDS; f++) out[i * FIELDS + f] += w * dots[from][f];
    });
  });
  return out;
}

/** One path per shade; every dot is a circle subpath, all drawn the same direction so overlapping dots fuse under nonzero fill. */
export function shadePaths(dots: ArrayLike<number>) {
  const paths = SHADES.map(() => '');
  for (let i = 0; i < DOTS; i++) {
    const [x, y, r, ink] = [8 + dots[i * FIELDS], 8 + dots[i * FIELDS + 1], dots[i * FIELDS + 2], dots[i * FIELDS + 3]];
    if (r < 0.05 || ink < 0.15) continue;
    const shade = SHADES.reduce((best, s, k) => (Math.abs(s - ink) < Math.abs(SHADES[best] - ink) ? k : best), 0);
    paths[shade] += `M${(x - r).toFixed(2)} ${y.toFixed(2)}a${r.toFixed(2)} ${r.toFixed(2)} 0 1 0 ${(2 * r).toFixed(2)} 0a${r.toFixed(2)} ${r.toFixed(2)} 0 1 0 ${(-2 * r).toFixed(2)} 0`;
  }
  return paths;
}

export function oneHot(phase: AgentPhase) {
  return Float32Array.from(PHASES, (p) => (p === phase ? 1 : 0));
}

const OMEGA = TAU / 0.35;

/**
 * Advances each weight along the exact solution of a critically damped spring toward the one-hot target of `phase`,
 * keeping its velocity, so a phase change mid-morph retargets without a jump. One linear spring for all, so the weights keep summing to 1.
 */
export function stepWeights(weights: Float32Array, velocities: Float32Array, phase: AgentPhase, dt: number) {
  const decay = Math.exp(-OMEGA * dt);
  PHASES.forEach((p, k) => {
    const x = weights[k] - (p === phase ? 1 : 0);
    const v = velocities[k];
    const c = v + OMEGA * x;
    weights[k] += (x + c * dt) * decay - x;
    velocities[k] = (v - OMEGA * c * dt) * decay;
  });
}

function fill(dots: Dot[]) {
  return Array.from({ length: DOTS }, (_, i) => dots[i % dots.length]);
}

/**
 * A dot globe: `count` dots over `rings` latitudes, each ring holding dots in proportion to its circumference so the poles don't crowd, turning about a tilted axis.
 * Returns screen x, y, how far each dot faces the viewer (0 at the back, 1 at the front) and its longitude in view space (0 faces the viewer's right).
 */
function globe(count: number, rings: number, radius: number, spin: number, tilt: number) {
  const lats = Array.from({ length: rings }, (_, i) => ((i + 0.5) / rings) * Math.PI - Math.PI / 2);
  const total = lats.reduce((sum, lat) => sum + Math.cos(lat), 0);
  return lats.flatMap((lat, ring) => {
    const columns = Math.round((count * Math.cos(lat)) / total);
    return Array.from({ length: columns }, (_, i) => {
      const lon = ((i + (ring % 2) * 0.5) / columns) * TAU + spin;
      const x = Math.cos(lat) * Math.cos(lon);
      const z = Math.cos(lat) * Math.sin(lon);
      const y = Math.sin(lat) * Math.cos(tilt) - z * Math.sin(tilt);
      const front = Math.sin(lat) * Math.sin(tilt) + z * Math.cos(tilt);
      return [radius * x, -radius * y, (front + 1) / 2, Math.atan2(z, x)] as const;
    });
  });
}

/** Saturn's ring plane, tipped toward the viewer and turned a little on screen: screen x, y and depth (positive is in front). */
function tiltRing(x: number, z: number, wobble: number) {
  const tip = 1.2 + wobble * 0.3;
  const turn = -0.35 + wobble;
  const y = -z * Math.cos(tip);
  const depth = z * Math.sin(tip);
  return [x * Math.cos(turn) - y * Math.sin(turn), x * Math.sin(turn) + y * Math.cos(turn), depth] as const;
}

/** Dots spaced evenly along a polyline, close enough to fuse into one stroke. */
function stroke(points: Point[], spacing: number, r: number, ink: number): Dot[] {
  const dots: Dot[] = [];
  let carry = 0;
  for (let i = 1; i < points.length; i++) {
    const [ax, ay] = points[i - 1];
    const [bx, by] = points[i];
    const length = Math.hypot(bx - ax, by - ay);
    for (let s = carry; s < length; s += spacing) dots.push([ax + ((bx - ax) * s) / length, ay + ((by - ay) * s) / length, r, ink]);
    carry = (((carry - length) % spacing) + spacing) % spacing;
  }
  return dots;
}

function scribble(x: number) {
  return 5.2 + 0.6 * Math.sin(x * 2.2);
}

/**
 * One loop of the pencil: write the line left to right, flip end over end, erase it right to left, flip back.
 * `contact` is the x where the pencil touches the line (ink shows left of it); `flip` turns 0 → π (eraser down) → 2π.
 */
function pencilStroke(f: number) {
  if (f < 0.4) return { contact: INK_START - 0.35 + (INK_END + 0.35 - INK_START) * (f / 0.4), flip: 0 };
  if (f < 0.5) return { contact: INK_END, flip: Math.PI * easeInOut((f - 0.4) / 0.1) };
  if (f < 0.88) return { contact: INK_END - (INK_END + 0.35 - INK_START) * ((f - 0.5) / 0.38), flip: Math.PI };
  return { contact: -Infinity, flip: Math.PI * (1 + easeInOut((f - 0.88) / 0.12)) };
}

/**
 * A pencil leaning up and right from its contact point: tapered nib, body, a shaded band and a wider, dimmer eraser cap.
 * `flip` twirls it end over end about its middle, shortened while it turns so it reads as turning in depth (the end coming toward you brighter) and stays inside the glyph.
 */
function pencil(contact: number, flip: number): Dot[] {
  const x0 = Number.isFinite(contact) ? contact : INK_START - 0.35;
  const middle = 5.3;
  const turn = Math.sin(flip);
  const reach = 1 - 0.75 * Math.abs(turn);
  const [cx, cy] = [x0 + middle * 0.45, scribble(x0) - 0.5 - middle * 0.89 - 0.8 * turn * turn];
  const [ux, uy] = [0.45 * Math.cos(flip) + 0.89 * Math.sin(flip), -0.89 * Math.cos(flip) + 0.45 * Math.sin(flip)];
  const parts: [d: number, r: number, ink: number][] = [
    ...Array.from({ length: 8 }, (_, i): [number, number, number] => [0.35 + (2.6 * i) / 7, 0.3 + (0.95 * i) / 7, 1]),
    ...Array.from({ length: 14 }, (_, i): [number, number, number] => [3.2 + (5.7 * i) / 13, 1.25, 1]),
    [9.2, 1.3, 0.78],
    [9.5, 1.3, 0.78],
    ...Array.from({ length: 3 }, (_, i): [number, number, number] => [9.85 + 0.2 * i, 1.4, 0.5]),
  ];
  return parts.map(([d, r, ink]) => {
    const along = (d - middle) * reach;
    const depth = ((d - middle) / middle) * turn;
    return [cx + along * ux, cy + along * uy, r, Math.min(1, ink * (1 - 0.25 * Math.abs(turn) + 0.25 * depth))];
  });
}

function clamp01(x: number) {
  return Math.min(1, Math.max(0, x));
}

function angleDiff(a: number, b: number) {
  return ((((a - b) % TAU) + TAU * 1.5) % TAU) - Math.PI;
}

function easeInOut(x: number) {
  return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
}
