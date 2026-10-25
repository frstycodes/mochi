export const PHASES = [
  'idle',
  'start',
  'think',
  'read',
  'edit',
  'run',
  'browse',
  'wait',
] as const;
export type AgentPhase = (typeof PHASES)[number];

const TAU = Math.PI * 2;

/** The canvas is 24 units square; the body leaves room around it for each phase's props. */
export const VIEW = 24;
/** Frames the canvas on the body (and its shadow) so it sits centred inline; props above it draw past the top edge. */
export const VIEW_BOX = `0 3.5 ${VIEW} ${VIEW}`;
/** The logo's dome, its bottom centre at the origin. */
export const BODY =
  'M-6.5 -1.62C-6.5 -6.91 -3.66 -9.75 0 -9.75C3.66 -9.75 6.5 -6.91 6.5 -1.62C6.5 -0.41 5.69 0 4.47 0L-4.47 0C-5.69 0 -6.5 -0.41 -6.5 -1.62Z';
export const BODY_HEIGHT = 9.75;
export const EYE_R = 1.3;
/** Where the dome stands. */
export const GROUND: Point = [12, 20];

/** Fixed colours for props that are objects (paper, pencil, lens), readable on both themes; marks (zzz, lines, bubbles) use currentColor. */
const MATERIAL = {
  ink: 'currentColor',
  paper: 'oklch(0.97 0.012 85)',
  outline: 'oklch(0.38 0.02 60)',
  print: 'oklch(0.62 0.02 60)',
  pencil: 'oklch(0.84 0.15 82)',
  wood: 'oklch(0.86 0.05 70)',
  lead: 'oklch(0.3 0.01 285)',
  eraser: 'oklch(0.76 0.11 12)',
  rim: 'oklch(0.45 0.02 285)',
  handle: 'oklch(0.55 0.09 55)',
  glass: 'oklch(1 0 0)',
};

type Point = [x: number, y: number];

/**
 * Mochi's body in one frame. Offset, squash and lean are in canvas units; the eye sits in body space, so it squashes with the body;
 * `blink` scales its height (1 open, 0 shut) and `eyeS` its size (wide eyes when startled, magnified through the lens).
 */
export const POSE = [
  'dx',
  'dy',
  'sx',
  'sy',
  'lean',
  'eyeX',
  'eyeY',
  'blink',
  'eyeS',
] as const;
export type Pose = Record<(typeof POSE)[number], number>;

/** One prop shape. Colours and stroke are fixed per shape; only `d` and opacity move. */
export interface Shape {
  d: string;
  o: number;
  fill?: string;
  stroke?: string;
  w?: number;
}

const REST: Pose = {
  dx: 0,
  dy: 0,
  sx: 1,
  sy: 1,
  lean: 0,
  eyeX: 1.62,
  eyeY: -5.28,
  blink: 1,
  eyeS: 1,
};

const START_PERIOD = 3.4;

// lean < 0 tips the top right, toward the work; > 0 tips it left.
const POSES = {
  // Nothing to do: breathes slowly, glances about, blinks.
  idle: (t) => {
    const breathe = Math.sin(t * (TAU / 4));
    const glance =
      smooth(0, 1, Math.sin(t * (TAU / 7)) * 2) -
      smooth(0, 1, -Math.sin(t * (TAU / 7)) * 2);
    return {
      ...REST,
      sx: 1 - 0.02 * breathe,
      sy: 1 + 0.025 * breathe,
      eyeX: 1.62 + 0.9 * glance,
      blink: 1 - bump(t % 4.2, 3.9, 0.07),
    };
  },
  // Dozes squashed with its eye shut, jolts awake wide-eyed, lands with a wobble, then nods off again.
  start: (t) => {
    const f = (t % START_PERIOD) / START_PERIOD;
    const sleep = asleep(f);
    const j = clamp01((f - 0.5) / 0.16);
    const air = f > 0.5 && f < 0.66 ? Math.sin(Math.PI * j) : 0;
    const land =
      f > 0.66 && f < 0.76 ? Math.sin(Math.PI * ((f - 0.66) / 0.1)) : 0;
    const shock = bump(f, 0.6, 0.08);
    const wobble =
      f > 0.66 && f < 0.86
        ? 0.35 * Math.sin((f - 0.66) * 60) * (1 - (f - 0.66) / 0.2)
        : 0;
    const snore = sleep * Math.sin(t * (TAU / 1.7));
    return {
      ...REST,
      dx: wobble,
      dy: -3 * 4 * j * (1 - j) * (f > 0.5 && f < 0.66 ? 1 : 0),
      sx: 1 + 0.12 * sleep - 0.03 * snore - 0.1 * air + 0.12 * land,
      sy: 1 - 0.2 * sleep + 0.04 * snore + 0.16 * air - 0.16 * land,
      eyeY: -5.28 - 0.5 * shock,
      blink: 1 - 0.93 * sleep,
      eyeS: 1 + 0.45 * shock,
    };
  },
  think: (t) => {
    const breathe = Math.sin(t * (TAU / 1.8));
    return {
      ...REST,
      sx: 1 - 0.025 * breathe,
      sy: 1 + 0.035 * breathe,
      eyeX: 2.2 + 0.5 * Math.sin(t * (TAU / 3.6)),
      eyeY: -6.5,
      blink: 1 - bump(t % 3.6, 3.3, 0.06),
    };
  },
  // Eye runs along the page and flicks back to the next line.
  read: (t) => {
    const f = (t % 1.3) / 1.3;
    const sweep = f < 0.8 ? f / 0.8 : 1 - smooth(0.8, 1, f);
    return {
      ...REST,
      sy: 0.97,
      lean: 0.03,
      eyeX: -1.8 + 4 * sweep,
      eyeY: -5.1 + 0.4 * (Math.floor(t / 1.3) % 2),
      blink: 0.72,
    };
  },
  // Leans toward the pencil, squinting, pressing in time with the strokes.
  edit: (t) => {
    const f = (t % 0.9) / 0.9;
    const press = bump(f, 0.05, 0.06) + bump(f, 0.3, 0.06);
    return {
      ...REST,
      sx: 1 + 0.06 * press,
      sy: 1 - 0.08 * press,
      lean: -0.1,
      eyeX: 2.8,
      eyeY: -4.5,
      blink: 0.55,
    };
  },
  run: (t) => {
    const f = (t % 0.62) / 0.62;
    const air = Math.min(1, f / 0.7);
    const land = f > 0.7 ? Math.sin(Math.PI * ((f - 0.7) / 0.3)) : 0;
    const stretch = f < 0.7 ? Math.sin(Math.PI * air) : 0;
    return {
      ...REST,
      dy: -2.2 * 4 * air * (1 - air),
      sx: 1 + 0.13 * land - 0.04 * stretch,
      sy: 1 - 0.16 * land + 0.06 * stretch,
      lean: -0.08,
      eyeX: 2.8,
      eyeY: -5.6,
    };
  },
  // Sways, peering through the lens in a slow circle.
  browse: (t) => {
    const a = t * (TAU / 2.8);
    return {
      ...REST,
      dx: 0.35 * Math.sin(a),
      lean: 0.06 * Math.sin(a),
      eyeX: 1 + 1.5 * Math.cos(a),
      eyeY: -5.6 + 0.9 * Math.sin(a),
      eyeS: 1.25,
    };
  },
  // Looks straight at you, breathing slowly, blinking now and then.
  wait: (t) => {
    const breathe = Math.sin(t * (TAU / 3));
    return {
      ...REST,
      sx: 1 - 0.025 * breathe,
      sy: 1 + 0.035 * breathe,
      eyeX: 0,
      eyeY: -5.4,
      blink: 1 - bump(t % 3.4, 3.15, 0.07),
    };
  },
} satisfies Record<AgentPhase, (t: number) => Pose>;

/** Each phase's props, placed against the blended body so they stay attached mid-morph. Each returns the same number of shapes every frame. */
const PROPS = {
  idle: () => [],
  // Three z's drift off the head while it sleeps; surprise lines burst out when it jolts awake.
  start: (t, pose) => {
    const f = (t % START_PERIOD) / START_PERIOD;
    const dozing = asleep(f);
    const top = headTop(pose);
    const zs = [0, 1, 2].map((i): Shape => {
      const u = (t / 1.2 + i / 3) % 1;
      const s = 1.1 + 1.1 * u;
      const x = 15.4 + 4.4 * u;
      const y = 9.4 - 7 * u;
      return {
        d: `M${f2(x)} ${f2(y)}h${f2(s)}l${f2(-s)} ${f2(s)}h${f2(s)}`,
        o: Math.sin(Math.PI * u) * dozing,
        stroke: MATERIAL.ink,
        w: 0.6,
      };
    });
    const shock = bump(f, 0.6, 0.07);
    const lines = [-150, -90, -30].map((deg): Shape => {
      const a = (deg * Math.PI) / 180;
      const [ux, uy] = [Math.cos(a), Math.sin(a)];
      const r0 = 1.2 + 0.8 * clamp01((f - 0.52) / 0.15);
      const [cx, cy] = [top[0], top[1] + 0.6];
      return {
        d: `M${f2(cx + ux * r0)} ${f2(cy + uy * r0)}L${f2(cx + ux * (r0 + 1.6))} ${f2(cy + uy * (r0 + 1.6))}`,
        o: shock,
        stroke: MATERIAL.ink,
        w: 0.6,
      };
    });
    return [...zs, ...lines];
  },
  // A thought cloud, fed by two rising dots, with three dots bouncing in it.
  think: (t) => {
    const cy = 4.6 + 0.3 * Math.sin(t * (TAU / 2.4));
    const cloud = scallop(19, cy, 3.7, 2.5, 7);
    const dots = [0, 1, 2].map((i): Shape => {
      const lift = Math.max(0, Math.sin(t * (TAU / 1.2) - i * 0.9));
      return {
        d: circle(17.6 + 1.4 * i, cy + 0.2 - 0.6 * lift, 0.45),
        o: 0.55 + 0.45 * lift,
        fill: MATERIAL.ink,
      };
    });
    const pulse = 0.6 + 0.4 * Math.sin(t * (TAU / 1.2));
    return [
      { d: circle(15.2, 9.9, 0.45), o: pulse, fill: MATERIAL.ink },
      {
        d: circle(16.4, 8.5, 0.7),
        o: 0.6 + 0.4 * Math.sin(t * (TAU / 1.2) - 0.6),
        fill: MATERIAL.ink,
      },
      { d: cloud, o: 0.14, fill: MATERIAL.ink },
      { d: cloud, o: 1, stroke: MATERIAL.ink, w: 0.55 },
      ...dots,
    ];
  },
  // Holds an open book; a page turns now and then.
  read: (t, pose) => {
    const [x, y] = [GROUND[0] + pose.dx, GROUND[1] + 0.2];
    const page = (sign: number) =>
      `M${f2(x)} ${f2(y - 3.3)}Q${f2(x + sign * 2.3)} ${f2(y - 4.1)} ${f2(x + sign * 4.7)} ${f2(y - 3.7)}L${f2(x + sign * 4.7)} ${f2(y + 0.3)}Q${f2(x + sign * 2.3)} ${f2(y - 0.1)} ${f2(x)} ${f2(y + 0.7)}Z`;
    const lines = [-1, 1]
      .flatMap((sign) =>
        [-2.4, -1.3, -0.2].map(
          (dy) =>
            `M${f2(x + sign * 1)} ${f2(y + dy)}Q${f2(x + sign * 2.3)} ${f2(y + dy - 0.35)} ${f2(x + sign * 3.8)} ${f2(y + dy - 0.1)}`,
        ),
      )
      .join('');
    const p = smooth(0, 1, ((t % 2.6) - 1.7) / 0.8);
    const edge = 4.7 * Math.cos(Math.PI * p);
    const lift = -1.1 * Math.sin(Math.PI * p);
    const turning = `M${f2(x)} ${f2(y - 3.3)}Q${f2(x + edge / 2)} ${f2(y - 4.1 + lift)} ${f2(x + edge)} ${f2(y - 3.7 + lift)}L${f2(x + edge)} ${f2(y + 0.3 + lift)}Q${f2(x + edge / 2)} ${f2(y - 0.1 + lift)} ${f2(x)} ${f2(y + 0.7)}Z`;
    return [
      {
        d: page(-1),
        o: 1,
        fill: MATERIAL.paper,
        stroke: MATERIAL.outline,
        w: 0.35,
      },
      {
        d: page(1),
        o: 1,
        fill: MATERIAL.paper,
        stroke: MATERIAL.outline,
        w: 0.35,
      },
      { d: lines, o: 1, stroke: MATERIAL.print, w: 0.3 },
      {
        d: turning,
        o: p > 0 && p < 1 ? 1 : 0,
        fill: MATERIAL.paper,
        stroke: MATERIAL.outline,
        w: 0.35,
      },
    ];
  },
  // A pencil writes a wavy line beside it, lifts, and goes back to the start as the line fades.
  edit: (t) => {
    const f = (t % 2.2) / 2.2;
    const [from, to, base] = [12.6, 19.4, 22.5];
    const writing = Math.min(1, f / 0.72);
    const back = smooth(0.78, 1, f);
    const cx = from + (to - from) * (writing - back);
    const cy =
      wave(cx, base) -
      1.2 * Math.sin(Math.PI * back) +
      (f < 0.72 ? 0.12 * Math.sin(t * 45) : 0);
    const inkEnd = from + (to - from) * writing;
    const ink = Array.from({ length: 18 }, (_, i) => {
      const x = from + ((inkEnd - from) * i) / 17;
      return `${i ? 'L' : 'M'}${f2(x)} ${f2(wave(x, base))}`;
    }).join('');
    return [
      { d: ink, o: 1 - smooth(0.74, 0.9, f), stroke: MATERIAL.ink, w: 0.55 },
      ...pencil([cx, cy]),
    ];
  },
  // Speed lines stream back from the body; dust puffs where it lands.
  run: (t, pose) => {
    const f = (t % 0.62) / 0.62;
    const lines = [0, 1, 2].map((i): Shape => {
      const u = (t / 0.4 + i * 0.37) % 1;
      const x = 5.2 - 3 * u;
      const y = 12.2 + 2.8 * i + pose.dy;
      return {
        d: `M${f2(x)} ${f2(y)}h${f2(-2.2 * (1 - u) - 0.4)}`,
        o: Math.sin(Math.PI * u),
        stroke: MATERIAL.ink,
        w: 0.55,
      };
    });
    const g = f > 0.68 ? (f - 0.68) / 0.32 : 0;
    const puffs = [-1, 1].map((sign): Shape => ({
      d: circle(12 + sign * (6.4 + 1.6 * g), 20.1 - 0.7 * g, 0.4 + 0.9 * g),
      o: g > 0 ? 0.5 * (1 - g) : 0,
      fill: MATERIAL.ink,
    }));
    return [...lines, ...puffs];
  },
  // A magnifying glass held over its eye, following it around.
  browse: (_t, pose) => {
    const [x, y] = eyeAt(pose);
    const r = 2.4;
    const [hx, hy] = [x + r * 0.71, y + r * 0.71];
    return [
      { d: circle(x, y, r), o: 0.22, fill: MATERIAL.glass },
      {
        d: `M${f2(hx + 0.2)} ${f2(hy + 0.2)}L${f2(hx + 2.6)} ${f2(hy + 2.6)}`,
        o: 1,
        stroke: MATERIAL.handle,
        w: 1.15,
      },
      { d: circle(x, y, r), o: 1, stroke: MATERIAL.rim, w: 0.65 },
      {
        d: `M${f2(x - 1.5)} ${f2(y - 0.6)}A1.6 1.6 0 0 1 ${f2(x - 0.6)} ${f2(y - 1.5)}`,
        o: 0.9,
        stroke: MATERIAL.glass,
        w: 0.35,
      },
    ];
  },
  // A bobbing speech bubble with a question mark: it's your turn.
  wait: (t) => {
    const y = 0.35 * Math.sin(t * (TAU / 2));
    const bubble = `M17 ${f2(2 + y)}H21.6Q22.6 ${f2(2 + y)} 22.6 ${f2(3 + y)}V${f2(7 + y)}Q22.6 ${f2(8 + y)} 21.6 ${f2(8 + y)}H18.4L16.6 ${f2(9.6 + y)}L17 ${f2(8 + y)}Q16 ${f2(8 + y)} 16 ${f2(7 + y)}V${f2(3 + y)}Q16 ${f2(2 + y)} 17 ${f2(2 + y)}Z`;
    return [
      { d: bubble, o: 0.14, fill: MATERIAL.ink },
      { d: bubble, o: 1, stroke: MATERIAL.ink, w: 0.55 },
      {
        d: `M18.3 ${f2(4.1 + y)}Q18.3 ${f2(3 + y)} 19.3 ${f2(3 + y)}Q20.3 ${f2(3 + y)} 20.3 ${f2(4 + y)}Q20.3 ${f2(4.8 + y)} 19.3 ${f2(5.2 + y)}V${f2(5.8 + y)}`,
        o: 1,
        stroke: MATERIAL.ink,
        w: 0.6,
      },
      { d: circle(19.3, 7 + y, 0.42), o: 1, fill: MATERIAL.ink },
    ];
  },
} satisfies Record<AgentPhase, (t: number, pose: Pose) => Shape[]>;

/** Every phase's pose at time `t`, mixed by its weight: phases morph into each other instead of cutting. */
export function blendPose(weights: ArrayLike<number>, t: number): Pose {
  const out = Object.fromEntries(POSE.map((k) => [k, 0])) as Pose;
  PHASES.forEach((p, i) => {
    if (weights[i] < 1e-4) return;
    const pose = POSES[p](t);
    for (const k of POSE) out[k] += weights[i] * pose[k];
  });
  return out;
}

export function propShapes(phase: AgentPhase, t: number, pose: Pose) {
  return PROPS[phase](t, pose);
}

/** The SVG attributes for a pose: body transform, eye and its glint, and the contact shadow that shrinks as it leaves the ground. */
export function poseAttributes(pose: Pose) {
  const [x, y] = GROUND;
  const lift = 1 / (1 + Math.max(0, -pose.dy) / 3);
  const r = EYE_R * pose.eyeS;
  const open = Math.max(0.08, pose.blink);
  return {
    body: `translate(${f2(x + pose.dx)} ${f2(y + pose.dy)}) matrix(${f2(pose.sx)} 0 ${f2(pose.lean)} ${f2(pose.sy)} 0 0)`,
    eye: { cx: f2(pose.eyeX), cy: f2(pose.eyeY), rx: f2(r), ry: f2(r * open) },
    glint: {
      cx: f2(pose.eyeX - 0.4 * r),
      cy: f2(pose.eyeY - 0.4 * r * open),
      r: f2(0.3 * r),
      opacity: f2(smooth(0.45, 0.75, pose.blink)),
    },
    shadow: {
      cx: f2(x + pose.dx),
      rx: f2(6.6 * pose.sx * lift),
      opacity: f2(lift),
    },
  };
}

export function oneHot(phase: AgentPhase) {
  return Float32Array.from(PHASES, (p) => (p === phase ? 1 : 0));
}

const OMEGA = TAU / 0.35;

/**
 * Advances each weight along the exact solution of a critically damped spring toward the one-hot target of `phase`,
 * keeping its velocity, so a phase change mid-morph retargets without a jump. One linear spring for all, so the weights keep summing to 1.
 */
export function stepWeights(
  weights: Float32Array,
  velocities: Float32Array,
  phase: AgentPhase,
  dt: number,
) {
  const decay = Math.exp(-OMEGA * dt);
  PHASES.forEach((p, k) => {
    const x = weights[k] - (p === phase ? 1 : 0);
    const v = velocities[k];
    const c = v + OMEGA * x;
    weights[k] += (x + c * dt) * decay - x;
    velocities[k] = (v - OMEGA * c * dt) * decay;
  });
}

/** Where the eye's centre lands on the canvas after the body's transform. */
export function eyeAt(pose: Pose): Point {
  return [
    GROUND[0] + pose.dx + pose.sx * pose.eyeX + pose.lean * pose.eyeY,
    GROUND[1] + pose.dy + pose.sy * pose.eyeY,
  ];
}

function headTop(pose: Pose): Point {
  return [
    GROUND[0] + pose.dx - pose.lean * BODY_HEIGHT,
    GROUND[1] + pose.dy - pose.sy * BODY_HEIGHT,
  ];
}

/** 1 while dozing in the start loop, 0 once startled awake; it drifts back off at the end, so the loop is seamless. */
function asleep(f: number) {
  return clamp01(1 - smooth(0.48, 0.52, f) + smooth(0.86, 1, f));
}

function pencil([x, y]: Point): Shape[] {
  // Points up and right from the tip at (x, y).
  const u: Point = [0.57, -0.82];
  const n: Point = [0.82, 0.57];
  const at = (s: number, side: number): string =>
    `${f2(x + u[0] * s + n[0] * side)} ${f2(y + u[1] * s + n[1] * side)}`;
  const band = (s0: number, s1: number) =>
    `M${at(s0, -0.5)}L${at(s1, -0.5)}L${at(s1, 0.5)}L${at(s0, 0.5)}Z`;
  return [
    {
      d: `M${at(0, 0)}L${at(1.7, -0.5)}L${at(1.7, 0.5)}Z`,
      o: 1,
      fill: MATERIAL.wood,
      stroke: MATERIAL.outline,
      w: 0.2,
    },
    {
      d: `M${at(0, 0)}L${at(0.6, -0.18)}L${at(0.6, 0.18)}Z`,
      o: 1,
      fill: MATERIAL.lead,
    },
    {
      d: band(1.7, 5.6),
      o: 1,
      fill: MATERIAL.pencil,
      stroke: MATERIAL.outline,
      w: 0.2,
    },
    {
      d: band(5.6, 6.6),
      o: 1,
      fill: MATERIAL.eraser,
      stroke: MATERIAL.outline,
      w: 0.2,
    },
  ];
}

function wave(x: number, base: number) {
  return base + 0.4 * Math.sin(x * 2.1);
}

/** A cloud outline: arcs bulging outward between points on an ellipse. */
function scallop(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  bumps: number,
) {
  const points = Array.from({ length: bumps }, (_, i): Point => {
    const a = (i / bumps) * TAU;
    return [cx + rx * Math.cos(a), cy + ry * Math.sin(a)];
  });
  const arcs = points.map((_, i) => {
    const [ax, ay] = points[i];
    const [bx, by] = points[(i + 1) % bumps];
    const r = 0.62 * Math.hypot(bx - ax, by - ay);
    return `A${f2(r)} ${f2(r)} 0 0 1 ${f2(bx)} ${f2(by)}`;
  });
  return `M${f2(points[0][0])} ${f2(points[0][1])}${arcs.join('')}Z`;
}

function circle(x: number, y: number, r: number) {
  return `M${f2(x - r)} ${f2(y)}a${f2(r)} ${f2(r)} 0 1 0 ${f2(2 * r)} 0a${f2(r)} ${f2(r)} 0 1 0 ${f2(-2 * r)} 0`;
}

function smooth(from: number, to: number, x: number) {
  const k = clamp01((x - from) / (to - from));
  return k * k * (3 - 2 * k);
}

function bump(x: number, at: number, width: number) {
  return Math.exp(-(((x - at) / width) ** 2));
}

function clamp01(x: number) {
  return Math.min(1, Math.max(0, x));
}

function f2(n: number) {
  return n.toFixed(2);
}
