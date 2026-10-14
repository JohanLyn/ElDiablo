import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SlowMo, SLOWMO_MAX, SLOWMO_MIN_SCALE } from '../src/core/slowmo.js';

test('slow-mo eases in, holds the target scale, eases out and always expires', () => {
  const s = new SlowMo();
  assert.equal(s.update(1 / 60), 1);
  s.request(0.25, 0.5);
  let min = 1, steps = 0;
  const seen = [];
  while (s.left > 0 && steps++ < 1000) { const v = s.update(1 / 60); seen.push(v); min = Math.min(min, v); }
  assert.ok(Math.abs(min - 0.25) < 1e-9, 'reaches the requested scale');
  assert.ok(seen[0] > 0.25, 'starts easing in rather than snapping');
  assert.ok(seen.every((v) => v >= 0.25 && v <= 1), 'stays within bounds');
  assert.equal(s.update(1 / 60), 1, 'back to normal speed');
  assert.ok(steps <= 0.5 * 60 + 2, 'lasts about the requested real time');
});

test('slow-mo requests are clamped and never stack into a long freeze', () => {
  const s = new SlowMo();
  s.request(0, 10);
  assert.equal(s.target, SLOWMO_MIN_SCALE);
  assert.ok(s.left <= SLOWMO_MAX);
  // A weaker, shorter request during a running one is ignored; a stronger one wins.
  s.update(0.1);
  const before = s.target;
  s.request(0.9, 0.1);
  assert.equal(s.target, before);
  s.request(0.1, 0.1);
  assert.equal(s.target, SLOWMO_MIN_SCALE);
  let total = 0, t = 0;
  for (let i = 0; i < 5; i++) { s.request(0.3, 0.5); total += 0.5; }
  while (s.left > 0 && t < 5) { s.update(1 / 30); t += 1 / 30; }
  assert.ok(t <= SLOWMO_MAX + 0.1, `expired within the cap (${t.toFixed(2)} s of ${total} requested)`);
});

test('game time under slow-mo stays close to real time over a long fight', () => {
  // Elite kills slow time to 0.35 for 0.25 s, guardians to 0.22 for 0.5 s. Even with an elite kill every 30 s the game-time deficit stays under half a percent.
  const s = new SlowMo();
  let game = 0, real = 0;
  for (let k = 0; k < 40; k++) {
    s.request(k % 20 === 19 ? 0.22 : 0.35, k % 20 === 19 ? 0.5 : 0.25);
    for (let i = 0; i < 30 * 60; i++) { const dt = 1 / 60; game += dt * s.update(dt); real += dt; }
  }
  assert.ok(game / real > 0.995, `game/real = ${(game / real).toFixed(4)}`);
});
