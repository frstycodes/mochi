import assert from 'node:assert/strict';
import { test } from 'node:test';
import { blendPose, BODY_HEIGHT, EYE_R, GROUND, oneHot, PHASES, propShapes, stepWeights, VIEW } from './agentShape.ts';

test('every pose keeps mochi on the canvas with its eye inside the dome, props keep a fixed shape count, and each phase moves differently', () => {
  const traces = PHASES.map(() => [] as number[]);
  const counts = PHASES.map((p) => propShapes(p, 0, blendPose(oneHot(p), 0)).length);
  for (const t of Array.from({ length: 140 }, (_, i) => i * 0.05)) {
    PHASES.forEach((p, k) => {
      const pose = blendPose(oneHot(p), t);
      const top = GROUND[1] + pose.dy - BODY_HEIGHT * pose.sy;
      // The dome is widest near its base, where lean barely shifts it.
      const halfWidth = 6.5 * pose.sx + Math.abs(pose.lean) * 1.62;
      assert.ok(top >= 0 && GROUND[1] + pose.dy <= VIEW, `${p} body height at ${t}s`);
      assert.ok(GROUND[0] + pose.dx - halfWidth >= 0 && GROUND[0] + pose.dx + halfWidth <= VIEW, `${p} body width at ${t}s`);
      // The dome's half-width at the eye's height, from its arc: x² + (y + 1.62)²·(6.5/8.13)² ≤ 6.5².
      const r = EYE_R * pose.eyeS;
      const inside = (Math.abs(pose.eyeX) + r) ** 2 + ((pose.eyeY - r + 1.62) * (6.5 / 8.13)) ** 2 <= 6.5 ** 2;
      assert.ok(inside && pose.eyeY + r < -0.5, `${p} eye at ${t}s`);
      const shapes = propShapes(p, t, pose);
      assert.equal(shapes.length, counts[k], `${p} shape count at ${t}s`);
      for (const s of shapes) {
        assert.ok(s.o >= -1e-6 && s.o <= 1 + 1e-6, `${p} opacity at ${t}s`);
        assert.ok(!/NaN|Infinity/.test(s.d), `${p} path at ${t}s`);
        // Absolute commands only; relative ones (lowercase) hold offsets.
        for (const [, cmd, args] of s.d.matchAll(/([A-Za-z])([^A-Za-z]*)/g)) {
          if (cmd !== cmd.toUpperCase()) continue;
          for (const n of args.match(/-?\d+(\.\d+)?/g) ?? []) assert.ok(Number(n) > -1 && Number(n) < VIEW + 1, `${p} shape off canvas at ${t}s: ${s.d}`);
        }
      }
      traces[k].push(pose.dy, pose.sy, pose.eyeX, pose.eyeY, pose.blink);
    });
  }
  traces.forEach((a, i) => traces.slice(i + 1).forEach((b, j) => assert.ok(a.some((v, k) => Math.abs(v - b[k]) > 0.3), `${PHASES[i]} vs ${PHASES[i + j + 1]}`)));

  const weights = oneHot('think');
  const velocities = new Float32Array(weights.length);
  for (let f = 0; f < 10; f++) stepWeights(weights, velocities, 'run', 1 / 60);
  const midway = Array.from(weights);
  for (let f = 0; f < 120; f++) stepWeights(weights, velocities, 'wait', 1 / 60);
  assert.ok(midway[PHASES.indexOf('run')] > 0.1, 'interrupted morph got partway');
  assert.ok(Math.abs(weights.reduce((s, w) => s + w, 0) - 1) < 1e-5, 'weights sum to 1');
  assert.ok(weights[PHASES.indexOf('wait')] > 0.99, 'settles on the last phase');
});
