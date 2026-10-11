import assert from 'node:assert/strict';
import { test } from 'node:test';
import { blendDots, DOTS, oneHot, PHASES, stepWeights } from './agentShape.ts';

test('every agent form keeps its dots inside the glyph, inks within range, and differs from the others', () => {
  for (const t of Array.from({ length: 80 }, (_, i) => i * 0.05)) {
    const forms = PHASES.map((p) => blendDots(oneHot(p), t));
    for (const [k, dots] of forms.entries()) {
      for (let i = 0; i < DOTS; i++) {
        const [x, y, r, ink] = dots.slice(i * 4, i * 4 + 4);
        assert.ok(r >= 0 && Math.max(Math.abs(x), Math.abs(y)) + r <= 8, `${PHASES[k]} dot ${i} at ${t}s`);
        assert.ok(ink >= 0 && ink <= 1.0001, `${PHASES[k]} ink ${i} at ${t}s`);
      }
    }
    forms.forEach((a, i) => forms.slice(i + 1).forEach((b) => assert.ok(a.some((v, k) => Math.abs(v - b[k]) > 0.5))));
  }

  const weights = oneHot('think');
  const velocities = new Float32Array(weights.length);
  for (let f = 0; f < 10; f++) stepWeights(weights, velocities, 'run', 1 / 60);
  const midway = Array.from(weights);
  for (let f = 0; f < 120; f++) stepWeights(weights, velocities, 'wait', 1 / 60);
  assert.ok(midway[PHASES.indexOf('run')] > 0.1, 'interrupted morph got partway');
  assert.ok(Math.abs(weights.reduce((s, w) => s + w, 0) - 1) < 1e-5, 'weights sum to 1');
  assert.ok(weights[PHASES.indexOf('wait')] > 0.99, 'settles on the last phase');
});
