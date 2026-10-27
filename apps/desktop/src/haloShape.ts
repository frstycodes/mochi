import {
  SPACE_HALO_MOTIONS,
  type Space,
  type SpaceHaloMotion,
} from './model.ts';

/** The sidebar halo: a glow up from the bottom whose top edge rises and falls along the width, one shape per profile. */
export const HALO = {
  /** Drift's sideways travel, in sidebar widths per second. */
  drift: 0.02,
};

/**
 * The halo's per-profile sliders, all in percent. Reach is the glow's average height as a share of the sidebar's,
 * raggedness how far its edge swings either way as a share of that reach, intensity a multiplier on the theme's
 * `--halo-strength` (index.css).
 */
export const HALO_KNOBS = {
  haloReach: {
    label: 'Reach',
    description: 'How high the glow rises, as a share of the sidebar',
    min: 4,
    max: 30,
    step: 1,
    fallback: 12,
  },
  haloRaggedness: {
    label: 'Raggedness',
    description: 'How far the glow’s top edge rises and falls',
    min: 0,
    max: 100,
    step: 5,
    fallback: 25,
  },
  haloIntensity: {
    label: 'Intensity',
    description: 'How strong the glow is, against the theme’s default',
    min: 25,
    max: 200,
    step: 5,
    fallback: 75,
  },
};
export type HaloKnob = keyof typeof HALO_KNOBS;
export const HALO_KNOB_KEYS = Object.keys(HALO_KNOBS) as HaloKnob[];

/** The profile's value for `knob`, clamped to its range: stored values outside it (an older range) still read sensibly. */
export function haloKnob(space: Pick<Space, HaloKnob>, knob: HaloKnob) {
  const { min, max, fallback } = HALO_KNOBS[knob];
  return Math.min(max, Math.max(min, space[knob] ?? fallback));
}

/** The canvas's height as a share of the sidebar's: the tallest the edge gets at full raggedness. */
export function haloSpan(space: Pick<Space, 'haloReach'>) {
  return (haloKnob(space, 'haloReach') / 100) * 2;
}

export function haloMotion(space: Pick<Space, 'haloMotion'>): SpaceHaloMotion {
  return space.haloMotion ?? 'breathe';
}

export function isHaloMotion(value: unknown): value is SpaceHaloMotion {
  return (SPACE_HALO_MOTIONS as readonly unknown[]).includes(value);
}

// Whole numbers of waves per sidebar width, so the edge repeats every width and Drift's shift never shows a seam.
const WAVES = [2, 3, 4, 5, 7];

/**
 * The edge's swing in [-1, 1] at `x` (one sidebar width per 1) and `time` seconds, seeded per profile. Each wave runs at
 * its own speed and direction, so over time the edge reshapes instead of repeating one outline.
 */
export function haloEdge(x: number, seed: number, time = 0) {
  const offset = seed % 997;
  let value = 0;
  let total = 0;
  for (const [i, waves] of WAVES.entries()) {
    const amplitude = 1 / (i + 1);
    const phase = lattice(i, offset) * 2 * Math.PI;
    const direction = lattice(i + 20, offset) < 0.5 ? -1 : 1;
    // Radians per second: slow enough to read as ambient, never as a loading bar.
    const speed = direction * (0.3 + 0.5 * lattice(i + 10, offset));
    value +=
      amplitude * Math.sin(2 * Math.PI * waves * x + phase + speed * time);
    total += amplitude;
  }
  return value / total;
}

/**
 * The halo's alpha per pixel at full strength (`--halo-strength` in index.css scales it per theme), row by row from the
 * top, for a canvas `width` × `height` device pixels at `time` seconds, its edge moved `shift` sidebar widths left and
 * swinging `raggedness` percent either way.
 */
export function haloAlpha(
  width: number,
  height: number,
  seed: number,
  { time = 0, shift = 0, raggedness = HALO_KNOBS.haloRaggedness.fallback } = {},
) {
  const alpha = new Uint8ClampedArray(width * height);
  // The canvas is twice the reach (`haloSpan`), room for full raggedness, so the average reach is half its height.
  const baseReach = height / 2;
  const swing = raggedness / 100;
  for (let x = 0; x < width; x++) {
    const reach =
      baseReach * (1 + swing * haloEdge(x / width + shift, seed, time));
    for (let y = 0; y < height; y++) {
      const linear = 1 - (height - y) / reach;
      if (linear <= 0) continue;
      // Smoothstep: no slope where the glow ends, so its top dissolves instead of stopping on a line.
      const strength = linear * linear * (3 - 2 * linear);
      // Fixed grain against banding: `--halo-strength` leaves only a few dozen visible steps. Faded out at the top so
      // it never speckles the clear sidebar above the edge.
      const grain = (grainAt(x, y) - 0.5) * GRAIN * Math.min(1, strength * 8);
      alpha[y * width + x] = Math.round(255 * strength + grain);
    }
  }
  return alpha;
}

// In alpha units out of 255: about one visible step either way at the 15% dark-theme strength.
const GRAIN = 8;

// Per pixel and fixed, so the grain doesn't shimmer as the edge moves.
function grainAt(x: number, y: number) {
  const z = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return z - Math.floor(z);
}

function lattice(n: number, offset: number) {
  const z = Math.sin(n * 127.1 + offset * 311.7) * 43758.5453;
  return z - Math.floor(z);
}
