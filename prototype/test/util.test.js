import { test } from 'node:test';
import assert from 'node:assert/strict';
import { radialDeadzone, angleDelta, distPointSegment, clampLength, inCone } from '../src/util.js';

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('radialDeadzone ignores drift and rescales', () => {
  assert.deepEqual(radialDeadzone(0.1, 0.1, 0.2), { x: 0, y: 0, mag: 0 });
  const full = radialDeadzone(1, 0, 0.2);
  near(full.x, 1);
  near(full.mag, 1);
  const half = radialDeadzone(0, 0.6, 0.2);
  near(half.y, 0.5);
});

test('angleDelta wraps around', () => {
  near(angleDelta(0, Math.PI / 2), Math.PI / 2);
  near(angleDelta(Math.PI - 0.1, -Math.PI + 0.1), 0.2);
  near(angleDelta(-Math.PI + 0.1, Math.PI - 0.1), -0.2);
});

test('distPointSegment', () => {
  const mid = distPointSegment(0, 1, -1, 0, 1, 0);
  near(mid.dist, 1);
  near(mid.t, 0.5);
  const beyond = distPointSegment(3, 0, -1, 0, 1, 0);
  near(beyond.dist, 2);
  near(beyond.t, 1);
  const degenerate = distPointSegment(0, 2, 0, 0, 0, 0);
  near(degenerate.dist, 2);
});

test('clampLength', () => {
  const c = clampLength(3, 4, 2.5);
  near(Math.hypot(c.x, c.z), 2.5);
  assert.deepEqual(clampLength(1, 0, 2), { x: 1, z: 0 });
});

test('inCone uses atan2(x, z) facing convention', () => {
  assert.ok(inCone(0, 0, 0, 0, 5, 0.1)); // facing +Z
  assert.ok(inCone(0, 0, Math.PI / 2, 5, 0, 0.1)); // facing +X
  assert.ok(!inCone(0, 0, 0, 0, -5, 1)); // behind
});
