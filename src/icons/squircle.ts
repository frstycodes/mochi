/**
 * A rectangle with continuous-curvature corners: each corner is one cubic that starts 1.9 × `r` from it with its handles
 * close in, so the curve eases into the straight edge instead of meeting it with a circular arc's jump.
 */
export function squircle(x: number, y: number, w: number, h: number, r: number) {
  const k = Math.min(r * 1.9, w / 2, h / 2);
  const c = k * 0.08;
  const [right, bottom] = [x + w, y + h];
  const n = (value: number) => +value.toFixed(2);
  return [
    `M${n(x + k)} ${n(y)}H${n(right - k)}C${n(right - c)} ${n(y)} ${n(right)} ${n(y + c)} ${n(right)} ${n(y + k)}`,
    `V${n(bottom - k)}C${n(right)} ${n(bottom - c)} ${n(right - c)} ${n(bottom)} ${n(right - k)} ${n(bottom)}`,
    `H${n(x + k)}C${n(x + c)} ${n(bottom)} ${n(x)} ${n(bottom - c)} ${n(x)} ${n(bottom - k)}`,
    `V${n(y + k)}C${n(x)} ${n(y + c)} ${n(x + c)} ${n(y)} ${n(x + k)} ${n(y)}Z`,
  ].join('');
}
