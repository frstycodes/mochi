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
};

/** The canvas's height as a share of the sidebar's: the tallest the ragged edge gets. */
export const HALO_SPAN = HALO.reach * (1 + HALO.raggedness);

export function haloMotion(space: Pick<Space, 'haloMotion'>): SpaceHaloMotion {
  return space.haloMotion ?? 'breathe';
}

export function isHaloMotion(value: unknown): value is SpaceHaloMotion {
  return (SPACE_HALO_MOTIONS as readonly unknown[]).includes(value);
}

// Whole numbers of waves per sidebar width, so the edge repeats exactly every width and Drift can loop without a seam.
const WAVES = [2, 3, 4, 5, 7];

/** The edge's swing in [-1, 1] at `x` (one sidebar width per 1), seeded per profile; `haloEdge(x + 1) === haloEdge(x)`. */
export function haloEdge(x: number, seed: number) {
  let value = 0;
  let total = 0;
  for (const [i, waves] of WAVES.entries()) {
    const amplitude = 1 / (i + 1);
    const phase = lattice(i, seed % 997) * 2 * Math.PI;
    value += amplitude * Math.sin(2 * Math.PI * waves * (x % 1) + phase);
    total += amplitude;
  }
  return value / total;
}

/**
 * The halo's alpha per pixel at full strength (`--halo-strength` in index.css scales it per theme), row by row from the top, for a canvas `width` × `height` device pixels holding `widths`
 * sidebar widths side by side (2 for Drift, which slides one width across and starts over).
 */
export function haloAlpha(
  width: number,
  height: number,
  seed: number,
  widths = 1,
) {
  const alpha = new Uint8ClampedArray(width * height);
  const baseReach = height / (1 + HALO.raggedness);
  for (let x = 0; x < width; x++) {
    const reach =
      baseReach * (1 + HALO.raggedness * haloEdge((x / width) * widths, seed));
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
