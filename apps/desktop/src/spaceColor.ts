import { SPACE_COLOR_NAMES, type Space, type SpaceColor } from './model.ts';

const HUES = {
  green: 150,
  blue: 245,
  violet: 295,
  amber: 85,
  pink: 345,
  teal: 190,
  orange: 55,
  red: 25,
} satisfies Record<(typeof SPACE_COLOR_NAMES)[number], number>;

/** The profile's colour; profiles saved before colours existed get a stable one from their id. */
export function spaceColor(space: Pick<Space, 'id' | 'color'>): SpaceColor {
  return (
    space.color ??
    SPACE_COLOR_NAMES[idSeed(space.id) % SPACE_COLOR_NAMES.length]
  );
}

export function isSpaceColor(value: unknown): value is SpaceColor {
  return (
    value === 'none' ||
    (SPACE_COLOR_NAMES as readonly unknown[]).includes(value)
  );
}

/** A CSS colour for a named space colour, or undefined for `none`. */
export function spaceColorCss(color: SpaceColor, alpha = 1) {
  if (color === 'none') return undefined;
  return `oklch(0.7 0.16 ${HUES[color]} / ${alpha})`;
}

/** FNV-1a over the id: the same profile always gets the same default colour and halo edge. */
export function idSeed(id: string) {
  let hash = 0x811c9dc5;
  for (const char of id)
    hash = Math.imul(hash ^ char.charCodeAt(0), 0x01000193);
  return hash >>> 0;
}
