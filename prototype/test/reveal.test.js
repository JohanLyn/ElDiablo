import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Reveal } from '../src/game/reveal.js';

// A minimal stand-in for the game context: just what Reveal touches.
function fakeGame(region = 'sunfields') {
  const g = {
    flags: { introDone: true },
    started: true, simDriven: false, revealing: false, combatNearby: false, suppressInput: false,
    ui: { open: false },
    player: { dead: false, pos: new THREE.Vector3(10, 0, 10) },
    enemies: { list: [] },
    scene: { fog: { near: 20, far: 90 } },
    world: { regionAt: () => g.region },
    rig: { cinematic: null, target: new THREE.Vector3(10, 0, 10), distance: 28, setCinematic(fn) { this.cinematic = fn; } },
    input: { move: { mag: 0 }, pressed: {}, down: {} },
    events: { emit() {} },
    region,
  };
  return g;
}

test('region reveal: first visit plays once, never near combat, any fresh input skips', () => {
  const g = fakeGame('sunfields');
  const r = new Reveal(g);
  r.update(0.05); // seeds the starting region as seen
  assert.equal(g.flags.reveal.sunfields, 1);
  assert.equal(r.active, false);

  g.region = 'ruins';
  r.update(0.05); // region changed
  g.enemies.list.push({ alive: true, aggro: true, pos: new THREE.Vector3(14, 0, 12) });
  for (let i = 0; i < 10; i++) r.update(0.05);
  assert.equal(r.active, false, 'aggroed enemy nearby blocks the reveal');

  g.enemies.list.length = 0;
  r.update(0.05);
  assert.equal(r.active, true);
  assert.equal(g.revealing, true);
  assert.ok(g.rig.cinematic, 'camera is taken over');
  const shot = g.rig.cinematic(0.5);
  assert.ok(Number.isFinite(shot.pos.x) && Number.isFinite(shot.look.z));

  // A key held when it began is ignored until released; the next press skips.
  g.input.down.moveUp = true;
  r.update(0.05);
  assert.equal(r.active, true);
  g.input.down = {};
  r.update(0.05);
  g.input.pressed.skill1 = true;
  r.update(0.05);
  assert.equal(r.active, false);
  assert.equal(g.revealing, false);
  assert.equal(g.rig.cinematic, null);
  assert.equal(g.suppressInput, true);
  assert.equal(g.flags.reveal.ruins, 1);

  // Leaving and coming back never replays it.
  g.region = 'sunfields'; r.update(0.05);
  g.region = 'ruins'; r.update(0.05);
  for (let i = 0; i < 20; i++) r.update(0.05);
  assert.equal(r.active, false);
});

test('region reveal ends on its own and restores the camera', () => {
  const g = fakeGame('sunfields');
  const r = new Reveal(g);
  r.update(0.05);
  g.region = 'ashen';
  r.update(0.05);
  r.update(0.2);
  assert.equal(r.active, true);
  for (let i = 0; i < 80; i++) r.update(0.05);
  assert.equal(r.active, false);
  assert.equal(g.rig.cinematic, null);
  assert.equal(g.revealing, false);
});
