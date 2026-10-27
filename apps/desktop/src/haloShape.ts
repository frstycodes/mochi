import {
  SPACE_HALO_MOTIONS,
  type Space,
  type SpaceHaloMotion,
} from './model.ts';

/** The sidebar halo: a linear glow up from the bottom whose top edge rises and falls along the width, one shape per profile. */
export const HALO = {
  /** Average height, as a share of the sidebar's. */
  reach: 0.1,
  /** How far the edge swings either way, as a share of `reach`. */
  raggedness: 0.8,
  /** Drift's sideways travel, in sidebar widths per second. */
  drift: 0.02,
};

/** The canvas's height as a share of the sidebar's: the tallest the ragged edge gets. */
export const HALO_SPAN = HALO.reach * (1 + HALO.raggedness);

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
 * top, for a canvas `width` × `height` device pixels at `time` seconds, its edge moved `shift` sidebar widths left.
 */
export function haloAlpha(
  width: number,
  height: number,
  seed: number,
  { time = 0, shift = 0 } = {},
) {
  const alpha = new Uint8ClampedArray(width * height);
  const baseReach = height / (1 + HALO.raggedness);
  for (let x = 0; x < width; x++) {
    const reach =
      baseReach *
      (1 + HALO.raggedness * haloEdge(x / width + shift, seed, time));
    for (let y = 0; y < height; y++) {
      const strength = 1 - (height - y) / reach;
      if (strength > 0) alpha[y * width + x] = Math.round(255 * strength);
    }
  }
  return alpha;
}

function lattice(n: number, offset: number) {
  const z = Math.sin(n * 127.1 + offset * 311.7) * 43758.5453;
  return z - Math.floor(z);
}
