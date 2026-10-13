import * as THREE from 'three';
import { Builder, shapes, rigMaterial } from './anim/mesh.js';
import { Rig, Animator, MODE, humanoid, to, add, mix, smooth, easeOut, clamp01, range, legCurve, legAng, legLift } from './rig.js';

// Monster models on the procedural rig. Each type: a cached skeleton + merged
// per-bone geometry (shared by every enemy of that type), pose parameters and a
// pose function. Body colours are baked as greys with a tint weight, so the per
// enemy material multiplies in the type/elite colour.

const TAU = Math.PI * 2;
const W = 0xffffff, W2 = 0xd2d2d2, W3 = 0xa8a8a8;
const BONE = 0xe8d6b0, IRON = 0x41372f, GOLD = 0xe2b441, LAPIS = 0x2a4aa8, LAPIS_D = 0x182a6a;
const T = { tint: true, rough: 0.82, ao: 0.4 };

const defCache = {};
const mirror = (fn) => { fn(1, 'L'); fn(-1, 'R'); };

// =============================================================================
// GALLU: hulking horned demon
// =============================================================================
function galluDef() {
  const b = new Builder();
  b.ico('hips', 0.36, W2, { ...T, sy: 0.8, sz: 0.85 });
  b.add('hips', shapes.tatter(0.34, 0.4, 0.62), IRON, { y: -0.04, z: 0.3, double: true });
  b.add('hips', shapes.tatter(0.34, 0.4, 0.5), IRON, { y: -0.04, z: -0.3, double: true });
  b.cyl('hips', 0.34, 0.34, 0.07, 7, 0x5a4a30, { y: 0.1, metal: 0.5, rough: 0.5 });
  b.cyl('spine', 0.33, 0.4, 0.45, 7, W2, { ...T, y: 0.15 });
  b.add('chest', shapes.cyl(0.58, 0.4, 0.7, 7), W, { ...T, y: 0.32, sx: 1.12, sz: 0.85 });
  b.sphere('chest', 0.4, 6, 4, W, { ...T, y: 0.56, z: -0.25, sy: 0.8 });
  for (let i = 0; i < 4; i++) b.spike('chest', 0.08 - i * 0.01, 0.34 - i * 0.03, 5, BONE, { y: 0.22 + i * 0.16, z: -0.4 - (i === 1 ? 0.06 : 0), rx: -0.6, rough: 0.5 });
  for (let i = 0; i < 3; i++) b.box('chest', 0.9 - i * 0.12, 0.05, 0.12, BONE, { y: 0.3 + i * 0.13, z: 0.34, rx: -0.15, rough: 0.5 });
  b.sphere('chest', 0.07, 4, 3, 0xff5a1a, { y: 0.45, z: 0.42, glow: 1.5, ao: 0 });
  b.cyl('neck', 0.17, 0.22, 0.2, 6, W2, T);
  // head
  b.sphere('head', 0.25, 7, 5, W, { ...T, y: 0.1, sy: 0.9 });
  b.box('head', 0.34, 0.13, 0.3, W2, { ...T, y: -0.1, z: 0.12 });
  b.box('head', 0.38, 0.06, 0.14, 0x1a1010, { y: 0.12, z: 0.18, rx: 0.2, rough: 0.9 });
  mirror((s) => {
    b.box('head', 0.085, 0.045, 0.04, 0xffb030, { x: s * 0.1, y: 0.08, z: 0.235, glow: 2.2, ao: 0, var: 0 });
    b.spike('head', 0.035, 0.18, 5, BONE, { x: s * 0.1, y: -0.12, z: 0.26, rx: 0.2, rough: 0.5 });
    b.spike('head', 0.1, 0.4, 6, BONE, { x: s * 0.15, y: 0.22, z: -0.02, rz: -s * 0.75, rx: -0.25, rough: 0.5 });
    b.spike('head', 0.07, 0.34, 6, BONE, { x: s * 0.4, y: 0.52, z: -0.1, rz: s * 0.1, rx: -0.4, rough: 0.5 });
  });
  // arms (long, reaching the knees)
  mirror((s, n) => {
    b.sphere('sh' + n, 0.26, 6, 4, W, { ...T, x: s * 0.04, y: 0.02 });
    b.spike('sh' + n, 0.07, 0.3, 5, BONE, { x: s * 0.16, y: 0.2, rz: -s * 0.7, rough: 0.5 });
    b.limb('sh' + n, 0.16, 0.12, 0.58, 6, W, { ...T });
    b.limb('el' + n, 0.12, 0.16, 0.56, 6, W2, { ...T });
    b.spike('el' + n, 0.06, 0.24, 5, BONE, { y: -0.04, z: -0.12, rx: -1.9, rough: 0.5 });
    b.cyl('el' + n, 0.18, 0.18, 0.06, 6, IRON, { y: -0.5, metal: 0.5, rough: 0.5 });
    b.box('hd' + n, 0.2, 0.16, 0.2, W, { ...T, y: -0.06 });
    for (let k = -1; k <= 1; k++) b.spike('hd' + n, 0.035, 0.34, 4, BONE, { x: k * 0.07, y: -0.1, z: 0.04, rx: Math.PI - 0.15, rz: k * 0.15, rough: 0.5 });
    b.limb('th' + n, 0.2, 0.14, 0.5, 6, W, { ...T });
    b.limb('shn' + n, 0.13, 0.095, 0.5, 6, W2, { ...T });
    b.box('ft' + n, 0.22, 0.1, 0.34, W2, { ...T, y: -0.02, z: 0.1 });
    for (let k = -1; k <= 1; k++) b.spike('ft' + n, 0.03, 0.18, 4, BONE, { x: k * 0.07, y: -0.02, z: 0.26, rx: Math.PI / 2 + 0.1, rough: 0.5 });
  });
  const built = b.build();
  return {
    ...built,
    bones: [
      ['hips', null, 0, 1.08, 0], ['spine', 'hips', 0, 0.12, 0], ['chest', 'spine', 0, 0.3, 0.04],
      ['neck', 'chest', 0, 0.68, 0.14], ['head', 'neck', 0, 0.1, 0.1],
      ['shL', 'chest', 0.62, 0.52, 0.04], ['elL', 'shL', 0, -0.58, 0], ['hdL', 'elL', 0, -0.56, 0],
      ['shR', 'chest', -0.62, 0.52, 0.04], ['elR', 'shR', 0, -0.58, 0], ['hdR', 'elR', 0, -0.56, 0],
      ['thL', 'hips', 0.24, -0.05, 0], ['shnL', 'thL', 0, -0.5, 0], ['ftL', 'shnL', 0, -0.5, 0],
      ['thR', 'hips', -0.24, -0.05, 0], ['shnR', 'thR', 0, -0.5, 0], ['ftR', 'shnR', 0, -0.5, 0],
    ],
    orders: { shL: 'YXZ', shR: 'YXZ' },
  };
}
const GALLU_P = {
  leg: 1.05, hipsY: 1.08, amp: [0.12, 0.52, 3.8], knee: 0.85, lean: 0.1, baseLean: 0.46, twist: 0.24, roll: 1.6, bob: 2.4,
  armAmp: 0.5, armIdle: 0.12, elbowIdle: 0.5, elbowRun: 0.7, armSpread: 0.2, stance: 0.1, breathRate: 1.3, heavy: true, headUp: 0.35,
  attack(A, rig, w) {
    const B = rig.b, p = A.pull, s = A.strike;
    const x = mix(mix(0.1, -2.75, p), -0.35, s);
    to(B.shL, x, mix(0.25, -0.1, s), mix(0.2, 0.55, p * (1 - s)), w);
    to(B.shR, x, mix(-0.25, 0.1, s), mix(-0.2, -0.55, p * (1 - s)), w);
    to(B.elL, mix(mix(-0.5, -0.9, p), -0.15, s), 0, 0, w); to(B.elR, mix(mix(-0.5, -0.9, p), -0.15, s), 0, 0, w);
    to(B.spine, mix(mix(0.25, -0.12, p), 0.62, s), 0, 0, w);
    to(B.chest, mix(mix(0.2, -0.2, p), 0.45, s), 0, 0, w);
    to(B.neck, mix(0.05, -0.35, p * (1 - s)), 0, 0, w);
    to(B.head, mix(0, -0.25, p * (1 - s)), 0, 0, w);
    const lg = Math.max(p * 0.3, s);
    to(B.thL, -0.35 * lg, 0, -0.1, w * 0.8); to(B.thR, 0.25 * lg, 0, 0.1, w * 0.8);
    to(B.shnL, 0.55 * lg, 0, 0, w * 0.8); to(B.shnR, 0.45 * lg, 0, 0, w * 0.8);
    B.hips.position.y -= 0.18 * lg * w;
  },
  extra(A, rig) {
    const B = rig.b;
    // drooling menace: head sways and jaw twitches
    B.head.rotation.y += Math.sin(A.time * 0.9 + A.seed) * 0.16 * (1 - A.wAtk);
  },
};
GALLU_P.pose = humanoid;

// =============================================================================
// UTUKKU: ghostly wraith (no legs, trailing tatters)
// =============================================================================
function utukkuDef() {
  const b = new Builder();
  const g = { tint: true, glow: 0.35, rough: 0.5, ao: 0.1 };
  b.add('hips', shapes.cyl(0.24, 0.1, 0.5, 7), W, { ...g, y: -0.05, fade: [-0.3, 0.45, 0.2, 0.9], alpha: 1 });
  for (let i = 0; i < 6; i++) {
    const n = 'tat' + i;
    b.add(n, shapes.tatter(0.22, 0.06, 1.15), W2, { ...g, double: true, fade: [-1.15, 0.0, 0.0, 0.85], glow: 0.3 });
  }
  b.add('chest', shapes.cyl(0.3, 0.15, 0.55, 7), W, { ...g, y: 0.25, fade: [0, 0.8, 0.5, 1] });
  for (let i = 0; i < 3; i++) b.box('chest', 0.36 - i * 0.06, 0.03, 0.16, 0xdff6ff, { y: 0.18 + i * 0.1, z: 0.12, glow: 0.9, ao: 0, alpha: 0.9 });
  mirror((s, n) => {
    b.sphere('sh' + n, 0.1, 5, 4, W, g);
    b.limb('sh' + n, 0.065, 0.045, 0.5, 5, W, { ...g, fade: [-0.5, 0.65, 0, 1] });
    b.limb('el' + n, 0.05, 0.035, 0.5, 5, W, { ...g, fade: [-0.5, 0.45, 0, 1] });
    for (let k = -1; k <= 1; k++) b.spike('hd' + n, 0.022, 0.3, 4, 0xe8fbff, { x: k * 0.05, y: -0.02, rx: Math.PI - 0.2, rz: k * 0.2, glow: 0.8, ao: 0 });
    b.box('head', 0.075, 0.05, 0.035, 0xc8ffff, { x: s * 0.085, y: 0.06, z: 0.19, glow: 3.2, ao: 0, var: 0 });
  });
  b.add('head', shapes.sphere(0.21, 7, 5), W, { ...g, y: 0.08, glow: 0.45 });
  b.box('head', 0.2, 0.09, 0.05, 0x0a1214, { y: 0.0, z: 0.17, ao: 0 });
  b.add('head', shapes.cone(0.26, 0.62, 6), W3, { ...g, y: 0.2, z: -0.1, rx: -0.55, fade: [0, 0.2, 0.7, 1] });
  b.box('head', 0.1, 0.12, 0.08, W2, { ...g, y: -0.13, z: 0.1 });
  const built = b.build();
  const bones = [
    ['hips', null, 0, 1.15, 0], ['spine', 'hips', 0, 0.12, 0], ['chest', 'spine', 0, 0.22, 0], ['neck', 'chest', 0, 0.52, 0], ['head', 'neck', 0, 0.12, 0],
    ['shL', 'chest', 0.33, 0.42, 0], ['elL', 'shL', 0, -0.5, 0], ['hdL', 'elL', 0, -0.5, 0],
    ['shR', 'chest', -0.33, 0.42, 0], ['elR', 'shR', 0, -0.5, 0], ['hdR', 'elR', 0, -0.5, 0],
  ];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU;
    bones.push(['tat' + i, 'hips', Math.sin(a) * 0.2, -0.28, Math.cos(a) * 0.2]);
  }
  return { ...built, bones, orders: { shL: 'YXZ', shR: 'YXZ' } };
}
const UTUKKU_P = {
  amp: [0.2, 0.7, 5.3], height: 2.2,
  pose(A, rig) {
    const B = rig.b, t = A.time + A.seed;
    const sp = Math.min(1, A.sp), fwd = Math.max(-1, Math.min(1.4, A.lvz / 5.3));
    const bob = Math.sin(t * 2.3);
    B.hips.position.y = 1.15 + 0.14 * bob + 0.05 * Math.sin(t * 5.1);
    const lean = 0.1 + 0.55 * Math.max(0, fwd);
    B.hips.rotation.set(lean * 0.6, Math.sin(t * 0.8) * 0.12, -A.lvx * 0.05 + 0.04 * Math.sin(t * 1.3));
    B.spine.rotation.set(lean * 0.4 + 0.03 * bob, 0, 0);
    B.head.rotation.set(-lean * 0.5 + 0.1 * Math.sin(t * 1.1), Math.sin(t * 0.6) * 0.3, 0.06 * Math.sin(t * 0.9));
    // arms: relaxed, hooked forward; swept back when darting
    const sweep = sp;
    const wob = Math.sin(t * 2.0);
    B.shL.rotation.set(-0.5 + 1.1 * sweep + 0.1 * wob, 0, 0.35 + 0.2 * Math.sin(t * 1.4));
    B.shR.rotation.set(-0.5 + 1.1 * sweep - 0.1 * wob, 0, -0.35 - 0.2 * Math.sin(t * 1.4 + 1));
    B.elL.rotation.x = -0.9 + 0.3 * wob; B.elR.rotation.x = -0.9 - 0.3 * wob;
    // tatters stream behind and flutter
    for (let i = 0; i < 6; i++) {
      const o = B['tat' + i];
      const a = (i / 6) * TAU;
      const back = -Math.cos(a); // strips at the rear stream more
      const drag = Math.max(0, A.lvz) * 0.1 + 0.18;
      o.rotation.set(drag * (0.6 + 0.5 * back) + 0.18 * Math.sin(t * 3.2 + i * 1.7), a, -A.lvx * 0.06 + 0.15 * Math.sin(t * 2.7 + i * 2.1));
      o.rotation.order = 'YXZ';
    }
    if (A.wAtk > 0.002) {
      const w = A.wAtk, p = A.pull, s = A.strike;
      to(B.shL, mix(mix(0.5, 1.0, p), -1.9, s), mix(0.0, 0.2, p), mix(0.5, 1.1, p * (1 - s)), w);
      to(B.shR, mix(mix(0.5, 1.0, p), -1.9, s), mix(0.0, -0.2, p), mix(-0.5, -1.1, p * (1 - s)), w);
      to(B.elL, mix(-0.6, -0.15, s), 0, 0, w); to(B.elR, mix(-0.6, -0.15, s), 0, 0, w);
      to(B.spine, mix(mix(0.1, -0.35, p), 0.7, s), 0, 0, w);
      to(B.hips, mix(mix(0.1, -0.2, p), 0.5, s), 0, 0, w);
      B.hips.position.z += 0.55 * s * w;
    }
    if (A.deadK > 0) {
      const d = smooth(A.deadK);
      B.hips.position.y -= (0.9 + 0.1 * d) * d;
      add(B.hips, -1.0 * d, 0, 0);
      add(B.shL, 0.9 * d, 0, 0.8 * d); add(B.shR, 0.9 * d, 0, -0.8 * d);
      add(B.head, 0.6 * d, 0, 0);
    }
    if (A.mode === MODE.SPAWN) {
      const r = 1 - A.spawnK;
      B.hips.position.y -= 0.5 * r;
      add(B.spine, 0.5 * r, 0, 0);
    }
  },
};

// =============================================================================
// LILITU: winged night-spirit caster
// =============================================================================
function lilituDef() {
  const b = new Builder();
  const skin = { tint: 0.45, rough: 0.6, ao: 0.3 };
  const robe = { tint: true, rough: 0.7, ao: 0.35 };
  b.add('hips', shapes.limb(0.17, 0.3, 0.8, 7), W, { ...robe, y: 0.02, fade: [-0.8, 0.5, 0, 1] });
  b.cyl('hips', 0.19, 0.19, 0.06, 7, GOLD, { y: 0.06, metal: 0.8, rough: 0.35 });
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU;
    b.add('hips', shapes.tatter(0.16, 0.04, 0.5), W2, { ...robe, x: Math.sin(a) * 0.25, z: Math.cos(a) * 0.25, y: -0.6, ry: a, double: true, fade: [-1.1, 0.0, -0.6, 0.9] });
  }
  b.cyl('chest', 0.2, 0.15, 0.5, 7, W, { ...robe, y: 0.22 });
  b.box('chest', 0.28, 0.12, 0.2, GOLD, { y: 0.4, metal: 0.8, rough: 0.35, sz: 0.9 });
  b.sphere('chest', 0.045, 4, 3, 0xff4aff, { y: 0.22, z: 0.16, glow: 2.2, ao: 0 });
  b.cyl('neck', 0.06, 0.07, 0.14, 5, W2, skin);
  b.add('head', shapes.sphere(0.17, 7, 5), W2, { ...skin, y: 0.08, sy: 1.12 });
  // long hair + horned crown
  b.add('head', shapes.tatter(0.3, 0.18, 0.9), 0x1a0f20, { y: 0.2, z: -0.14, double: true, rough: 0.9 });
  mirror((s, n) => {
    b.box('head', 0.05, 0.022, 0.02, 0xff7aff, { x: s * 0.06, y: 0.09, z: 0.15, glow: 3.0, ao: 0, var: 0 });
    b.spike('head', 0.05, 0.32, 5, GOLD, { x: s * 0.1, y: 0.2, rz: -s * 0.6, metal: 0.8, rough: 0.35 });
    b.spike('head', 0.035, 0.24, 5, GOLD, { x: s * 0.28, y: 0.46, rz: s * 0.25, metal: 0.8, rough: 0.35 });
    b.sphere('sh' + n, 0.08, 5, 4, W, robe);
    b.limb('sh' + n, 0.06, 0.045, 0.34, 5, W2, skin);
    b.limb('el' + n, 0.05, 0.035, 0.34, 5, W2, skin);
    b.box('el' + n, 0.09, 0.04, 0.09, GOLD, { y: -0.3, metal: 0.8, rough: 0.35 });
    for (let k = -1; k <= 1; k++) b.spike('hd' + n, 0.018, 0.2, 4, 0xe8d6ff, { x: k * 0.035, y: -0.02, rx: Math.PI - 0.25, rz: k * 0.25 });
    // owl talons
    b.limb('th' + n, 0.06, 0.04, 0.38, 5, W2, skin);
    b.limb('shn' + n, 0.045, 0.03, 0.36, 5, W2, skin);
    for (let k = -1; k <= 1; k++) b.spike('ft' + n, 0.02, 0.2, 4, 0x2a1a30, { x: k * 0.045, y: -0.02, z: 0.04, rx: Math.PI / 2 + 0.7, rz: k * 0.2 });
    // wings: arm bone with hanging feathers, a second tip segment beyond the elbow
    const w1 = 'w' + n, w2 = 'wt' + n;
    b.seg(w1, [0, 0, 0], [s * 0.6, 0.12, 0], 0.045, 0.035, 5, W3, { tint: 0.3, ao: 0.3 });
    for (let i = 0; i < 5; i++) {
      const x = s * (0.06 + i * 0.11);
      b.add(w1, shapes.tatter(0.15, 0.1, 0.95 - i * 0.07), 0x6a3a8a, { x, y: 0.02 + i * 0.02, rz: s * (0.04 * i), double: true, tint: 0.7, rough: 0.8, glow: 0.12 });
    }
    b.seg(w2, [0, 0, 0], [s * 0.7, 0.2, 0], 0.035, 0.02, 5, W3, { tint: 0.3, ao: 0.3 });
    for (let i = 0; i < 6; i++) {
      const x = s * (0.05 + i * 0.11);
      b.add(w2, shapes.tatter(0.15, 0.06, 1.25 - i * 0.14), 0x3a1f4a, { x, y: 0.03 + i * 0.03, rz: s * (0.05 + 0.04 * i), double: true, tint: 0.8, rough: 0.8, glow: 0.16 });
    }
    b.add(w2, shapes.fin(0.07, 0.22, 0.03), 0xc890ff, { x: s * 0.7, y: 0.18, rz: -s * 1.3, glow: 1.0, ao: 0 });
  });
  const built = b.build();
  return {
    ...built,
    bones: [
      ['hips', null, 0, 1.3, 0], ['spine', 'hips', 0, 0.08, 0], ['chest', 'spine', 0, 0.2, 0], ['neck', 'chest', 0, 0.5, 0], ['head', 'neck', 0, 0.08, 0],
      ['shL', 'chest', 0.25, 0.4, 0], ['elL', 'shL', 0, -0.34, 0], ['hdL', 'elL', 0, -0.34, 0],
      ['shR', 'chest', -0.25, 0.4, 0], ['elR', 'shR', 0, -0.34, 0], ['hdR', 'elR', 0, -0.34, 0],
      ['thL', 'hips', 0.1, -0.05, 0], ['shnL', 'thL', 0, -0.38, 0], ['ftL', 'shnL', 0, -0.36, 0],
      ['thR', 'hips', -0.1, -0.05, 0], ['shnR', 'thR', 0, -0.38, 0], ['ftR', 'shnR', 0, -0.36, 0],
      ['wL', 'chest', 0.1, 0.38, -0.14], ['wtL', 'wL', 0.6, 0.12, 0],
      ['wR', 'chest', -0.1, 0.38, -0.14], ['wtR', 'wR', -0.6, 0.12, 0],
      ['orb', 'chest', 0, 0.35, 0.75],
    ],
    orders: { shL: 'YXZ', shR: 'YXZ', wL: 'YXZ', wR: 'YXZ' },
  };
}
const LILITU_P = {
  amp: [0.2, 0.6, 3.0], height: 2.4,
  pose(A, rig) {
    const B = rig.b, t = A.time + A.seed;
    const fwd = Math.max(-1, Math.min(1.3, A.lvz / 3.0));
    const bob = Math.sin(t * 1.7);
    B.hips.position.y = 1.3 + 0.16 * bob;
    const lean = 0.06 + 0.22 * fwd;
    B.hips.rotation.set(lean, 0, -A.lvx * 0.04);
    B.spine.rotation.set(lean * 0.4, 0.05 * Math.sin(t * 0.7), 0);
    B.head.rotation.set(-lean * 0.7, 0.12 * Math.sin(t * 0.5), 0.05 * Math.sin(t * 0.9));
    // dangling talons
    for (const [n, ph] of [['L', 0.5], ['R', 1.7]]) {
      B['th' + n].rotation.set(0.1 + 0.1 * Math.sin(t * 1.7 + ph) - lean * 0.6, 0, n === 'L' ? -0.05 : 0.05);
      B['shn' + n].rotation.x = 0.25 + 0.12 * Math.sin(t * 1.7 + ph + 0.8);
      B['ft' + n].rotation.x = 0.35;
    }
    // idle arms: hands drifting together in front of the chest
    B.shL.rotation.set(-0.4 + 0.05 * Math.sin(t * 1.3), 0, 0.15);
    B.shR.rotation.set(-0.4 + 0.05 * Math.sin(t * 1.3 + 1), 0, -0.15);
    B.elL.rotation.x = -1.0; B.elR.rotation.x = -1.0;
    // wings flap slowly; tips lag the root
    const f = Math.sin(t * 2.1);
    const flare = A.wAtk * A.pull;
    B.wL.rotation.set(0, 0.35 - 0.25 * flare, 0.35 + 0.5 * f + 0.4 * flare);
    B.wR.rotation.set(0, -0.35 + 0.25 * flare, -0.35 - 0.5 * f - 0.4 * flare);
    const f2 = Math.sin(t * 2.1 - 1.0);
    B.wtL.rotation.set(0, 0, 0.1 + 0.5 * f2 + 0.2 * flare);
    B.wtR.rotation.set(0, 0, -0.1 - 0.5 * f2 - 0.2 * flare);
    if (A.wAtk > 0.002) {
      const w = A.wAtk, p = A.pull, s = A.strike;
      to(B.shL, mix(mix(-0.4, -2.35, p), -1.4, s), mix(0, 0.15, p), mix(0.15, 0.45, p), w);
      to(B.shR, mix(mix(-0.4, -2.35, p), -1.4, s), mix(0, -0.15, p), mix(-0.15, -0.45, p), w);
      to(B.elL, mix(-1.0, -0.5, p), 0, 0, w); to(B.elR, mix(-1.0, -0.5, p), 0, 0, w);
      to(B.spine, mix(mix(0.05, -0.28, p), 0.28, s), 0, 0, w);
      to(B.head, mix(mix(0, -0.35, p), 0.15, s), 0, 0, w);
      B.hips.position.y += 0.3 * p * (1 - s) * w;
      B.hips.position.z += 0.25 * s * w;
    }
    // casting orb between the hands
    if (rig.orbMesh) {
      const p = A.wAtk * (1 - A.strike * 0.6);
      const pulse = 1 + 0.12 * Math.sin(t * 9);
      const sc = (0.55 + 0.85 * A.pull * A.wAtk) * pulse * (A.mode === MODE.SPAWN || A.deadK > 0 ? 0.001 : 1);
      rig.orbMesh.scale.setScalar(Math.max(0.001, sc));
      rig.orbMesh.visible = A.deadK < 0.4;
      B.orb.position.set(0, 0.36 + 0.5 * p * A.pull + 0.0, 0.66 - 0.1 * A.strike * A.wAtk);
    }
    if (A.deadK > 0) {
      const d = smooth(A.deadK);
      B.hips.position.y -= 1.15 * d;
      add(B.hips, -1.1 * d, 0, 0);
      add(B.wL, 0, 0, -0.7 * d); add(B.wR, 0, 0, 0.7 * d);
      add(B.shL, 0.8 * d, 0, 0); add(B.shR, 0.8 * d, 0, 0);
    }
    if (A.mode === MODE.SPAWN) {
      const r = 1 - A.spawnK;
      B.hips.position.y -= 0.5 * r;
      add(B.wL, 0, 0, -0.9 * r); add(B.wR, 0, 0, 0.9 * r);
    }
  },
};

// =============================================================================
// GIRTABLULLU: scorpion-man archer
// =============================================================================
function scorpionDef() {
  const b = new Builder();
  const dk = 0x5a5a5a;
  // abdomen / lower body
  b.ico('body', 0.62, W, { ...T, sy: 0.62, sz: 1.3, y: 0.0 });
  b.ico('body', 0.5, W2, { ...T, sy: 0.55, sz: 0.9, y: 0.12, z: -0.5 });
  for (let i = 0; i < 4; i++) b.box('body', 0.8 - i * 0.1, 0.1, 0.26, W3, { ...T, y: 0.3 - i * 0.02, z: -0.5 + i * 0.3, rx: -0.1 });
  mirror((s) => {
    b.sphere('body', 0.12, 4, 3, 0x9aff4a, { x: s * 0.2, y: 0.12, z: 0.7, glow: 1.2, ao: 0 });
  });
  // human torso rising from the front
  b.cyl('torso', 0.32, 0.4, 0.3, 7, W2, { ...T, y: 0.08 });
  b.add('chest', shapes.cyl(0.4, 0.3, 0.55, 7), 0xb58a45, { y: 0.25, sx: 1.05, sz: 0.8, metal: 0.65, rough: 0.4 });
  b.box('chest', 0.34, 0.5, 0.04, 0x8a5a2a, { y: 0.26, z: 0.24, metal: 0.5, rough: 0.5 });
  b.sphere('chest', 0.05, 4, 3, 0xffd23a, { y: 0.3, z: 0.27, glow: 1.4, ao: 0 });
  b.cyl('neck', 0.08, 0.1, 0.12, 5, W2, T);
  b.add('head', shapes.sphere(0.16, 7, 5), W, { ...T, y: 0.06 });
  b.box('head', 0.2, 0.06, 0.05, 0x15100a, { y: 0.04, z: 0.13, ao: 0 });
  b.add('head', new THREE.SphereGeometry(0.19, 8, 4, 0, TAU, 0, Math.PI * 0.55), 0xb58a45, { y: 0.08, metal: 0.7, rough: 0.4 });
  mirror((s, n) => {
    b.box('head', 0.05, 0.022, 0.02, 0xffd23a, { x: s * 0.058, y: 0.06, z: 0.155, glow: 2.4, ao: 0, var: 0 });
    b.spike('head', 0.05, 0.26, 5, GOLD, { x: s * 0.14, y: 0.17, rz: -s * 0.75, metal: 0.8, rough: 0.4 });
    b.spike('head', 0.035, 0.2, 5, GOLD, { x: s * 0.27, y: 0.32, rz: s * 0.15, metal: 0.8, rough: 0.4 });
    b.sphere('sh' + n, 0.15, 5, 4, 0xb58a45, { x: s * 0.04, y: 0.02, metal: 0.65, rough: 0.4 });
    b.limb('sh' + n, 0.08, 0.065, 0.36, 5, W, T);
    b.limb('el' + n, 0.065, 0.055, 0.34, 5, W, T);
    b.cyl('el' + n, 0.075, 0.075, 0.07, 5, 0xb58a45, { y: -0.2, metal: 0.65, rough: 0.4 });
    b.box('hd' + n, 0.09, 0.09, 0.09, W, { ...T, y: -0.02 });
    // six legs: coxa (sweeps) -> femur up and out -> tibia down to the foot
    for (let i = 0; i < 3; i++) {
      const c = 'c' + n + i, k = 'k' + n + i;
      b.seg(c, [0, 0, 0], [s * 0.52, 0.16, 0], 0.075, 0.06, 5, W2, T);
      b.sphere(c, 0.075, 4, 3, W3, { ...T, x: s * 0.52, y: 0.16 });
      b.seg(k, [0, 0, 0], [s * 0.34, -0.8, 0], 0.06, 0.02, 5, W3, T);
      b.spike(k, 0.03, 0.12, 4, BONE, { x: s * 0.34, y: -0.8, rz: s * 0.2 + Math.PI, rough: 0.5 });
    }
  });
  // bow
  const bp = [[0.44, -0.1], [0.3, -0.04], [0.1, 0.0], [-0.1, 0.0], [-0.3, -0.04], [-0.44, -0.1]];
  for (let i = 0; i < bp.length - 1; i++) b.seg('bow', [0, bp[i][0], bp[i][1]], [0, bp[i + 1][0], bp[i + 1][1]], 0.03, 0.03, 4, 0x5a3a1e, { rough: 0.7, ao: 0.2 });
  b.sphere('bow', 0.045, 4, 3, GOLD, { y: 0.44, z: -0.1, metal: 0.8, rough: 0.35 });
  b.sphere('bow', 0.045, 4, 3, GOLD, { y: -0.44, z: -0.1, metal: 0.8, rough: 0.35 });
  b.box('bow', 0.07, 0.16, 0.07, GOLD, { y: 0, z: 0.0, metal: 0.8, rough: 0.35 });
  b.add('strU', shapes.box(0.012, 0.44, 0.012).translate(0, -0.22, 0), 0xe8e0c0, { ao: 0, var: 0 });
  b.add('strL', shapes.box(0.012, 0.44, 0.012).translate(0, 0.22, 0), 0xe8e0c0, { ao: 0, var: 0 });
  b.add('arrow', shapes.cyl(0.012, 0.012, 0.75, 4).rotateX(Math.PI / 2).translate(0, 0, 0.3), 0xe8d6b0, { ao: 0 });
  b.add('arrow', shapes.cone(0.03, 0.12, 4).rotateX(Math.PI / 2).translate(0, 0, 0.72), 0xff9a2a, { glow: 1.4, ao: 0 });
  // tail
  const tr = [0.17, 0.15, 0.13, 0.11, 0.09];
  for (let i = 0; i < 5; i++) {
    b.ico('tl' + i, tr[i], i % 2 ? W2 : W, { ...T, sy: 1.5 });
    b.spike('tl' + i, 0.02, 0.1, 4, W3, { ...T, y: 0.1, z: -0.1 });
  }
  b.add('tl4', shapes.spike(0.09, 0.4, 5), 0x9aff4a, { y: 0.3, rx: 0.0, glow: 1.2, ao: 0.1, rough: 0.4 });
  b.sphere('tl4', 0.1, 5, 4, 0xe8d6b0, { y: 0.2, rough: 0.4 });
  const built = b.build();
  const bones = [
    ['body', null, 0, 0.62, 0],
    ['torso', 'body', 0, 0.28, 0.62], ['chest', 'torso', 0, 0.28, 0], ['neck', 'chest', 0, 0.58, 0], ['head', 'neck', 0, 0.1, 0],
    ['shL', 'chest', 0.38, 0.45, 0], ['elL', 'shL', 0, -0.36, 0], ['hdL', 'elL', 0, -0.34, 0],
    ['shR', 'chest', -0.38, 0.45, 0], ['elR', 'shR', 0, -0.36, 0], ['hdR', 'elR', 0, -0.34, 0],
    ['bow', 'hdL', 0, -0.05, 0.0], ['strU', 'bow', 0, 0.44, -0.1], ['strL', 'bow', 0, -0.44, -0.1], ['arrow', 'bow', 0, 0, -0.1],
    ['tl0', 'body', 0, 0.2, -0.85], ['tl1', 'tl0', 0, 0.3, 0], ['tl2', 'tl1', 0, 0.28, 0], ['tl3', 'tl2', 0, 0.26, 0], ['tl4', 'tl3', 0, 0.24, 0],
  ];
  const zs = [0.5, 0.0, -0.5];
  for (let i = 0; i < 3; i++) {
    bones.push(['cL' + i, 'body', 0.45, -0.05, zs[i]], ['kL' + i, 'cL' + i, 0.52, 0.16, 0]);
    bones.push(['cR' + i, 'body', -0.45, -0.05, zs[i]], ['kR' + i, 'cR' + i, -0.52, 0.16, 0]);
  }
  const orders = { shL: 'YXZ', shR: 'YXZ' };
  for (let i = 0; i < 3; i++) { orders['cL' + i] = 'YXZ'; orders['cR' + i] = 'YXZ'; }
  return { ...built, bones, orders };
}
const SCORP_P = {
  amp: [0.22, 0.5, 3.0], leg: 0.9, height: 2.5, heavy: false,
  pose(A, rig) {
    const B = rig.b, t = A.time + A.seed;
    const wL = A.wLoco, breath = Math.sin(t * 1.5);
    const amp = A.amp;
    // tripod gait: legs L0,R1,L2 move together, R0,L1,R2 half a cycle later
    for (let i = 0; i < 3; i++) {
      for (const [n, sd] of [['L', 1], ['R', -1]]) {
        const grpB = (n === 'L') === (i % 2 === 1);
        const ph = (A.phase + (grpB ? 0.5 : 0)) % 1;
        legCurve(ph, amp);
        const ang = legAng(), lift = legLift();
        const cox = B['c' + n + i], kn = B['k' + n + i];
        cox.rotation.set(0, -sd * ang * wL + (i - 1) * 0.3 * sd, sd * lift * 0.55 * wL);
        kn.rotation.set(0, 0, -sd * lift * 0.35 * wL);
        // idle: legs twitch very slightly
        cox.rotation.y += Math.sin(t * 1.1 + i * 2 + (sd > 0 ? 0 : 1.5)) * 0.04 * (1 - wL);
      }
    }
    // body bob + sway
    B.body.position.y = 0.62 + 0.03 * breath * (1 - wL) + 0.035 * Math.abs(Math.sin(A.phase * TAU)) * wL;
    B.body.rotation.set(0, 0, 0.03 * Math.sin(A.phase * TAU) * wL + A.lvx * -0.02);
    // torso + bow arm
    const lean = 0.05 + 0.1 * Math.min(1, A.sp);
    B.torso.rotation.set(0.05 * breath + lean * 0.5, 0.25 * Math.sin(A.phase * TAU) * wL * 0.5 + 0.12 * Math.sin(t * 0.5), 0);
    B.chest.rotation.set(0, 0, 0.02 * Math.sin(t * 0.6));
    B.head.rotation.set(-lean * 0.5, 0.1 * Math.sin(t * 0.4), 0);
    // idle: bow held low in left hand, right hand at the hip
    B.shL.rotation.set(-0.4, 0, 0.12); B.elL.rotation.x = -0.7;
    B.shR.rotation.set(0.1, 0, -0.12); B.elR.rotation.x = -0.5;
    // tail: curled over the back, idle sway
    const curl0 = -0.55, curl = 0.36;
    for (let i = 0; i < 5; i++) {
      const sw = 0.1 * Math.sin(t * 1.6 - i * 0.55) + 0.04 * Math.sin(A.phase * TAU * 2 + i) * wL;
      B['tl' + i].rotation.set((i === 0 ? curl0 : curl) + sw, 0, 0.05 * Math.sin(t * 1.1 + i));
    }
    let draw = 0, bowUp = 0;
    if (A.wAtk > 0.002) {
      const w = A.wAtk, p = A.pull, s = A.strike;
      draw = p * (1 - s);
      bowUp = p * w;
      // bow arm extended toward the target, right arm draws the string to the cheek
      to(B.shL, -1.52, -0.1, 0.05, w * p + w * s * 0.0);
      to(B.elL, -0.12, 0, 0, w * p);
      to(B.shR, -1.35, 0.55, -0.15, w * p);
      to(B.elR, mix(-0.5, -2.2, draw), 0, 0, w * p);
      to(B.torso, 0.05, mix(0.0, 0.5, p), 0, w);
      to(B.head, -0.05, mix(0, -0.45, p), 0, w);
      for (let i = 0; i < 5; i++) B['tl' + i].rotation.x += (0.12 * p + 0.3 * s * (i === 4 ? 1 : 0.4)) * w;
      B.body.position.y -= 0.05 * p * w;
    }
    // bow orientation: keep upright whatever the arm does
    const bx = -(B.torso.rotation.x + B.chest.rotation.x + B.shL.rotation.x + B.elL.rotation.x);
    B.bow.rotation.set(bx, 0, 0);
    // string follows the drawing hand
    const d = 0.02 + 0.5 * draw;
    const ang = Math.atan2(d, 0.44);
    const sl = Math.hypot(0.44, d) / 0.44;
    B.strU.rotation.set(ang, 0, 0); B.strU.scale.set(1, sl, 1);
    B.strL.rotation.set(-ang, 0, 0); B.strL.scale.set(1, sl, 1);
    B.arrow.position.set(0, 0, -0.1 - d);
    B.arrow.visible = bowUp > 0.02 && A.strike < 0.35 && A.deadK === 0;
    if (A.deadK > 0) {
      const d2 = smooth(A.deadK);
      B.body.position.y -= 0.32 * d2;
      for (let i = 0; i < 3; i++) for (const [n, sd] of [['L', 1], ['R', -1]]) {
        B['c' + n + i].rotation.z = sd * (0.5 + 0.7 * d2);
        B['k' + n + i].rotation.z = sd * -(0.9 * d2);
      }
      add(B.torso, 0.9 * d2, 0, 0);
      add(B.body, 0, 0, 0.2 * d2);
      for (let i = 0; i < 5; i++) B['tl' + i].rotation.x += -0.2 * d2;
    }
    if (A.mode === MODE.SPAWN) {
      const r = 1 - A.spawnK;
      B.body.position.y -= 0.3 * r;
      add(B.torso, 0.7 * r, 0, 0);
    }
  },
};

// =============================================================================
// ASAG STONEBORN: rock golem of floating chunks
// =============================================================================
function asagDef() {
  const b = new Builder();
  const R = (c) => ({ tint: true, jit: 0.1, rough: 0.95, ao: 0.45, var: 0.22, ...c });
  const magma = 0xff6a20;
  b.add('hips', shapes.dodeca(0.55), W2, R({ sy: 0.8, y: 0 }));
  b.add('spine', shapes.dodeca(0.5), W3, R({ y: 0.25, sy: 0.9 }));
  b.box('spine', 0.5, 0.06, 0.1, magma, { y: 0.55, z: 0.28, glow: 2.0, ao: 0, var: 0 });
  b.add('chest', shapes.dodeca(0.95), W, R({ y: 0.7, sx: 1.25, sy: 0.95, sz: 0.95 }));
  b.add('chest', shapes.dodeca(0.5), W2, R({ y: 0.3, z: 0.55, sx: 1.2 }));
  b.box('chest', 0.12, 0.7, 0.08, magma, { x: 0.0, y: 0.65, z: 0.9, rz: 0.15, glow: 2.0, ao: 0, var: 0 });
  b.box('chest', 0.5, 0.07, 0.08, magma, { x: 0.3, y: 0.55, z: 0.9, rz: -0.4, glow: 2.0, ao: 0, var: 0 });
  for (let i = 0; i < 4; i++) b.spike('chest', 0.14, 0.5 - i * 0.05, 4, W3, { tint: true, x: (i - 1.5) * 0.4, y: 1.35, z: -0.4, rx: -0.4, rz: (i - 1.5) * 0.2, rough: 0.95 });
  b.add('head', shapes.dodeca(0.38), W, R({ sy: 0.9, sz: 1.0 }));
  b.box('head', 0.4, 0.05, 0.05, magma, { y: 0.0, z: 0.34, glow: 3.0, ao: 0, var: 0 });
  b.add('head', shapes.spike(0.1, 0.35, 4), W3, R({ x: 0.0, y: 0.3 }));
  mirror((s, n) => {
    b.box('head', 0.1, 0.07, 0.06, 0xffa040, { x: s * 0.14, y: 0.05, z: 0.34, glow: 3.2, ao: 0, var: 0 });
    b.add('sh' + n, shapes.dodeca(0.5), W, R({ x: s * 0.1, y: 0.0 }));
    b.add('sh' + n, shapes.dodeca(0.4), W2, R({ x: s * 0.0, y: -0.7, sy: 1.5 }));
    b.add('el' + n, shapes.dodeca(0.42), W3, R({ y: -0.35, sy: 1.5 }));
    b.add('hd' + n, shapes.dodeca(0.55), W, R({ y: -0.2 }));
    b.add('hd' + n, shapes.dodeca(0.22), W2, R({ x: s * 0.3, y: -0.45, z: 0.3 }));
    b.box('el' + n, 0.4, 0.05, 0.05, magma, { y: -0.05, glow: 2.0, ao: 0, var: 0 });
    b.add('th' + n, shapes.dodeca(0.46), W2, R({ y: -0.35, sy: 1.5 }));
    b.add('shn' + n, shapes.dodeca(0.4), W3, R({ y: -0.3, sy: 1.6 }));
    b.add('ft' + n, shapes.dodeca(0.34), W, R({ y: -0.04, sy: 0.55, sx: 1.2, sz: 1.5, z: 0.1 }));
    b.box('shn' + n, 0.3, 0.05, 0.05, magma, { y: -0.1, z: 0.3, glow: 1.6, ao: 0, var: 0 });
  });
  for (let i = 0; i < 4; i++) b.add('rk' + i, shapes.dodeca(0.17 + (i % 2) * 0.06), i % 2 ? W : W3, R({}));
  const built = b.build();
  const bones = [
    ['hips', null, 0, 1.55, 0], ['spine', 'hips', 0, 0.22, 0], ['chest', 'spine', 0, 0.4, 0.02], ['head', 'chest', 0, 1.65, 0.28],
    ['shL', 'chest', 1.2, 1.0, 0.05], ['elL', 'shL', 0.0, -1.15, 0.0], ['hdL', 'elL', 0, -0.95, 0],
    ['shR', 'chest', -1.2, 1.0, 0.05], ['elR', 'shR', 0.0, -1.15, 0.0], ['hdR', 'elR', 0, -0.95, 0],
    ['thL', 'hips', 0.48, -0.15, 0], ['shnL', 'thL', 0, -0.8, 0], ['ftL', 'shnL', 0, -0.7, 0],
    ['thR', 'hips', -0.48, -0.15, 0], ['shnR', 'thR', 0, -0.8, 0], ['ftR', 'shnR', 0, -0.7, 0],
  ];
  for (let i = 0; i < 4; i++) bones.push(['rk' + i, 'chest', 0, 0.9, 0]);
  return { ...built, bones, orders: { shL: 'YXZ', shR: 'YXZ' } };
}
const ASAG_P = {
  leg: 1.65, hipsY: 1.58, amp: [0.1, 0.4, 2.5], knee: 0.5, lean: 0.07, baseLean: 0.1, twist: 0.12, roll: 1.2, bob: 1.3,
  armAmp: 0.28, armIdle: 0.05, elbowIdle: 0.25, elbowRun: 0.4, armSpread: 0.14, stance: 0.06, breathRate: 0.8, heavy: true,
  attack(A, rig, w) {
    const B = rig.b, p = A.pull, s = A.strike;
    const x = mix(mix(0.05, -3.0, p), -0.1, s);
    to(B.shL, x, mix(0.1, 0.0, s), mix(0.14, 0.35, p * (1 - s)), w);
    to(B.shR, x, mix(-0.1, 0.0, s), mix(-0.14, -0.35, p * (1 - s)), w);
    to(B.elL, mix(-0.25, -0.5, p * (1 - s)), 0, 0, w); to(B.elR, mix(-0.25, -0.5, p * (1 - s)), 0, 0, w);
    to(B.spine, mix(mix(0.12, -0.3, p), 0.55, s), 0, 0, w);
    to(B.chest, mix(mix(0.1, -0.22, p), 0.35, s), 0, 0, w);
    to(B.head, mix(0, -0.2, p * (1 - s)), 0, 0, w);
    B.hips.position.y -= 0.35 * s * w;
    to(B.thL, -0.3 * s, 0, 0, w); to(B.thR, -0.3 * s, 0, 0, w);
    to(B.shnL, 0.4 * s, 0, 0, w); to(B.shnR, 0.4 * s, 0, 0, w);
  },
  extra(A, rig) {
    const B = rig.b, t = A.time * 0.7 + A.seed;
    // orbiting rock chunks
    for (let i = 0; i < 4; i++) {
      const a = t * (0.6 + i * 0.1) + i * 1.57;
      const r = 1.55 + 0.15 * Math.sin(t * 1.3 + i);
      B['rk' + i].position.set(Math.sin(a) * r, 0.5 + 0.7 * Math.sin(t * 0.9 + i * 1.7) + (i % 2) * 0.9, Math.cos(a) * r);
      B['rk' + i].rotation.set(t + i, t * 0.7 + i * 2, 0);
    }
    // floating head and shoulders: tiny hover
    B.head.position.y = 1.65 + 0.05 * Math.sin(t * 1.4);
    // magma pulse
    const u = A.material.userData.u;
    u.uGlow.value = 1 + 0.25 * Math.sin(A.time * 2.2) + 1.4 * A.wAtk * A.pull;
  },
  dead: false, spawn: () => {},
};
ASAG_P.pose = (A, rig, P) => {
  humanoid(A, rig, P);
  if (A.deadK > 0) {
    const B = rig.b, d = smooth(A.deadK);
    B.hips.position.y -= 0.8 * d;
    add(B.spine, 0.7 * d, 0, 0); add(B.head, 0.5 * d, 0, 0);
    add(B.shL, 0.4 * d, 0, 0.5 * d); add(B.shR, 0.4 * d, 0, -0.5 * d);
    add(B.thL, -0.5 * d, 0, 0); add(B.thR, -0.5 * d, 0, 0);
    add(B.shnL, 0.9 * d, 0, 0); add(B.shnR, 0.9 * d, 0, 0);
    for (let i = 0; i < 4; i++) B['rk' + i].position.y -= 0.8 * d * (0.5 + i * 0.3);
  }
  if (A.mode === MODE.SPAWN) {
    const B = rig.b, r = 1 - A.spawnK;
    B.hips.position.y -= 0.5 * r; add(B.spine, 0.5 * r, 0, 0);
  }
};

// =============================================================================
// NETI: towering armoured gatekeeper (boss)
// =============================================================================
function netiDef() {
  const b = new Builder();
  const lap = { metal: 0.45, rough: 0.4, ao: 0.35 };
  const gld = { metal: 0.85, rough: 0.28, ao: 0.3 };
  const rune = 0xb08cff;
  // skirt + hips
  b.add('hips', shapes.limb(0.55, 0.85, 1.25, 8), LAPIS_D, { ...lap, y: 0.1, shade: [-1.2, 0.1, 0.75, 1.0] });
  b.cyl('hips', 0.9, 0.92, 0.12, 8, GOLD, { ...gld, y: -1.1 });
  b.cyl('hips', 0.56, 0.56, 0.2, 8, GOLD, { ...gld, y: 0.12 });
  b.box('hips', 0.32, 0.3, 0.1, rune, { y: 0.14, z: 0.56, glow: 1.6, ao: 0, var: 0 });
  b.add('hips', shapes.tatter(0.5, 0.6, 1.4), LAPIS, { ...lap, y: 0.0, z: 0.7, double: true });
  b.add('hips', shapes.tatter(0.1, 0.1, 1.4), GOLD, { ...gld, y: 0.0, z: 0.72, double: true });
  b.box('spine', 0.9, 0.35, 0.6, LAPIS_D, { ...lap, y: 0.12 });
  b.add('chest', shapes.cyl(0.95, 0.62, 1.1, 8), LAPIS, { ...lap, y: 0.55, sx: 1.18, sz: 0.8 });
  b.add('chest', shapes.cyl(0.8, 0.5, 0.9, 6), GOLD, { ...gld, y: 0.55, z: 0.3, sx: 1.0, sz: 0.35 });
  for (let i = 0; i < 7; i++) {
    const a = (i - 3) * 0.17;
    b.box('chest', 0.08, 0.1, 0.05, rune, { x: Math.sin(a * 2.2) * 0.62, y: 0.85 - Math.abs(i - 3) * 0.08, z: 0.62 + 0.0, rz: -a * 1.5, glow: 2.4, ao: 0, var: 0 });
  }
  b.cyl('chest', 0.5, 0.78, 0.2, 8, GOLD, { ...gld, y: 1.12, sz: 0.85 });
  b.box('chest', 1.1, 0.7, 0.14, LAPIS_D, { ...lap, y: 0.6, z: -0.5 });
  b.cyl('neck', 0.28, 0.36, 0.34, 7, GOLD, { ...gld, y: 0.1 });
  // head: gold helm with mask, crown of seven horns, lapis beard
  b.add('head', shapes.sphere(0.36, 8, 5), 0xc58a5c, { y: 0.25, sy: 1.1, rough: 0.7 });
  b.add('head', new THREE.SphereGeometry(0.44, 9, 5, 0, TAU, 0, Math.PI * 0.62), GOLD, { ...gld, y: 0.3 });
  b.box('head', 0.52, 0.34, 0.22, GOLD, { ...gld, y: 0.2, z: 0.32 });
  b.box('head', 0.4, 0.07, 0.05, 0x0a0618, { y: 0.28, z: 0.44, ao: 0 });
  b.box('head', 0.1, 0.22, 0.06, GOLD, { ...gld, y: 0.08, z: 0.46 });
  mirror((s) => {
    b.box('head', 0.13, 0.05, 0.04, rune, { x: s * 0.13, y: 0.28, z: 0.455, glow: 3.5, ao: 0, var: 0 });
    b.box('head', 0.07, 0.4, 0.4, GOLD, { ...gld, x: s * 0.42, y: 0.15, z: 0.0 });
    b.spike('head', 0.1, 0.55, 6, 0xf0dca8, { x: s * 0.3, y: 0.6, rz: -s * 1.1, metal: 0.4, rough: 0.4 });
    b.spike('head', 0.07, 0.5, 6, 0xf0dca8, { x: s * 0.72, y: 0.9, rz: s * 0.15, metal: 0.4, rough: 0.4 });
  });
  for (let i = 0; i < 5; i++) {
    const a = (i - 2) * 0.32;
    b.spike('head', 0.07 - Math.abs(i - 2) * 0.01, 0.7 - Math.abs(i - 2) * 0.12, 5, GOLD, { x: Math.sin(a) * 0.3, y: 0.62, z: -0.02 - Math.abs(i - 2) * 0.03, rz: -a * 0.9, ...gld });
  }
  b.add('head', shapes.tatter(0.5, 0.2, 1.0), LAPIS, { y: -0.05, z: 0.4, rx: -0.15, double: true, ...lap });
  b.add('head', shapes.tatter(0.22, 0.08, 0.7), LAPIS_D, { y: -0.2, z: 0.42, rx: -0.1, double: true, ...lap });
  // arms
  mirror((s, n) => {
    b.add('sh' + n, new THREE.SphereGeometry(0.55, 8, 4, 0, TAU, 0, Math.PI * 0.55), GOLD, { ...gld, x: s * 0.08, y: 0.1, sy: 0.85 });
    b.add('sh' + n, new THREE.SphereGeometry(0.46, 8, 3, 0, TAU, 0, Math.PI * 0.5), LAPIS, { ...lap, x: s * 0.12, y: -0.05, sy: 0.7 });
    b.spike('sh' + n, 0.1, 0.6, 5, GOLD, { ...gld, x: s * 0.2, y: 0.4, rz: -s * 0.5 });
    b.spike('sh' + n, 0.07, 0.4, 5, GOLD, { ...gld, x: s * 0.0, y: 0.5 });
    b.limb('sh' + n, 0.23, 0.19, 0.78, 6, LAPIS_D, { ...lap, y: -0.1 });
    b.limb('el' + n, 0.2, 0.17, 0.74, 6, GOLD, { ...gld });
    b.cyl('el' + n, 0.23, 0.23, 0.1, 6, LAPIS_D, { ...lap, y: -0.15 });
    b.box('hd' + n, 0.3, 0.3, 0.3, 0xc58a5c, { y: -0.08, rough: 0.7 });
    b.limb('th' + n, 0.3, 0.22, 0.95, 6, LAPIS_D, { ...lap });
    b.limb('shn' + n, 0.22, 0.17, 0.9, 6, GOLD, { ...gld });
    b.sphere('shn' + n, 0.24, 5, 4, LAPIS, { ...lap, y: 0.0, z: 0.1 });
    b.box('ft' + n, 0.36, 0.2, 0.7, LAPIS_D, { ...lap, y: -0.04, z: 0.2 });
    b.box('ft' + n, 0.3, 0.1, 0.3, GOLD, { ...gld, y: 0.04, z: 0.5 });
  });
  // staff
  b.add('staff', shapes.cyl(0.075, 0.075, 4.8, 6), GOLD, { ...gld, y: 1.1 });
  for (let i = 0; i < 4; i++) b.cyl('staff', 0.12, 0.12, 0.08, 6, LAPIS, { ...lap, y: -1.0 + i * 1.5 });
  b.add('staff', shapes.cyl(0.09, 0.2, 0.4, 6), GOLD, { ...gld, y: 3.35 });
  for (let i = 0; i < 4; i++) b.spike('staff', 0.06, 0.4, 4, GOLD, { ...gld, x: Math.sin(i * 1.57) * 0.26, z: Math.cos(i * 1.57) * 0.26, y: 3.5, rz: Math.sin(i * 1.57) * -0.6, rx: Math.cos(i * 1.57) * 0.6 });
  b.add('staff', shapes.octa(0.32), rune, { y: 3.85, sy: 1.5, glow: 3.0, ao: 0, var: 0 });
  b.sphere('staff', 0.08, 4, 3, GOLD, { ...gld, y: -1.25 });
  // cloak chain + wings
  const cw = [1.5, 1.7, 1.9];
  for (let i = 0; i < 3; i++) {
    b.add('cape' + i, shapes.box(cw[i], 0.95, 0.07).translate(0, -0.47, 0), i === 1 ? 0x3a2a6a : 0x2a1f58, { rough: 0.85, ao: 0.25 });
    if (i === 2) b.add('cape' + i, shapes.box(cw[i] + 0.04, 0.12, 0.09).translate(0, -0.94, 0), GOLD, { ...gld });
  }
  mirror((s, n) => {
    const w = 'wg' + n;
    b.seg(w, [0, 0, 0], [s * 1.3, 0.5, 0], 0.1, 0.06, 5, GOLD, { ...gld });
    for (let i = 0; i < 6; i++) b.add(w, shapes.tatter(0.3, 0.14, 2.4 - i * 0.22), i % 2 ? LAPIS : LAPIS_D, { ...lap, x: s * (0.15 + i * 0.22), y: 0.03 + i * 0.07, z: -0.05 * i, rz: s * 0.05 * i, double: true });
    b.add(w, shapes.fin(0.12, 0.5, 0.06), rune, { x: s * 1.3, y: 0.5, rz: -s * 1.2, glow: 1.4, ao: 0 });
  });
  const built = b.build();
  const bones = [
    ['hips', null, 0, 2.05, 0], ['spine', 'hips', 0, 0.2, 0], ['chest', 'spine', 0, 0.42, 0],
    ['neck', 'chest', 0, 1.2, 0], ['head', 'neck', 0, 0.2, 0.04],
    ['shL', 'chest', 0.98, 0.95, 0], ['elL', 'shL', 0, -0.8, 0], ['hdL', 'elL', 0, -0.78, 0],
    ['shR', 'chest', -0.98, 0.95, 0], ['elR', 'shR', 0, -0.8, 0], ['hdR', 'elR', 0, -0.78, 0],
    ['staff', 'hdR', 0, -0.05, 0.05],
    ['thL', 'hips', 0.46, -0.12, 0], ['shnL', 'thL', 0, -0.95, 0], ['ftL', 'shnL', 0, -0.92, 0],
    ['thR', 'hips', -0.46, -0.12, 0], ['shnR', 'thR', 0, -0.95, 0], ['ftR', 'shnR', 0, -0.92, 0],
    ['cape0', 'chest', 0, 1.05, -0.5], ['cape1', 'cape0', 0, -0.96, 0], ['cape2', 'cape1', 0, -0.96, 0],
    ['wgL', 'chest', 0.35, 0.95, -0.55], ['wgR', 'chest', -0.35, 0.95, -0.55],
  ];
  return { ...built, bones, orders: { shL: 'YXZ', shR: 'YXZ', wgL: 'YXZ', wgR: 'YXZ' } };
}
const NETI_P = {
  leg: 2.0, hipsY: 2.05, amp: [0.07, 0.34, 3.2], knee: 0.6, lean: 0.03, baseLean: 0.0, twist: 0.1, roll: 0.6, bob: 1.1,
  armAmp: 0.22, armIdle: 0.05, elbowIdle: 0.35, elbowRun: 0.45, armSpread: 0.12, stance: 0.04, breathRate: 0.9, heavy: true, height: 4.8, dead: false, spawn: () => {},
  idle(A, rig, w) {
    const B = rig.b, t = A.time + A.seed;
    // staff hand planted by his side, left hand loosely open
    to(B.shR, -0.28, 0, -0.12, w);
    to(B.elR, -0.5, 0, 0, w);
    to(B.shL, -0.18 + 0.03 * Math.sin(t * 0.8), 0, 0.2, w);
    to(B.elL, -0.45, 0, 0, w);
    B.head.rotation.y += 0.12 * Math.sin(t * 0.3);
  },
  attack(A, rig, w) {
    const B = rig.b, p = A.pull, s = A.strike, v = A.variant;
    if (v === 0) {
      // SLAM: staff raised overhead in both hands, then driven down in front of him
      const x = mix(mix(-0.28, -2.95, p), -1.15, s);
      to(B.shR, x, mix(0, -0.08, p), mix(-0.12, -0.25, p), w);
      to(B.elR, mix(mix(-0.5, -0.4, p), -0.2, s), 0, 0, w);
      to(B.shL, x * 0.97, mix(0, 0.2, p), mix(0.2, 0.4, p), w);
      to(B.elL, mix(mix(-0.45, -0.7, p), -0.2, s), 0, 0, w);
      to(B.spine, mix(mix(0.0, -0.22, p), 0.55, s), 0, 0, w);
      to(B.chest, mix(mix(0.0, -0.18, p), 0.3, s), 0, 0, w);
      to(B.head, mix(0, -0.25, p * (1 - s)), 0, 0, w);
      B.hips.position.y -= 0.35 * s * w;
      to(B.thL, -0.4 * s, 0, 0, w); to(B.thR, 0.25 * s, 0, 0, w);
      to(B.shnL, 0.6 * s, 0, 0, w); to(B.shnR, 0.5 * s, 0, 0, w);
    } else if (v === 1) {
      // SWEEP: staff held out wide, the whole body winds up and whips across
      const yaw = mix(mix(0, -1.5, p), 1.3, s);
      to(B.shR, -1.5, yaw, -0.1, w);
      to(B.elR, -0.12, 0, 0, w);
      to(B.shL, -0.8, -yaw * 0.5, 0.6, w);
      to(B.elL, -0.5, 0, 0, w);
      to(B.spine, 0.1, mix(mix(0, 0.5, p), -0.7, s), 0, w);
      to(B.hips, 0, mix(mix(0, 0.3, p), -0.35, s), 0, w);
      to(B.head, 0.05, mix(0, -0.3, p) + 0.3 * s, 0, w);
      B.hips.position.y -= 0.25 * Math.max(p * 0.5, s) * w;
      to(B.thR, -0.3 * Math.max(p, s), 0, 0, w); to(B.shnR, 0.4 * Math.max(p, s), 0, 0, w);
      to(B.thL, 0.3 * Math.max(p, s), 0, 0, w); to(B.shnL, 0.4 * Math.max(p, s), 0, 0, w);
    } else {
      // SEVEN SEALS: staff planted, the free arm and the cloak rise, then a stomp
      const rise = Math.max(p, s);
      to(B.shR, mix(-0.5, -0.8, p), 0, -0.2, w);
      to(B.elR, -0.7, 0, 0, w);
      to(B.shL, mix(mix(-0.28, -2.8, p), -0.35, s), 0, mix(mix(0.2, 0.95, p), 0.1, s), w);
      to(B.elL, mix(-0.45, -0.3, p), 0, 0, w);
      to(B.spine, mix(0, -0.12, p) + 0.35 * s, 0, 0, w);
      to(B.head, mix(0, -0.4, p) + 0.5 * s, 0, 0, w);
      B.hips.position.y += 0.2 * p * (1 - s) * w - 0.2 * s * w;
      void rise;
    }
  },
  extra(A, rig) {
    const B = rig.b, s = A.s, t = A.time + A.seed, dt = A.dt;
    // staff: keep its world pitch under control whatever the arm does
    const v = A.variant, p = A.pull * A.wAtk, st = A.strike * A.wAtk;
    let pitch = 0.1 + 0.03 * Math.sin(t * 0.8);
    if (A.wAtk > 0.002) {
      if (v === 0) pitch = mix(pitch, mix(-0.5, 2.5, st), A.wAtk);
      else if (v === 1) pitch = mix(pitch, 1.55, A.wAtk);
      else pitch = mix(pitch, 0.0, A.wAtk);
    }
    const sum = B.hips.rotation.x + B.spine.rotation.x + B.chest.rotation.x + B.shR.rotation.x + B.elR.rotation.x + rig.root.rotation.x;
    B.staff.rotation.set(pitch - sum, 0, 0);
    // gold + gem glow (shield state) -> shader
    const gold = rig.goldProxy;
    if (gold) A.material.userData.u.uShield.value.copy(gold.emissive);
    // cloak spring chain (heavy, slow)
    if (!s.cape) s.cape = { a: [0.05, 0.05, 0.05], v: [0, 0, 0], z: [0, 0, 0], zv: [0, 0, 0] };
    const c = s.cape;
    for (let i = 0; i < 3; i++) {
      const target = 0.06 + Math.max(-0.1, Math.min(1, A.lvz / 3.2)) * (0.22 + i * 0.05) + 0.03 * Math.sin(t * 1.4 + i * 1.2) + 0.25 * p;
      c.v[i] += ((target - c.a[i]) * 40 - c.v[i] * 5.5) * dt;
      c.a[i] += c.v[i] * dt;
      c.zv[i] += ((-A.lvx * 0.04 + A.turn * 0.01 - c.z[i]) * 30 - c.zv[i] * 5) * dt;
      c.z[i] += c.zv[i] * dt;
      B['cape' + i].rotation.set(c.a[i], 0, c.z[i]);
    }
    // wings breathe slowly, flare during seals
    const flare = v === 2 ? p : 0;
    const f = Math.sin(t * 0.9);
    B.wgL.rotation.set(0, 0.5 - 0.3 * flare, 0.3 + 0.12 * f + 0.55 * flare);
    B.wgR.rotation.set(0, -0.5 + 0.3 * flare, -0.3 - 0.12 * f - 0.55 * flare);
    // chest glow while casting
    A.material.userData.u.uGlow.value = 1 + 0.5 * p + 0.5 * st;
  },
};
NETI_P.pose = (A, rig, P) => {
  humanoid(A, rig, P);
  const B = rig.b;
  if (A.deadK > 0) {
    const d = smooth(A.deadK);
    // kneel, slump, then topple forward onto the staff
    rig.root.rotation.x = 0;
    B.hips.position.y -= 1.0 * smooth(A.deadK * 2.2);
    add(B.thL, -1.1 * d, 0, 0); add(B.thR, -1.0 * d, 0, 0);
    add(B.shnL, 1.9 * d, 0, 0); add(B.shnR, 1.8 * d, 0, 0);
    add(B.spine, 0.9 * smooth((A.deadK - 0.3) / 0.7), 0, 0);
    add(B.head, 0.5 * d, 0, 0);
    add(B.shL, 0.2 * d, 0, 0.2 * d); add(B.shR, 0.3 * d, 0, -0.2 * d);
    rig.root.position.z = 0.9 * smooth((A.deadK - 0.4) / 0.6);
  }
  if (A.mode === MODE.SPAWN) {
    const r = 1 - A.spawnK;
    B.hips.position.y -= 0.8 * r; add(B.spine, 0.35 * r, 0, 0); add(B.head, 0.4 * r, 0, 0);
  }
};

// =============================================================================
const DEFS = { gallu: [galluDef, GALLU_P], utukku: [utukkuDef, UTUKKU_P], lilitu: [lilituDef, LILITU_P], scorpion: [scorpionDef, SCORP_P], asag: [asagDef, ASAG_P], neti: [netiDef, NETI_P] };
const HEIGHT = { gallu: 2.5, utukku: 2.3, lilitu: 2.5, scorpion: 2.5, asag: 3.5, neti: 4.9 };
const TRANSLUCENT = { utukku: 0.8 };
const BOOST = { gallu: 2.4, utukku: 1.1, lilitu: 2.2, scorpion: 2.1, asag: 2.6, neti: 2.0 };
const EDGE = { utukku: 0x66f0ff, lilitu: 0xb04dff, neti: 0xb08cff };

export function enemyTris(type) {
  return (defCache[type] ??= DEFS[type][0]()).tris;
}

// Shared elite aura pieces (additive ring on the ground + three orbiting shards).
const auraCache = new Map();
function auraFor(color) {
  let a = auraCache.get(color);
  if (a) return a;
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
  const ring = new THREE.RingGeometry(0.88, 1.0, 28);
  ring.rotateX(-Math.PI / 2);
  const shardGeo = new THREE.OctahedronGeometry(0.11, 0);
  shardGeo.scale(0.7, 1.7, 0.7);
  a = { mat, ring, shardGeo };
  auraCache.set(color, a);
  return a;
}

// Returns a Group (at the enemy position) holding the rig. userData:
//   mat (material whose .emissive is flashed), anim, rig, orb, gold, height
export function makeEnemyModel(type, color, opts = {}) {
  const [make, P] = DEFS[type];
  const def = (defCache[type] ??= make());
  const translucent = TRANSLUCENT[type];
  const mat = rigMaterial({ transparent: translucent !== undefined, opacity: translucent ?? 1, tint: new THREE.Color(color).multiplyScalar(BOOST[type] ?? 1), edge: EDGE[type] ?? 0xff7a1a, glow: 1 });
  mat.userData.baseGlow = 1;
  const rig = new Rig(def, mat);
  const anim = new Animator(rig, P, 'enemy');
  anim.material = mat;
  const g = new THREE.Group();
  g.add(rig.root);
  const u = mat.userData.u;
  u.uHeight.value = HEIGHT[type];
  g.userData.mat = mat;
  g.userData.anim = anim;
  g.userData.rig = rig;
  g.userData.height = HEIGHT[type];
  g.userData.type = type;
  if (type === 'lilitu') {
    const orbMat = new THREE.MeshBasicMaterial({ color: 0xb860ff });
    const orb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.17, 1), orbMat);
    const halo = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6), new THREE.MeshBasicMaterial({ color: 0x8a3dff, transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending, depthWrite: false }));
    orb.add(halo);
    rig.b.orb.add(orb);
    rig.orbMesh = orb;
    g.userData.orb = orb;
  }
  if (type === 'neti') {
    const gem = rig.b.staff;
    void gem;
    rig.goldProxy = { emissive: new THREE.Color(0x000000) };
    g.userData.gold = rig.goldProxy;
  }
  if (opts.aura) {
    const a = auraFor(opts.aura);
    const holder = new THREE.Group();
    const ring = new THREE.Mesh(a.ring, a.mat);
    ring.position.y = 0.05;
    holder.add(ring);
    const spin = new THREE.Group();
    spin.position.y = 0.0;
    for (let i = 0; i < 4; i++) {
      const sh = new THREE.Mesh(a.shardGeo, a.mat);
      const ang = (i / 4) * TAU;
      sh.position.set(Math.sin(ang), 1.1 + (i % 2) * 0.5, Math.cos(ang));
      spin.add(sh);
    }
    holder.add(spin);
    g.add(holder);
    g.userData.aura = { holder, spin, radius: DEFS[type] && 1 };
    anim.aura = g.userData.aura;
  }
  return g;
}

// ---------------------------------------------------------------------------------
// Gameplay -> animation adapter, called from the Visuals block of updateEnemy.
// st: windup progress parameters
const SPLIT = { default: 0.72, asag: 0.8, neti: 0.72 };
export function driveEnemy(e, dt, g, dist) {
  const A = e.group.userData.anim;
  A.near = dist < 25;
  A.flash = e.flash;
  A.alive = e.alive;
  if (e.spawning > 0) {
    A.mode = MODE.SPAWN;
    A.spawnK = 1 - Math.max(0, e.spawning) / (e.spawnTotal || 0.6);
    A.deadK = 0;
  } else if (!e.alive) {
    A.mode = MODE.DEAD;
    A.deadK = 1 - Math.max(0, e.dying) / (e.dyingTotal || 0.5);
  } else {
    A.deadK = 0; A.spawnK = 1;
    if (e.state === 'windup' || e.state === 'recover') {
      A.mode = MODE.ATTACK;
      let wt, rt;
      if (e.boss) { wt = e.windupTime || 1; rt = 0.7 * (e.enraged ? 0.72 : 1); A.variant = e.attack === 'slam' ? 0 : e.attack === 'sweep' ? 1 : 2; }
      else { wt = e.def.windup * (e.speedMult > 1 ? 0.8 : 1); rt = e.def.recover; }
      if (e.state === 'windup') {
        const k = clamp01(e.stateTime / wt);
        const split = e.boss && A.variant === 2 ? 0.86 : (SPLIT[e.type] ?? SPLIT.default);
        A.pullIn = smooth(k / split);
        A.strikeIn = smooth((k - split) / (1 - split));
        A.k = k;
      } else {
        const r = clamp01(e.stateTime / rt);
        A.pullIn = 0;
        A.strikeIn = 1 - smooth(range(r, 0.2, 0.95));
        A.k = 1 + r;
      }
    } else {
      A.mode = MODE.LOCO; A.pullIn = 0; A.strikeIn = 0;
    }
  }
  A.update(dt, g.time, e.pos.x, e.pos.z, e.facing, g);
  const aura = A.aura;
  if (aura) aura.spin.rotation.y = g.time * 1.4;
}

export function setDissolveState(e, amount, edgeHex) {
  const u = e.group.userData.mat.userData.u;
  u.uDissolve.value = amount;
  u.uBase.value = e.pos.y;
}
