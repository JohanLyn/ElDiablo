import * as THREE from 'three';
import { Builder, shapes, part, rigMaterial } from './mesh.js';
import { addOcclusionOutline } from '../../fx/silhouette.js';
import { Rig, Animator, MODE, humanoid, to, add, mix, smooth, easeOut, easeIn, clamp01, range } from '../rig.js';

// The Gatewalker: lapis robes over bronze scale, gold pauldrons, horned crown helm,
// spring-driven cape, weapon that matches the equipped base and glows by rarity.

const LAPIS = 0x2c50b8, LAPIS_D = 0x1a2f78, GOLD = 0xe6b844, BRONZE = 0xb98242, BRONZE_D = 0x7c5230;
const SKIN = 0xc98f62, LEATHER = 0x3a2a1e, DARK = 0x0f0b09;
const TAU = Math.PI * 2;

const COMBO_TIME = [0.32, 0.32, 0.46];
const COMBO_HIT = [0.4, 0.4, 0.45];
export const RARITY_GLOW = { common: 0x000000, magic: 0x4f86ff, rare: 0xffd23a, legendary: 0xff7f1a };

let _def = null;
function heroDef() {
  if (_def) return _def;
  const b = new Builder();
  const m = { metal: 0.7, rough: 0.38 };
  // ---- hips / skirt / tabard
  b.box('hips', 0.42, 0.2, 0.27, BRONZE_D, { ...m, y: 0.02 });
  b.cyl('hips', 0.27, 0.27, 0.1, 8, GOLD, { y: 0.1, metal: 0.85, rough: 0.3 });
  b.box('hips', 0.1, 0.1, 0.04, GOLD, { y: 0.1, z: 0.26, metal: 0.9, rough: 0.25, glow: 0.25 });
  b.add('hips', shapes.limb(0.26, 0.4, 0.58, 8), LAPIS, { y: 0.02, shade: [-0.56, 0.02, 0.8, 1.0], rough: 0.8 });
  b.cyl('hips', 0.4, 0.405, 0.06, 8, GOLD, { y: -0.52, metal: 0.8, rough: 0.35 });
  b.add('tabF', shapes.box(0.24, 0.62, 0.04).translate(0, -0.31, 0), LAPIS_D, { rough: 0.8 });
  b.box('tabF', 0.06, 0.56, 0.05, GOLD, { y: -0.31, z: 0.005, metal: 0.8, rough: 0.35, glow: 0.12 });
  b.add('tabF', shapes.fin(0.24, -0.12, 0.05), GOLD, { y: -0.62, metal: 0.8, rough: 0.35 });
  for (const s of [-1, 1]) {
    const n = s > 0 ? 'tasL' : 'tasR';
    b.add(n, shapes.limb(0.028, 0.012, 0.3, 4), GOLD, { metal: 0.8, rough: 0.4 });
    b.sphere(n, 0.045, 5, 4, GOLD, { y: 0.0, metal: 0.8, rough: 0.35 });
    b.add(n, shapes.limb(0.05, 0.02, 0.14, 4), LAPIS, { y: -0.2 });
  }
  // ---- spine / chest
  b.box('spine', 0.36, 0.2, 0.24, BRONZE, { y: 0.06, ...m });
  b.add('chest', shapes.cyl(0.27, 0.2, 0.52, 7), BRONZE, { y: 0.26, sx: 1.12, sz: 0.76, ...m });
  b.box('chest', 0.27, 0.46, 0.04, LAPIS, { y: 0.26, z: 0.2, rough: 0.8 });
  b.box('chest', 0.05, 0.42, 0.05, GOLD, { y: 0.26, z: 0.205, metal: 0.8, rough: 0.35, glow: 0.12 });
  for (let i = 0; i < 3; i++) b.box('chest', 0.5 - i * 0.03, 0.045, 0.3, BRONZE_D, { y: 0.08 + i * 0.1, ...m, ao: 0.2 });
  b.cyl('chest', 0.19, 0.26, 0.1, 8, GOLD, { y: 0.5, sz: 0.8, metal: 0.85, rough: 0.3 });
  b.box('chest', 0.34, 0.5, 0.06, BRONZE_D, { y: 0.26, z: -0.17, ...m });
  b.add('neck', shapes.cyl(0.07, 0.08, 0.12, 6), SKIN, { y: 0.0, rough: 0.7 });
  // ---- head / helm
  b.add('head', shapes.sphere(0.14, 7, 5), SKIN, { y: 0.06, sy: 1.08, rough: 0.7 });
  b.box('head', 0.2, 0.07, 0.06, DARK, { y: 0.045, z: 0.125, ao: 0 });
  for (const s of [-1, 1]) b.box('head', 0.045, 0.022, 0.02, 0xbfe0ff, { x: s * 0.058, y: 0.06, z: 0.152, glow: 1.6, ao: 0, var: 0 });
  b.add('head', new THREE.SphereGeometry(0.185, 8, 5, 0, TAU, 0, Math.PI * 0.55), BRONZE, { y: 0.07, ...m });
  b.cyl('head', 0.19, 0.19, 0.045, 8, GOLD, { y: 0.1, metal: 0.85, rough: 0.3 });
  b.add('head', shapes.fin(0.05, 0.16, 0.04), GOLD, { y: 0.2, z: -0.02, rx: 0.2, metal: 0.85, rough: 0.3 });
  b.box('head', 0.03, 0.15, 0.03, GOLD, { y: 0.12, z: 0.18, metal: 0.85, rough: 0.3 });
  for (const s of [-1, 1]) {
    b.box('head', 0.035, 0.17, 0.18, BRONZE_D, { x: s * 0.158, y: 0.02, z: 0.02, ...m });
    // horn: three curved segments sweeping out then up
    b.spike('head', 0.055, 0.2, 5, 0xf0dca8, { x: s * 0.15, y: 0.2, rz: -s * 1.05, metal: 0.4, rough: 0.4 });
    b.spike('head', 0.04, 0.2, 5, 0xf0dca8, { x: s * 0.29, y: 0.31, rz: -s * 0.4, metal: 0.4, rough: 0.4 });
    b.spike('head', 0.028, 0.19, 5, 0xf8ecc4, { x: s * 0.335, y: 0.5, rz: s * 0.18, metal: 0.4, rough: 0.4 });
    b.spike('head', 0.022, 0.1, 4, GOLD, { x: s * 0.07, y: 0.22, z: 0.08, rx: 0.4, metal: 0.85, rough: 0.3 });
  }
  // ---- arms (L = +X side, shield arm; R = -X side, weapon arm)
  for (const s of [1, -1]) {
    const sh = s > 0 ? 'shL' : 'shR', el = s > 0 ? 'elL' : 'elR', hd = s > 0 ? 'hdL' : 'hdR';
    b.add(sh, new THREE.SphereGeometry(0.22, 7, 4, 0, TAU, 0, Math.PI * 0.5), GOLD, { x: s * 0.03, y: 0.04, sy: 0.85, sz: 0.95, metal: 0.85, rough: 0.28 });
    b.add(sh, new THREE.SphereGeometry(0.19, 7, 3, 0, TAU, 0, Math.PI * 0.5), BRONZE, { x: s * 0.06, y: -0.04, sy: 0.7, metal: 0.8, rough: 0.35 });
    b.spike(sh, 0.04, 0.16, 5, GOLD, { x: s * 0.1, y: 0.1, rz: -s * 0.6, metal: 0.85, rough: 0.3 });
    b.spike(sh, 0.03, 0.12, 5, GOLD, { x: s * 0.0, y: 0.15, metal: 0.85, rough: 0.3 });
    b.limb(sh, 0.085, 0.07, 0.3, 6, LAPIS, { y: -0.04, rough: 0.8 });
    b.limb(el, 0.075, 0.062, 0.27, 6, BRONZE, { ...m });
    b.cyl(el, 0.08, 0.08, 0.04, 6, GOLD, { y: -0.2, metal: 0.85, rough: 0.3 });
    b.box(hd, 0.1, 0.1, 0.1, SKIN, { y: -0.02, rough: 0.7 });
  }
  // ---- buckler on the left forearm
  b.cyl('elL', 0.27, 0.27, 0.05, 10, BRONZE, { x: 0.11, y: -0.15, z: 0.05, rz: Math.PI / 2, metal: 0.8, rough: 0.35 });
  b.cyl('elL', 0.2, 0.2, 0.06, 10, LAPIS, { x: 0.115, y: -0.15, z: 0.05, rz: Math.PI / 2, rough: 0.6 });
  b.add('elL', shapes.torus(0.265, 0.025, 4, 12), GOLD, { x: 0.13, y: -0.15, z: 0.05, ry: Math.PI / 2, metal: 0.9, rough: 0.28 });
  b.sphere('elL', 0.07, 6, 4, GOLD, { x: 0.15, y: -0.15, z: 0.05, sx: 0.7, metal: 0.9, rough: 0.28, glow: 0.2 });
  // ---- legs
  for (const s of [1, -1]) {
    const th = s > 0 ? 'thL' : 'thR', sn = s > 0 ? 'shnL' : 'shnR', ft = s > 0 ? 'ftL' : 'ftR';
    b.limb(th, 0.115, 0.09, 0.48, 6, LEATHER, { y: 0.0, rough: 0.85 });
    b.limb(sn, 0.088, 0.068, 0.46, 6, BRONZE, { ...m });
    b.sphere(sn, 0.095, 5, 4, GOLD, { y: 0.0, z: 0.05, metal: 0.85, rough: 0.3 });
    b.box(ft, 0.13, 0.08, 0.3, LEATHER, { y: -0.01, z: 0.07, rough: 0.85 });
    b.box(ft, 0.12, 0.05, 0.1, BRONZE_D, { y: 0.0, z: 0.2, ...m });
  }
  // ---- cape: three trailing panels (spring chain)
  const cw = [0.62, 0.72, 0.8];
  for (let i = 0; i < 3; i++) {
    const n = `cape${i}`;
    b.add(n, shapes.box(cw[i], 0.46, 0.04).translate(0, -0.23, 0), i === 1 ? LAPIS : LAPIS_D, { rough: 0.85, ao: 0.25 });
    if (i === 2) b.add(n, shapes.box(cw[i] + 0.02, 0.07, 0.05).translate(0, -0.45, 0), GOLD, { metal: 0.7, rough: 0.4 });
    if (i === 0) {
      for (const s of [-1, 1]) b.sphere(n, 0.05, 5, 4, GOLD, { x: s * 0.3, y: 0.0, z: 0.03, metal: 0.85, rough: 0.3 });
    }
  }
  const built = b.build();
  _def = {
    tris: built.tris,
    geos: built.geos,
    bones: [
      ['hips', null, 0, 0.98, 0], ['spine', 'hips', 0, 0.08, 0], ['chest', 'spine', 0, 0.2, 0],
      ['neck', 'chest', 0, 0.5, 0], ['head', 'neck', 0, 0.1, 0],
      ['shL', 'chest', 0.37, 0.42, 0], ['elL', 'shL', 0, -0.3, 0], ['hdL', 'elL', 0, -0.28, 0],
      ['shR', 'chest', -0.37, 0.42, 0], ['elR', 'shR', 0, -0.3, 0], ['hdR', 'elR', 0, -0.28, 0],
      ['wpn', 'hdR', 0, -0.04, 0],
      ['thL', 'hips', 0.15, -0.02, 0], ['shnL', 'thL', 0, -0.47, 0], ['ftL', 'shnL', 0, -0.45, 0],
      ['thR', 'hips', -0.15, -0.02, 0], ['shnR', 'thR', 0, -0.47, 0], ['ftR', 'shnR', 0, -0.45, 0],
      ['tabF', 'hips', 0, -0.02, 0.2], ['tasL', 'hips', 0.2, 0.0, 0.2], ['tasR', 'hips', -0.2, 0.0, 0.2],
      ['cape0', 'chest', 0, 0.44, -0.2], ['cape1', 'cape0', 0, -0.46, 0], ['cape2', 'cape1', 0, -0.46, 0],
      ['accentC', 'chest', 0, 0.26, 0.225], ['accentH', 'head', 0, 0.2, 0.0],
    ],
    orders: { shL: 'YXZ', shR: 'YXZ' },
  };
  return _def;
}

// ---- weapons --------------------------------------------------------------------
const weaponCache = new Map();
function weaponGeo(name) {
  if (weaponCache.has(name)) return weaponCache.get(name);
  const b = new Builder();
  const bl = { metal: 0.9, rough: 0.22 };
  if (name === 'Bronze Mace') {
    b.add('w', shapes.cyl(0.034, 0.04, 0.9, 6), LEATHER, { y: 0.32, rough: 0.8 });
    for (let i = 0; i < 3; i++) b.cyl('w', 0.045, 0.045, 0.04, 6, GOLD, { y: 0.0 + i * 0.12, metal: 0.85, rough: 0.3 });
    b.sphere('w', 0.055, 6, 4, GOLD, { y: -0.14, metal: 0.85, rough: 0.3 });
    b.add('w', shapes.ico(0.17, 0), BRONZE, { y: 0.85, sy: 1.15, metal: 0.8, rough: 0.3 });
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU;
      b.add('w', shapes.box(0.05, 0.3, 0.11), BRONZE_D, { x: Math.sin(a) * 0.14, y: 0.85, z: Math.cos(a) * 0.14, ry: a, metal: 0.8, rough: 0.3 });
    }
    b.spike('w', 0.05, 0.2, 6, GOLD, { y: 1.0, metal: 0.9, rough: 0.25, glow: 0.4 });
    b.add('w', shapes.torus(0.17, 0.02, 4, 8), 0xfff0b0, { y: 0.85, rx: Math.PI / 2, glow: 1.0, ao: 0 });
  } else if (name === 'Lapis-Tipped Spear') {
    b.add('w', shapes.cyl(0.03, 0.03, 2.0, 6), LEATHER, { y: 0.45, rough: 0.7 });
    b.sphere('w', 0.05, 5, 4, GOLD, { y: -0.55, metal: 0.85, rough: 0.3 });
    b.cyl('w', 0.045, 0.045, 0.14, 6, GOLD, { y: 1.38, metal: 0.85, rough: 0.3 });
    b.add('w', shapes.fin(0.2, 0.52, 0.045), LAPIS, { y: 1.44, metal: 0.55, rough: 0.3, glow: 0.35 });
    b.add('w', shapes.fin(0.045, 0.45, 0.2), LAPIS, { y: 1.44, metal: 0.55, rough: 0.3, glow: 0.35 });
    b.add('w', shapes.tatter(0.1, 0.14, 0.4), 0xb8402a, { y: 1.36, x: 0.0, double: true, rough: 0.9 });
    for (let i = 0; i < 2; i++) b.cyl('w', 0.045, 0.045, 0.03, 6, GOLD, { y: 0.1 + i * 0.5, metal: 0.8, rough: 0.35 });
  } else {
    // Sapara Sickle-Sword: khopesh with a curved blade
    b.add('w', shapes.cyl(0.032, 0.036, 0.26, 6), LEATHER, { y: 0.0, rough: 0.8 });
    b.sphere('w', 0.055, 6, 4, GOLD, { y: -0.14, metal: 0.85, rough: 0.3 });
    b.box('w', 0.15, 0.04, 0.06, GOLD, { y: 0.14, metal: 0.85, rough: 0.3 });
    let px = 0, py = 0.16, pz = 0;
    const n = 7;
    for (let i = 0; i < n; i++) {
      const phi = 0.05 + i * 0.2;
      const len = 0.16;
      const w = 0.1 - i * 0.006 + (i > 3 ? 0.03 : 0);
      b.add('w', shapes.box(0.03, len + 0.012, w), 0xe8dcb4, { x: 0, y: py + Math.cos(phi) * len / 2, z: pz + Math.sin(phi) * len / 2 + 0.01, rx: phi, ...bl, glow: 0.18 });
      b.add('w', shapes.box(0.04, len + 0.012, 0.025), GOLD, { y: py + Math.cos(phi) * len / 2 - Math.sin(phi) * 0.03, z: pz + Math.sin(phi) * len / 2 - Math.cos(phi) * 0.04, rx: phi, metal: 0.9, rough: 0.3 });
      py += Math.cos(phi) * len; pz += Math.sin(phi) * len;
    }
    b.add('w', shapes.spike(0.026, 0.14, 4), 0xf3e8c4, { y: py, z: pz, rx: 0.05 + n * 0.2, sx: 1, sz: 1.7, ...bl, glow: 0.2 });
  }
  const g = b.build().geos.w;
  weaponCache.set(name, g);
  return g;
}

// ---- pose parameters -----------------------------------------------------------------
const HERO_P = {
  leg: 0.96, hipsY: 0.98, amp: [0.16, 0.84, 6.2], knee: 1.15, lean: 0.2, twist: 0.2, armAmp: 0.85, armR: 0.5,
  elbowIdle: 0.3, elbowRun: 1.0, armSpread: 0.1, stance: 0.045, breathRate: 1.6, bob: 1.0, heavy: false,
  idle(A, rig, w) {
    const B = rig.b;
    // weapon hand held low and a little forward; shield arm guarding
    to(B.shR, -0.42, 0.0, -0.12, w);
    to(B.elR, -0.62, 0, 0, w);
    to(B.shL, -0.12, 0, 0.12, w);
    to(B.elL, -0.78, 0, 0, w);
    B.wpn.rotation.set(Math.PI - 0.45, 0, 0);
  },
  attack(A, rig, w) {
    const B = rig.b;
    const v = A.variant, k = A.k;
    const hitAt = COMBO_HIT[v];
    const sg = k < hitAt ? -1 + (k / hitAt) * (k / hitAt) : easeOut((k - hitAt) / 0.32);
    const wp = B.wpn;
    wp.rotation.set(Math.PI - 0.45, 0, 0);
    if (v === 0) {
      to(B.shR, -1.28 + 0.08 * sg, sg * 1.2, -0.05, w);
      to(B.elR, -0.4 - 0.2 * (1 - Math.abs(sg)), 0, 0, w);
      to(B.shL, -0.55, -sg * 0.6, 0.35, w);
      to(B.elL, -1.0, 0, 0, w);
      to(B.hips, 0, sg * 0.28, 0, w);
      to(B.spine, 0.22, sg * 0.6, -0.05 * sg, w);
      to(B.thR, -0.5, 0, 0.06, w * 0.8); to(B.shnR, 0.45, 0, 0, w * 0.8);
      to(B.thL, 0.32, 0, -0.06, w * 0.8); to(B.shnL, 0.5, 0, 0, w * 0.8);
      to(B.ftR, 0.1, 0, 0, w * 0.8); to(B.ftL, -0.3, 0, 0, w * 0.8);
      B.hips.position.y -= 0.1 * w;
    } else if (v === 1) {
      to(B.shR, -1.1 + 0.1 * sg, -sg * 1.25, 0.1, w);
      to(B.elR, -0.25 - 0.6 * (1 - Math.abs(sg)), 0, 0, w);
      to(B.shL, -0.6, sg * 0.6, 0.35, w);
      to(B.elL, -1.0, 0, 0, w);
      to(B.hips, 0, -sg * 0.28, 0, w);
      to(B.spine, 0.28, -sg * 0.6, 0.05 * sg, w);
      to(B.thL, -0.5, 0, -0.06, w * 0.8); to(B.shnL, 0.45, 0, 0, w * 0.8);
      to(B.thR, 0.32, 0, 0.06, w * 0.8); to(B.shnR, 0.5, 0, 0, w * 0.8);
      to(B.ftL, 0.1, 0, 0, w * 0.8); to(B.ftR, -0.3, 0, 0, w * 0.8);
      B.hips.position.y -= 0.12 * w;
      wp.rotation.z = 0.3;
    } else {
      // overhead slam: arms high behind the head, then driven down into the ground
      const up = -3.05 + 1.85 * smooth((sg + 1) / 1.0) * (sg < 0 ? 1 : 1);
      const x = sg < 0 ? mix(-3.05, -1.35, smooth(sg + 1)) : mix(-1.35, -0.55, sg);
      to(B.shR, x, 0.05, -0.15, w);
      to(B.elR, sg < 0 ? mix(-1.0, -0.35, smooth(sg + 1)) : -0.2, 0, 0, w);
      to(B.shL, x * 0.95, -0.3, 0.45, w);
      to(B.elL, sg < 0 ? -1.2 : -0.5, 0, 0, w);
      to(B.spine, sg < 0 ? mix(-0.2, 0.15, smooth(sg + 1)) : mix(0.15, 0.62, sg), 0, 0, w);
      to(B.chest, sg < 0 ? mix(-0.25, 0.05, smooth(sg + 1)) : mix(0.05, 0.3, sg), 0, 0, w);
      to(B.head, sg < 0 ? -0.2 : 0.15, 0, 0, w);
      to(B.thR, -0.55, 0, 0.1, w); to(B.shnR, 0.7, 0, 0, w);
      to(B.thL, 0.45, 0, -0.1, w); to(B.shnL, 0.8, 0, 0, w);
      to(B.ftR, 0.2, 0, 0, w); to(B.ftL, -0.5, 0, 0, w);
      B.hips.position.y -= (sg < 0 ? 0.04 : 0.2 * smooth(sg * 3)) * w;
      void up;
    }
  },
  cast(A, rig, w) {
    const B = rig.b;
    if (A.castHold) {
      const s = 0.5 + 0.5 * Math.sin(A.time * 5);
      to(B.shR, -2.6, 0.1, -0.5, w); to(B.elR, -0.2, 0, 0, w);
      to(B.shL, -2.6, -0.1, 0.5, w); to(B.elL, -0.2, 0, 0, w);
      to(B.head, -0.35, 0, 0, w);
      to(B.chest, -0.15, 0, 0, w);
      B.hips.position.y += 0.015 * s * w;
      B.wpn.rotation.set(Math.PI - 0.45, 0, 0);
      return;
    }
    const k = A.k;
    const t = easeOut(k * 1.6);
    to(B.shR, mix(-2.4, -1.4, t), mix(-0.3, 0.25, t), -0.1, w);
    to(B.elR, mix(-1.1, -0.15, t), 0, 0, w);
    to(B.shL, mix(-0.9, -1.45, t), -0.2, 0.4, w);
    to(B.elL, -0.4, 0, 0, w);
    to(B.spine, mix(-0.12, 0.2, t), mix(-0.35, 0.3, t), 0, w);
    to(B.thR, -0.35, 0, 0, w * 0.7); to(B.thL, 0.25, 0, 0, w * 0.7);
    to(B.shnL, 0.3, 0, 0, w * 0.7);
  },
  evade(A, rig, w) {
    const B = rig.b;
    const k = A.k;
    if (A.mode === MODE.EVADE) {
      const th = smooth(k) * TAU;
      const c = 0.95;
      rig.root.rotation.x = th;
      rig.root.position.y = c * (1 - Math.cos(th));
      rig.root.position.z = -c * Math.sin(th);
    }
    to(B.spine, 0.7, 0, 0, w); to(B.chest, 0.3, 0, 0, w);
    to(B.head, 0.5, 0, 0, w);
    to(B.thL, -1.7, 0, -0.1, w); to(B.thR, -1.5, 0, 0.1, w);
    to(B.shnL, 2.1, 0, 0, w); to(B.shnR, 2.0, 0, 0, w);
    to(B.ftL, 0.2, 0, 0, w); to(B.ftR, 0.2, 0, 0, w);
    to(B.shL, -1.0, 0.4, 0.5, w); to(B.shR, -1.0, -0.4, -0.5, w);
    to(B.elL, -1.6, 0, 0, w); to(B.elR, -1.6, 0, 0, w);
    B.hips.position.y -= 0.12 * w;
  },
  leap(A, rig, w) {
    const B = rig.b;
    const k = A.k;
    const crouch = A.mode === MODE.LEAP ? 1 - range(k, 0, 0.2) : 0;
    const tuck = A.mode === MODE.LEAP ? smooth(range(k, 0.1, 0.35)) * (1 - smooth(range(k, 0.72, 0.95))) : 0;
    const ext = A.mode === MODE.LEAP ? smooth(range(k, 0.72, 0.95)) : 0;
    const land = A.land;
    to(B.shR, -2.5, 0, -0.6, w * (tuck + ext * 0.5) + 0.0001);
    to(B.shL, -2.5, 0, 0.6, w * (tuck + ext * 0.5) + 0.0001);
    to(B.elR, -0.5, 0, 0, w * tuck); to(B.elL, -0.5, 0, 0, w * tuck);
    to(B.thL, -1.15, 0, -0.1, w * tuck); to(B.shnL, 1.6, 0, 0, w * tuck);
    to(B.thR, -0.45, 0, 0.1, w * tuck); to(B.shnR, 1.0, 0, 0, w * tuck);
    to(B.ftL, 0.6, 0, 0, w * tuck); to(B.ftR, 0.4, 0, 0, w * tuck);
    to(B.thL, -0.3, 0, -0.1, w * ext); to(B.shnL, 0.1, 0, 0, w * ext);
    to(B.thR, -0.2, 0, 0.1, w * ext); to(B.shnR, 0.1, 0, 0, w * ext);
    to(B.spine, 0.3, 0, 0, w * tuck);
    B.hips.position.y -= 0.28 * crouch * w;
    to(B.thL, -0.9, 0, -0.2, w * crouch * 0.8); to(B.thR, -0.9, 0, 0.2, w * crouch * 0.8);
    to(B.shnL, 1.6, 0, 0, w * crouch * 0.8); to(B.shnR, 1.6, 0, 0, w * crouch * 0.8);
    to(B.spine, 0.5, 0, 0, w * crouch * 0.8);
    // landing crouch
    if (land > 0) {
      const l = land * land;
      to(B.thL, -1.1, 0, -0.25, l); to(B.thR, -1.0, 0, 0.25, l);
      to(B.shnL, 1.9, 0, 0, l); to(B.shnR, 1.8, 0, 0, l);
      to(B.ftL, -0.8, 0, 0, l); to(B.ftR, -0.7, 0, 0, l);
      to(B.spine, 0.55, 0, 0, l); to(B.chest, 0.2, 0, 0, l);
      to(B.shL, -0.3, 0, 1.0, l); to(B.shR, -0.3, 0, -1.0, l);
      B.hips.position.y -= 0.32 * l;
    }
  },
  spawn: false,
  extra(A, rig) {
    const B = rig.b;
    const s = A.s;
    const dt = A.dt;
    if (!s.cape) s.cape = { a: [0.1, 0.1, 0.1], v: [0, 0, 0], z: [0, 0, 0], zv: [0, 0, 0] };
    const c = s.cape;
    const spd = A.lvz;
    const air = A.mode === MODE.LEAP ? 1 : 0;
    const t = A.time;
    for (let i = 0; i < 3; i++) {
      const target = 0.07 + Math.max(-0.1, Math.min(1, spd / 6.2)) * (0.27 + i * 0.06) + 0.04 * Math.sin(t * 5 + i * 1.3) * Math.min(1, Math.abs(spd) / 4)
        + (A.mode === MODE.EVADE ? 0.5 : 0) + air * 0.35 + 0.015 * Math.sin(t * 1.3 + i);
      c.v[i] += ((target - c.a[i]) * 70 - c.v[i] * 7.5) * dt;
      c.a[i] += c.v[i] * dt;
      const zt = -A.lvx * 0.06 + A.turn * 0.012 * (1 + i * 0.4);
      c.zv[i] += ((zt - c.z[i]) * 55 - c.zv[i] * 7) * dt;
      c.z[i] += c.zv[i] * dt;
      B[`cape${i}`].rotation.set(c.a[i], 0, c.z[i]);
    }
    // tabard + tassels follow the legs
    const fwd = Math.min(B.thL.rotation.x, B.thR.rotation.x);
    B.tabF.rotation.x = Math.min(0, fwd) * 0.75 - 0.03;
    B.tasL.rotation.x = B.thL.rotation.x * 0.6 + 0.1 * Math.sin(t * 2.3);
    B.tasR.rotation.x = B.thR.rotation.x * 0.6 + 0.1 * Math.sin(t * 2.1 + 1);
    B.tasL.rotation.z = -0.06 - Math.abs(B.thL.rotation.x) * 0.1;
    B.tasR.rotation.z = 0.06 + Math.abs(B.thR.rotation.x) * 0.1;
  },
};
HERO_P.pose = humanoid;

export const HERO_TRIS = () => heroDef().tris;

// ---- the model ---------------------------------------------------------------------------
export class HeroModel {
  constructor() {
    const def = heroDef();
    this.material = rigMaterial({ glow: 1.2 });
    // Warm rim light: the hero's edges catch a golden glow so the silhouette reads against sand, marsh and dungeon dark alike.
    const u = this.material.userData.u;
    u.uRim.value = 1.05; u.uRimMix.value = 0.7; u.uRimUp.value = 1; u.uFill.value = 0.2;
    u.uRimTint.value.setRGB(1.0, 0.7, 0.34);
    this.rig = new Rig(def, this.material);
    this.outline = addOcclusionOutline(this.rig.meshes[0], 'hero'); // lapis/gold silhouette when something stands in front
    this.anim = new Animator(this.rig, HERO_P, 'player');
    this.anim.near = true;
    // glowing accents tinted by chest / helm rarity
    this.chestMat = new THREE.MeshStandardMaterial({ color: GOLD, emissive: GOLD, emissiveIntensity: 0.6, metalness: 0.8, roughness: 0.3 });
    this.helmMat = new THREE.MeshStandardMaterial({ color: GOLD, emissive: GOLD, emissiveIntensity: 0.6, metalness: 0.8, roughness: 0.3 });
    const gem = new THREE.OctahedronGeometry(0.06, 0);
    const c = new THREE.Mesh(gem, this.chestMat); c.scale.set(1, 1.3, 0.7);
    const h = new THREE.Mesh(new THREE.OctahedronGeometry(0.04, 0), this.helmMat); h.scale.set(1, 1.4, 0.7);
    c.renderOrder = h.renderOrder = 2;
    this.rig.b.accentC.add(c); this.rig.b.accentH.add(h);
    this.weaponMat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, flatShading: true, roughness: 0.5, metalness: 0.5, emissive: 0x000000 });
    this.weaponMat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec3 aMat;\nattribute float aGlow;\nvarying vec3 vMatP;\nvarying float vGlow;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvMatP = aMat; vGlow = aGlow;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vMatP;\nvarying float vGlow;')
        .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = vMatP.x; roughnessFactor = vMatP.y;')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += totalEmissiveRadiance * (0.4 + vGlow * 1.6);');
    };
    this.weaponMat.customProgramCacheKey = () => 'heroWeapon';
    this.weaponMesh = new THREE.Mesh(weaponGeo('Sapara Sickle-Sword'), this.weaponMat);
    this.weaponMesh.castShadow = true;
    this.weaponMesh.renderOrder = 2;
    this.rig.b.wpn.add(this.weaponMesh);
    this.weaponName = 'Sapara Sickle-Sword';
    this.weaponRarity = null;
    this.glowColor = new THREE.Color();
    this.glowI = 0;
    this._eq = { weapon: null, chest: null, helm: null };
    this._castMax = 0.25;
    this._cl = 0;
  }

  get root() { return this.rig.root; }
  get tris() { return heroDef().tris; }

  syncEquipment(p) {
    const w = p.equipment?.weapon;
    if (w !== this._eq.weapon) {
      this._eq.weapon = w;
      const name = w?.base?.name ?? 'Sapara Sickle-Sword';
      if (name !== this.weaponName) {
        this.weaponName = name;
        this.weaponMesh.geometry = weaponGeo(name);
      }
      const rar = w?.rarity ?? 'common';
      this.glowColor.set(RARITY_GLOW[rar] ?? 0);
      this.glowI = rar === 'common' ? 0 : rar === 'magic' ? 0.4 : rar === 'rare' ? 0.5 : 0.65;
    }
    for (const [slot, mat] of [['chest', this.chestMat], ['helm', this.helmMat]]) {
      const it = p.equipment?.[slot];
      if (it !== this._eq[slot]) {
        this._eq[slot] = it;
        const col = it ? (RARITY_GLOW[it.rarity] || GOLD) : GOLD;
        const c = it && it.rarity !== 'common' ? col : GOLD;
        mat.color.set(c); mat.emissive.set(c);
        mat.emissiveIntensity = !it ? 0.35 : it.rarity === 'common' ? 0.5 : it.rarity === 'magic' ? 0.9 : it.rarity === 'rare' ? 1.1 : 1.5;
      }
    }
  }

  // Called from Player.update() once per frame.
  update(p, dt, g) {
    this.syncEquipment(p);
    const A = this.anim;
    const st = p.state;
    A.flash = p.flash;
    A.castHold = false;
    if (st === 'leap') { A.mode = MODE.LEAP; A.k = Math.min(1, p.stateTime / 0.45); }
    else if (st === 'evade') { A.mode = MODE.EVADE; A.k = Math.min(1, p.stateTime / 0.2); }
    else if (st === 'attack') {
      const combo = g.abilities.combo | 0;
      const time = COMBO_TIME[combo] / (p.stats.attackSpeed || 1);
      A.mode = MODE.ATTACK; A.variant = combo; A.k = Math.min(1, p.stateTime / time);
    } else if (g.abilities.channel) { A.mode = MODE.CAST; A.castHold = true; A.k = 1; }
    else if (p.castLock > 0.001) {
      if (p.castLock > this._cl + 0.001) this._castMax = Math.max(0.15, p.castLock);
      A.mode = MODE.CAST; A.k = 1 - p.castLock / this._castMax;
    } else A.mode = MODE.LOCO;
    this._cl = p.castLock;
    A.deadK = 0;
    A.update(dt, g.time, p.pos.x, p.pos.z, p.facing, g);
    // weapon glow pulse
    const pulse = 0.85 + 0.15 * Math.sin(g.time * 3);
    this.weaponMat.emissive.copy(this.glowColor).multiplyScalar(this.glowI * pulse);
    // slash trail orientation: horizontal for slashes, vertical for the overhead slam
    if (st === 'attack' && A.variant === 2) { p.trail.rotation.set(0, -Math.PI / 2, 0); p.trail.position.y = 1.15; }
    else { p.trail.rotation.set(-Math.PI / 2, 0, -Math.PI / 2); p.trail.position.y = 1.0; }
  }
}

void part; void add; void easeIn; void clamp01;
