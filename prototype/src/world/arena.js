import * as THREE from 'three';
import { Rng } from '../core/rng.js';
import { part, merge } from './models.js';
import { patchLit } from './shaders/lit.js';
import { createFlames, createGlow } from './shaders/glow.js';
import { ARENA } from './spots.js';

// Aqrabu's arena: a ring of broken pillars and leaning standing stones around his camp,
// swept with drifts of sand, two braziers at the western approach and a few venom-green
// war banners. Three draw calls (stone, flames, halos) and a handful of pooled-light
// emitters; the colliders leave wide gaps (at least 4 m) so the fight never pins the hero.
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (rt, rb, h, s = 8) => new THREE.CylinderGeometry(rt, rb, h, s);
const SAND = [0xcdb487, 0xb99d6e, 0xdcc79c, 0xa98c5e];
const DRIFT = [0xd9bf88, 0xc9a96d, 0xe0c997];
const BRONZE = 0x9a6a2a, CLOTH = 0x5f8a2e, DARK = 0x2a1c12;

export const ARENA_RING = 10.5;

// Ring slots. Two wide entrances (west toward the road, north toward the gate) stay open.
function ringSlots(rng) {
  const N = 12, slots = [];
  const gaps = [Math.PI, -2.43, 0.4];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2 + 0.13;
    const nearGap = gaps.some((c) => Math.abs(Math.atan2(Math.sin(a - c), Math.cos(a - c))) < 0.34);
    if (nearGap) continue;
    slots.push({ a: a + rng.float(-0.05, 0.05), r: ARENA_RING + rng.float(-0.5, 0.8), kind: rng.weighted([['pillar', 4], ['stub', 3], ['stone', 3]]) });
  }
  return slots;
}

export function buildAqrabuArena(g) {
  const { scene, world } = g;
  const colliders = world.colliders, heightAt = world.heightAt;
  const rng = new Rng(160030);
  const stone = [];
  const ground = (x, z) => heightAt(x, z);
  const S = (geo, ci, o) => stone.push(part(geo, SAND[ci % SAND.length], o));
  const drift = (x, z, w, d, rot, ci = 0) => stone.push(part(new THREE.IcosahedronGeometry(1, 1), DRIFT[ci % DRIFT.length], { x, y: ground(x, z) - 0.05, z, sx: w, sy: 0.3 + rng.float(0, 0.2), sz: d, ry: rot }));
  const slots = ringSlots(rng);

  for (const s of slots) {
    const x = ARENA.x + Math.cos(s.a) * s.r, z = ARENA.z + Math.sin(s.a) * s.r, y = ground(x, z);
    const tilt = rng.float(-0.06, 0.06);
    if (s.kind === 'pillar') {
      // A column snapped off at the shoulder, base plinth and a sheared drum beside it.
      const h = rng.float(3.2, 5.0);
      S(box(2.1, 0.45, 2.1), 3, { x, y: y + 0.1, z, ry: s.a });
      S(cyl(0.72, 0.86, h, 8), rng.int(0, 2), { x, y: y + 0.3 + h / 2, z, rz: tilt, rx: tilt * 0.7 });
      S(cyl(0.9, 0.9, 0.16, 8), 1, { x, y: y + 0.55, z });
      S(box(1.0, 0.6, 0.9), 2, { x: x + 0.12, y: y + 0.3 + h + 0.12, z, rz: 0.4, ry: s.a, rx: 0.2 });
      S(cyl(0.7, 0.7, 0.9, 8), 0, { x: x - Math.cos(s.a) * 1.7, y: y + 0.35, z: z - Math.sin(s.a) * 1.7 - 0.4, rz: Math.PI / 2 - 0.2, ry: rng.float(0, 3) });
      colliders.addCircle(x, z, 0.98);
    } else if (s.kind === 'stub') {
      const h = rng.float(1.1, 2.0);
      S(box(2.0, 0.4, 2.0), 3, { x, y: y + 0.05, z, ry: s.a });
      S(cyl(0.7, 0.85, h, 7), rng.int(0, 3), { x, y: y + 0.25 + h / 2, z, rz: tilt });
      S(new THREE.DodecahedronGeometry(0.6, 0), 1, { x: x + rng.float(-1.4, 1.4), y: y + 0.25, z: z + rng.float(1.2, 2.0), sy: 0.6 });
      S(new THREE.DodecahedronGeometry(0.4, 0), 2, { x: x + rng.float(-1.6, -0.8), y: y + 0.2, z: z - rng.float(1, 1.8), sy: 0.6 });
      colliders.addCircle(x, z, 0.95);
    } else {
      // A leaning standing stone, tapered, with a carved band.
      const h = rng.float(3.0, 4.2);
      S(cyl(0.38, 0.7, h, 4), rng.int(0, 3), { x, y: y + h / 2 - 0.1, z, ry: Math.PI / 4 + s.a, rz: rng.float(-0.12, 0.12), rx: rng.float(-0.1, 0.1) });
      stone.push(part(box(0.9, 0.12, 0.9), 0x7a5a2a, { x, y: y + h * 0.55, z, ry: Math.PI / 4 + s.a }));
      stone.push(part(box(0.5, 0.16, 0.5), BRONZE, { x, y: y + h * 0.75, z, ry: Math.PI / 4 + s.a }));
      colliders.addCircle(x, z, 0.75);
    }
    // Wind-blown sand piled on the lee side (east) and creeping up the base.
    drift(x + 1.5, z + 0.3, rng.float(2.4, 3.6), rng.float(1.1, 1.7), rng.float(-0.3, 0.3), rng.int(0, 2));
    if (rng.chance(0.6)) drift(x - 0.4, z + 1.4, rng.float(1.2, 1.9), rng.float(0.7, 1.1), rng.float(0, 3), rng.int(0, 2));
  }

  // Loose rubble and long ripples inside the ring.
  for (let i = 0; i < 9; i++) {
    const a = rng.float(0, Math.PI * 2), r = rng.float(2, ARENA_RING - 2.5);
    const x = ARENA.x + Math.cos(a) * r, z = ARENA.z + Math.sin(a) * r;
    if (i < 4) S(new THREE.DodecahedronGeometry(rng.float(0.25, 0.5), 0), rng.int(0, 3), { x, y: ground(x, z) + 0.12, z, sy: 0.6, ry: a });
    else drift(x, z, rng.float(2.2, 3.8), rng.float(0.5, 0.9), rng.float(-0.4, 0.4), rng.int(0, 2));
  }

  // War banners on stakes inside the ring (venom-green cloth), and a skull cairn.
  const stakes = [[-4.2, -3.4], [4.5, -2.6], [0.5, 5.2]];
  for (const [dx, dz] of stakes) {
    const x = ARENA.x + dx, z = ARENA.z + dz, y = ground(x, z);
    stone.push(part(cyl(0.06, 0.09, 3.4, 5), DARK, { x, y: y + 1.6, z }));
    stone.push(part(box(0.95, 0.7, 0.04), CLOTH, { x: x + 0.5, y: y + 2.85, z, rz: -0.08 }));
    stone.push(part(new THREE.ConeGeometry(0.07, 0.3, 4), BRONZE, { x, y: y + 3.4, z }));
    colliders.addCircle(x, z, 0.2);
  }
  {
    const x = ARENA.x - 2.2, z = ARENA.z + 3.6, y = ground(x, z);
    for (let k = 0; k < 7; k++) stone.push(part(new THREE.SphereGeometry(0.2, 6, 5), 0xe8dcc0, { x: x + rng.float(-0.6, 0.6), y: y + 0.18 + (k > 4 ? 0.28 : 0), z: z + rng.float(-0.6, 0.6), sy: 0.85 }));
  }

  const mat = patchLit(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }));
  const mesh = new THREE.Mesh(merge(stone), mat);
  mesh.castShadow = true; mesh.receiveShadow = true;
  scene.add(mesh);

  // Two braziers flank the western approach. Their lights are pooled emitters (lit from dusk).
  const flames = [], halos = [], emitters = [];
  const braz = [[ARENA_RING + 0.5, Math.PI - 0.42], [ARENA_RING + 0.5, Math.PI + 0.42]];
  const bricks = [];
  for (const [r, a] of braz) {
    const x = ARENA.x + Math.cos(a) * r, z = ARENA.z + Math.sin(a) * r, y = ground(x, z);
    bricks.push(part(cyl(0.07, 0.13, 1.25, 5), DARK, { x: x + 0.28, y: y + 0.6, z, rz: 0.12 }));
    bricks.push(part(cyl(0.07, 0.13, 1.25, 5), DARK, { x: x - 0.14, y: y + 0.6, z: z + 0.24, rx: -0.12 }));
    bricks.push(part(cyl(0.07, 0.13, 1.25, 5), DARK, { x: x - 0.14, y: y + 0.6, z: z - 0.24, rx: 0.12 }));
    bricks.push(part(cyl(0.52, 0.3, 0.34, 8), BRONZE, { x, y: y + 1.3, z }));
    bricks.push(part(cyl(0.44, 0.44, 0.05, 8), 0x1a1008, { x, y: y + 1.46, z }));
    colliders.addCircle(x, z, 0.5);
    flames.push({ x, y: y + 1.46, z, s: 1.7 });
    halos.push({ x, y: y + 2.2, z, color: 0xff9440, size: 6, flicker: 0.25 });
    emitters.push(world.lights.add({ x, y: y + 2.3, z, color: 0xff8a30, intensity: 9, range: 14, decay: 1.6, flicker: 0.6, night: 0.5 }));
  }
  const bm = new THREE.Mesh(merge(bricks), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.3 }));
  bm.castShadow = true;
  scene.add(bm);
  scene.add(createFlames(flames));
  scene.add(createGlow(halos, { opacity: 0.5 }));
  return { mesh, emitters, slots };
}
