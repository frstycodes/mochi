/** sRGB channels 0–1 plus alpha. VS Code themes write colors as `#rgb`, `#rgba`, `#rrggbb` or `#rrggbbaa`. */
export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

export function parseHex(value: unknown): Rgba | null {
  if (typeof value !== 'string') return null;
  const hex = value.trim().replace(/^#/, '');
  if (!/^([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(hex)) return null;
  const full = hex.length <= 4 ? hex.replace(/./g, '$&$&') : hex;
  const channel = (i: number) =>
    parseInt(full.slice(i * 2, i * 2 + 2), 16) / 255;
  return {
    r: channel(0),
    g: channel(1),
    b: channel(2),
    a: full.length === 8 ? channel(3) : 1,
  };
}

export function toHex({ r, g, b, a }: Rgba) {
  const byte = (v: number) =>
    Math.round(Math.min(1, Math.max(0, v)) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${byte(r)}${byte(g)}${byte(b)}${a < 1 ? byte(a) : ''}`;
}

/** `top` painted over an opaque `bottom`. */
export function over(top: Rgba, bottom: Rgba): Rgba {
  const mix = (t: number, b: number) => t * top.a + b * (1 - top.a);
  return {
    r: mix(top.r, bottom.r),
    g: mix(top.g, bottom.g),
    b: mix(top.b, bottom.b),
    a: 1,
  };
}

/** `amount` of `b` into `a`, per channel; alpha kept from `a`. */
export function mix(a: Rgba, b: Rgba, amount: number): Rgba {
  const at = (x: number, y: number) => x + (y - x) * amount;
  return { r: at(a.r, b.r), g: at(a.g, b.g), b: at(a.b, b.b), a: a.a };
}

export const withAlpha = (c: Rgba, a: number): Rgba => ({ ...c, a });

const linear = (v: number) =>
  v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
const gamma = (v: number) =>
  v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;

/** WCAG 2 relative luminance of an opaque color. */
export function luminance({ r, g, b }: Rgba) {
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

export function contrast(a: Rgba, b: Rgba) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** OKLab lightness 0–1, the axis `nudge` moves along. */
export function lightness(c: Rgba) {
  return toOklch(c).l;
}

interface Oklch {
  l: number;
  c: number;
  h: number;
}

function toOklch({ r, g, b }: Rgba): Oklch {
  const [lr, lg, lb] = [linear(r), linear(g), linear(b)];
  const l = Math.cbrt(
    0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb,
  );
  const m = Math.cbrt(
    0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb,
  );
  const s = Math.cbrt(
    0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb,
  );
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { l: L, c: Math.hypot(A, B), h: Math.atan2(B, A) };
}

// ponytail: out-of-gamut channels are clamped, not chroma-mapped; nudged text colors sit near the gamut edge only at extreme L.
function fromOklch({ l: L, c, h }: Oklch, a: number): Rgba {
  const A = c * Math.cos(h);
  const B = c * Math.sin(h);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  const clamp = (v: number) => Math.min(1, Math.max(0, gamma(v)));
  return {
    r: clamp(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: clamp(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: clamp(-0.0041960863 * l - 0.7034186105 * m + 1.707614701 * s),
    a,
  };
}

/** The color with its OKLab lightness set to `l`, hue and chroma kept. */
export function withLightness(color: Rgba, l: number): Rgba {
  return fromOklch(
    { ...toOklch(color), l: Math.min(1, Math.max(0, l)) },
    color.a,
  );
}

export const AA = 4.5;

/**
 * Moves `text` away from every surface's lightness in 0.01 steps until it reads at `ratio` against all of them. Text that
 * already passes comes back unchanged. Surfaces are opaque; translucent text is judged painted over each one.
 */
export function nudge(text: Rgba, surfaces: Rgba[], ratio = AA): Rgba {
  const worst = (c: Rgba) =>
    Math.min(...surfaces.map((s) => contrast(c.a < 1 ? over(c, s) : c, s)));
  if (worst(text) >= ratio) return text;
  const meanSurface =
    surfaces.reduce((sum, s) => sum + luminance(s), 0) / surfaces.length;
  // Text goes lighter on dark surfaces, darker on light ones: toward whichever end has more room.
  const direction = meanSurface < 0.18 ? 1 : -1;
  const solid = { ...text, a: 1 };
  let { l } = toOklch(solid);
  let best = solid;
  for (let i = 0; i < 100 && worst(best) < ratio; i++) {
    l += direction * 0.01;
    if (l < 0 || l > 1) break;
    best = withLightness(solid, l);
  }
  return best;
}
