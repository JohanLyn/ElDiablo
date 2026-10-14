import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Colliders } from '../src/world/colliders.js';
import { createEnv } from '../src/world/shaders/common.js';
import { scatterProps } from '../src/world/props.js';
import { buildLandmarks } from '../src/world/landmarks.js';
import { AQRABU, CISTERN_ENTRANCE, WAYPOINTS, PYRES, PYRE_SPOTS } from '../src/world/layout.js';
import { nearCorridor, ARENA } from '../src/world/spots.js';
import { buildAqrabuArena } from '../src/world/arena.js';
import { heightAt } from '../src/world/terrain.js';

// The world builds in plain node (no WebGL needed for geometry), with a stub canvas for the map painters.
globalThis.document ??= { createElement: () => ({ getContext: () => ({}) }) };
createEnv();
const scene = new THREE.Scene();
const colliders = new Colliders();
buildLandmarks(scene, colliders);
scatterProps(scene, colliders);

// Walk a straight line with a hero-sized circle and report every place the colliders push back.
function contacts(a, b, radius = 0.5) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const hits = [];
  for (let d = 0; d <= len; d += 0.25) {
    const p = { x: a[0] + ((b[0] - a[0]) * d) / len, y: 0, z: a[1] + ((b[1] - a[1]) * d) / len };
    const q = { ...p };
    colliders.resolve(q, radius, false);
    if (Math.hypot(q.x - p.x, q.z - p.z) > 0.01) hits.push([Math.round(p.x), Math.round(p.z)]);
  }
  return hits;
}
const wp = (id) => { const w = WAYPOINTS.find((x) => x.id === id); return [w.x, w.z]; };
const AQ = [AQRABU.x, AQRABU.z];

test('quest legs to and from Aqrabu are free of props', () => {
  const legs = {
    'cistern -> aqrabu': [[CISTERN_ENTRANCE.x, CISTERN_ENTRANCE.z + 5], AQ],
    'crossroads -> aqrabu': [wp('wp-sunfields'), AQ],
    'ruins waypoint -> aqrabu': [wp('wp-ruins'), AQ],
    'aqrabu -> ashen waypoint': [AQ, wp('wp-ashen')],
    'ashen waypoint -> ganzir entrance': [wp('wp-ashen'), [0, -168]],
    'aqrabu -> ganzir entrance (straight)': [AQ, [0, -168]],
    'ashen waypoint -> pyres': [wp('wp-ashen'), [PYRES.x, PYRES.z]],
  };
  for (const [name, [a, b]] of Object.entries(legs)) assert.deepEqual(contacts(a, b), [], `${name} is blocked`);
});

const lights = { add: (o) => o };
const arena = buildAqrabuArena({ scene, world: { colliders, heightAt, lights } });

test('keep-clear corridors reject colliding props and the arena ring leaves wide gaps', () => {
  assert.ok(nearCorridor((CISTERN_ENTRANCE.x + AQRABU.x) / 2, (CISTERN_ENTRANCE.z + AQRABU.z) / 2 + 0.2, 0.5));
  assert.ok(!nearCorridor(0, 150, 0.5));
  // Walk a ring just inside the pillars: gaps between colliders must fit hero + boss (>= 4 m wide).
  const R = 10.9, steps = 720, blocked = [];
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const p = { x: ARENA.x + Math.cos(a) * R, y: 0, z: ARENA.z + Math.sin(a) * R }, q = { ...p };
    colliders.resolve(q, 1.0, false); // a 2 m wide body
    blocked.push(Math.hypot(q.x - p.x, q.z - p.z) > 0.01);
  }
  assert.ok(blocked.filter((b) => !b).length > steps * 0.4, 'at least 40% of the ring is open to a wide body');
  assert.ok(blocked.some((b) => b), 'the ring does have pillars');
});

test('the Wailing Pyres plateau and the arena camp are clear of scattered props', () => {
  const free = (cx, cz, r) => {
    let n = 0;
    for (let a = 0; a < Math.PI * 2; a += 0.2) for (let d = 0; d <= r; d += 1) {
      const p = { x: cx + Math.cos(a) * d, y: 0, z: cz + Math.sin(a) * d }, q = { ...p };
      colliders.resolve(q, 0.5, false);
      if (Math.hypot(q.x - p.x, q.z - p.z) > 0.01) n++;
    }
    return n;
  };
  assert.equal(free(PYRES.x, PYRES.z, PYRES.r + 3), 0);
  assert.ok(free(ARENA.x, ARENA.z, 8) <= 12, 'the inside of the ring holds only the banner stakes');
  assert.ok(PYRE_SPOTS.length === 3 && arena.emitters.length === 2);
});
