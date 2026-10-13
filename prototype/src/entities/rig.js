import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { damp, angleDelta } from '../core/util.js';

// Lightweight procedural skeleton: nested Bones with rigid low-poly parts, plus an
// Animator that blends procedural poses from gameplay state every frame. All parts
// are merged into ONE skinned mesh (each vertex follows a single bone), so a whole
// character costs one draw call (plus one for its shadow) however many bones it has.
// No allocations in the update path.
//
// Conventions (character space): +Z forward, +Y up, the character's LEFT is +X.
// Limb meshes hang down -Y from their bone origin, so for a limb bone
//   rotation.x < 0  swings it forward, rotation.x > 0 swings it backward.
// Forward lean of a torso bone is rotation.x > 0.

export const MODE = { LOCO: 0, ATTACK: 1, CAST: 2, EVADE: 3, LEAP: 4, SPAWN: 5, DEAD: 6 };

const TAU = Math.PI * 2;
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const mix = (a, b, t) => a + (b - a) * t;
export const smooth = (t) => { t = clamp01(t); return t * t * (3 - 2 * t); };
export const easeOut = (t) => { t = clamp01(t); return 1 - (1 - t) * (1 - t); };
export const easeIn = (t) => { t = clamp01(t); return t * t; };
export const range = (v, a, b) => clamp01((v - a) / (b - a));

// Blend a bone's rotation toward a target by weight w.
export function to(b, x, y, z, w) {
  if (!b) return;
  const r = b.rotation;
  r.set(r.x + (x - r.x) * w, r.y + (y - r.y) * w, r.z + (z - r.z) * w);
}
// Add to a bone's rotation.
export function add(b, x, y, z) {
  if (!b) return;
  const r = b.rotation;
  r.set(r.x + x, r.y + y, r.z + z);
}

// ---------------------------------------------------------------------------------
// Rig: bones + meshes
// def: { bones: [[name, parent|null, x, y, z], ...], geos: { bone: BufferGeometry }, orders?: { bone: 'YXZ' } }
export class Rig {
  constructor(def, material) {
    this.root = new THREE.Group();
    this.b = {};
    this.list = [];
    this.meshes = [];
    this.rest = {};
    for (const [name, parent, x, y, z] of def.bones) {
      const grp = new THREE.Bone();
      grp.name = name;
      grp.position.set(x, y, z);
      (parent ? this.b[parent] : this.root).add(grp);
      this.b[name] = grp;
      this.rest[name] = [x, y, z];
      this.list.push(grp);
    }
    if (def.orders) for (const [n, o] of Object.entries(def.orders)) this.b[n].rotation.order = o;
    // Bake every part into rest-pose rig space, tagged with its bone. Rigs built
    // from the same def share the result.
    this.root.updateMatrixWorld(true); // bind() below reads the rest-pose bone matrices
    let merged = def.skinned;
    if (!merged) {
      const parts = [];
      for (const [bone, geo] of Object.entries(def.geos)) {
        if (!this.b[bone]) throw new Error(`rig: no bone ${bone}`);
        parts.push(rigidPart(geo, this.b[bone].matrixWorld, this.list.indexOf(this.b[bone])));
      }
      merged = def.skinned = mergeGeometries(parts, false);
      for (const p of parts) p.dispose();
      merged.computeBoundingSphere();
    }
    const mesh = new THREE.SkinnedMesh(merged, material);
    mesh.castShadow = true;
    mesh.renderOrder = 2; // characters draw after the world and after occlusion silhouettes (fx/silhouette.js)
    this.root.add(mesh);
    mesh.bind(new THREE.Skeleton(this.list));
    // Poses move limbs well outside the rest shape; cull with a roomier sphere.
    mesh.boundingSphere = merged.boundingSphere.clone();
    mesh.boundingSphere.radius *= 1.5;
    this.meshes.push(mesh);
  }

  reset() {
    this.root.rotation.set(0, 0, 0);
    this.root.position.set(0, 0, 0);
    for (let i = 0; i < this.list.length; i++) this.list[i].rotation.set(0, 0, 0);
  }

  setShadows(on) { for (const m of this.meshes) m.castShadow = on; }

  // Frees the per-rig bone texture (the geometry is shared and stays).
  dispose() { for (const m of this.meshes) m.skeleton.dispose(); }
}

// A copy of `geo` moved into rig space, every vertex bound fully to bone `index`.
function rigidPart(geo, matrix, index) {
  const g = geo.clone().applyMatrix4(matrix);
  const n = g.attributes.position.count;
  const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) { si[i * 4] = index; sw[i * 4] = 1; }
  g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  return g;
}

// ---------------------------------------------------------------------------------
// Gait helpers. A leg "angle" is positive when the foot is in FRONT of the hip.
// Phase p: 0 = foot plants in front, stance until 0.5 (foot slides back linearly at
// body speed so it does not skate), then swing forward with an eased arc.
let _ang = 0, _lift = 0;
export function legCurve(p, amp) {
  if (p < 0.5) { _ang = amp * (1 - 4 * p); _lift = 0; } else {
    const s = (p - 0.5) * 2;
    _ang = -amp + 2 * amp * (s * s * (3 - 2 * s));
    _lift = Math.sin(Math.PI * s);
  }
}
export const legAng = () => _ang;
export const legLift = () => _lift;

// Throttle footsteps globally: at most 4 per game-time frame bucket.
const _step = { t: -1, n: 0 };

// ---------------------------------------------------------------------------------
export class Animator {
  // P: pose params. Required: pose(A, rig). Optional: leg (hip->sole length), amp [min,max,vRef],
  // heavy, height, who ('player'|'enemy'), cadence
  constructor(rig, P, who = 'enemy') {
    this.rig = rig;
    this.P = P;
    this.who = who;
    this.seed = Math.random() * 100;
    // ---- inputs written by the entity adapter each frame
    this.mode = MODE.LOCO;
    this.k = 0;           // progress of the current action (0..1)
    this.variant = 0;     // attack variant / combo step
    this.pullIn = 0;      // attack wind-back target (0..1)
    this.strikeIn = 0;    // attack strike target (0..1)
    this.castHold = false;
    this.deadK = 0;       // 0..1 death collapse progress
    this.spawnK = 1;      // 0..1 rise progress (1 = fully risen)
    this.flash = 0;       // entity hit flash (rises on damage => flinch)
    this.near = true;     // close enough for footstep events
    this.alive = true;
    // ---- smoothed state
    this.time = 0;
    this.dt = 0.016;
    this.speed = 0; this.sp = 0;
    this.lvx = 0; this.lvz = 0;     // local velocity (x = sideways, z = forward)
    this.turn = 0;                  // yaw rate (rad/s), smoothed
    this.phase = 0;
    this.amp = 0.3;
    this.wLoco = 0;
    this.wAtk = 0; this.wCast = 0; this.wEvade = 0; this.wLeap = 0;
    this.pull = 0; this.strike = 0;
    this.hit = 0;
    this.land = 0;
    this.airK = 0;
    this._px = NaN; this._pz = NaN; this._pf = 0;
    this._lastFlash = 0;
    this._stepN = 0;
    this._stepT = 0;
    this._prevMode = MODE.LOCO;
    this.s = {};          // type-specific scratch state (springs...)
    this.skip = false;
  }

  // Entity world position/facing -> speed etc, then pose.
  update(dt, time, x, z, facing, g) {
    if (dt <= 0) return;
    this.dt = dt;
    this.time = time;
    const P = this.P;
    // ---- velocity from real displacement (so feet match actual motion)
    let vx = 0, vz = 0;
    if (!Number.isNaN(this._px)) {
      vx = (x - this._px) / dt; vz = (z - this._pz) / dt;
      if (vx * vx + vz * vz > 900) { vx = 0; vz = 0; }
    }
    this._px = x; this._pz = z;
    const raw = Math.hypot(vx, vz);
    this.speed += (raw - this.speed) * damp(14, dt);
    const sn = Math.sin(facing), cs = Math.cos(facing);
    const lx = vx * cs - vz * sn, lz = vx * sn + vz * cs;
    this.lvx += (lx - this.lvx) * damp(8, dt);
    this.lvz += (lz - this.lvz) * damp(8, dt);
    const yr = angleDelta(this._pf, facing) / dt;
    this._pf = facing;
    this.turn += (Math.max(-12, Math.min(12, yr)) - this.turn) * damp(8, dt);

    const amp = P.amp || [0.2, 0.7, 5];
    const vRef = amp[2];
    this.sp = Math.min(1.25, this.speed / vRef);
    this.amp = amp[0] + (amp[1] - amp[0]) * Math.min(1, this.sp);

    // ---- layer weights
    const m = this.mode;
    const tAtk = m === MODE.ATTACK ? 1 : 0;
    this.wAtk += (tAtk - this.wAtk) * damp(tAtk ? 34 : 13, dt);
    this.wCast += ((m === MODE.CAST ? 1 : 0) - this.wCast) * damp(m === MODE.CAST ? 26 : 12, dt);
    this.wEvade += ((m === MODE.EVADE ? 1 : 0) - this.wEvade) * damp(m === MODE.EVADE ? 40 : 16, dt);
    this.wLeap += ((m === MODE.LEAP ? 1 : 0) - this.wLeap) * damp(m === MODE.LEAP ? 24 : 14, dt);
    this.pull += (this.pullIn - this.pull) * damp(26, dt);
    this.strike += (this.strikeIn - this.strike) * damp(30, dt);
    if (this._prevMode === MODE.LEAP && m !== MODE.LEAP) this.land = 1;
    this._prevMode = m;
    this.land = Math.max(0, this.land - dt * 3.2);
    if (this.flash > this._lastFlash + 0.35) this.hit = 1;
    this._lastFlash = this.flash;
    this.hit = Math.max(0, this.hit - dt * 5.5);

    // ---- locomotion weight + gait phase
    const wTarget = m === MODE.LOCO || m === MODE.ATTACK || m === MODE.CAST ? (this.speed > 0.35 ? 1 : 0) : 0;
    this.wLoco += (wTarget - this.wLoco) * damp(9, dt);
    if (this.speed > 0.12 && P.leg) {
      const f = this.speed / (4 * P.leg * Math.sin(this.amp)) * (P.cadence || 1);
      const prev = Math.floor(this.phase * 2);
      this.phase = (this.phase + Math.min(f, 5) * dt) % 1;
      if (Math.floor(this.phase * 2) !== prev && this.wLoco > 0.5 && m !== MODE.LEAP && m !== MODE.EVADE) this.footstep(g, x, z);
    }

    // ---- pose
    this.rig.reset();
    P.pose(this, this.rig, P);
    // hit flinch (additive on the whole body)
    if (this.hit > 0.01) {
      const h = this.hit;
      const r = this.rig.root;
      r.rotation.x -= 0.3 * h * h;
      r.position.z -= 0.14 * h;
      add(this.rig.b.chest, -0.22 * h, 0.1 * h, 0);
      add(this.rig.b.head, -0.18 * h, 0, 0);
    }
  }

  footstep(g, x, z) {
    if (!g || !this.near) return;
    const now = this.time;
    if (now - this._stepT < 0.16) return;
    if (_step.t !== Math.floor(now * 20)) { _step.t = Math.floor(now * 20); _step.n = 0; }
    if (this.who !== 'player' && _step.n >= 3) return;
    _step.n++;
    this._stepT = now;
    g.events.emit('footstep', { pos: new THREE.Vector3(x, this.rig.root.parent ? this.rig.root.parent.position.y : 0, z), who: this.who, heavy: !!this.P.heavy });
  }
}

// ---------------------------------------------------------------------------------
// Generic biped pose: idle breathing, walk -> run, layered actions via hooks.
// Required bones: hips spine chest head shL shR elL elR thL thR shnL shnR ftL ftR.
export function humanoid(A, rig, P) {
  const B = rig.b;
  const t = A.time + A.seed;
  const wL = A.wLoco;
  const sp = Math.min(1, A.sp);
  const breath = Math.sin(t * (P.breathRate || 1.7));
  const sway = Math.sin(t * 0.55);
  const amp = A.amp;
  const p = A.phase;
  legCurve(p, amp);
  const angL = _ang, liftL = _lift;
  legCurve((p + 0.5) % 1, amp);
  const angR = _ang, liftR = _lift;
  const q = (p % 0.5) * 2;
  const stanceAng = amp * (1 - 2 * q);
  const drop = P.leg * (1 - Math.cos(stanceAng)) * (P.bob ?? 1);
  const swing = (angL - angR) / (2 * amp);        // +1 = left foot forward
  const kneeK = P.knee ?? 1.0;
  const lean = (P.baseLean || 0) + mix(0.015 * breath, (P.lean ?? 0.14) * sp, wL);

  // hips / spine
  B.hips.position.y = P.hipsY - drop * wL + (P.idleDip || 0) * (1 - wL) + 0.012 * breath * (1 - wL);
  B.hips.rotation.set(0, -swing * (P.twist ?? 0.2) * wL, 0.05 * Math.sin(p * TAU) * wL * (P.roll ?? 1));
  B.spine.rotation.set(lean * 0.55, swing * (P.twist ?? 0.2) * 1.3 * wL + 0.03 * sway, -0.05 * Math.sin(p * TAU) * wL * (P.roll ?? 1));
  B.chest.rotation.set(lean * 0.55 + 0.012 * breath, 0, 0);
  B.chest.rotation.z = 0.014 * sway;
  if (B.neck) B.neck.rotation.set(-lean * 0.5 + (P.headUp || 0), 0, 0);
  B.head.rotation.set(-lean * 0.55 + 0.02 * Math.sin(t * 0.8), 0.07 * Math.sin(t * 0.37) , 0);

  // turn banking
  const bank = Math.max(-0.12, Math.min(0.12, -A.turn * 0.012));
  B.spine.rotation.z += bank;
  B.head.rotation.z -= bank * 0.6;

  // legs
  if (P.legs !== false) {
    const sL = P.stance ?? 0.04;
    B.thL.rotation.set(-angL * wL + (P.idleLeg || 0) * (1 - wL), 0, -sL);
    B.thR.rotation.set(-angR * wL + (P.idleLeg || 0) * (1 - wL), 0, sL);
    const knL = (liftL * 1.15 * kneeK + 0.08 + sp * 0.18) * wL + (P.idleKnee || 0) * (1 - wL);
    const knR = (liftR * 1.15 * kneeK + 0.08 + sp * 0.18) * wL + (P.idleKnee || 0) * (1 - wL);
    B.shnL.rotation.x = knL;
    B.shnR.rotation.x = knR;
    B.ftL.rotation.x = (angL - knL * 0.9) * wL - (liftL > 0 ? 0.2 * liftL : 0) * wL;
    B.ftR.rotation.x = (angR - knR * 0.9) * wL - (liftR > 0 ? 0.2 * liftR : 0) * wL;
    if (P.idleKnee) { B.ftL.rotation.x -= P.idleKnee * 0.5 * (1 - wL); B.ftR.rotation.x -= P.idleKnee * 0.5 * (1 - wL); }
  }

  // arms
  const ar = P.armAmp ?? 0.8;
  const armL = P.armL ?? 1, armR = P.armR ?? 1;
  const elIdle = P.elbowIdle ?? 0.25, elRun = P.elbowRun ?? 0.9;
  const shr = P.shoulderRaise ?? 0.02 * breath;
  const idleArmX = P.armIdle ?? 0.05;
  B.shL.rotation.set(0, 0, (P.armSpread ?? 0.09) + shr);
  B.shR.rotation.set(0, 0, -(P.armSpread ?? 0.09) - shr);
  B.shL.rotation.x = mix(idleArmX + 0.02 * breath, -angR * ar * armL, wL);
  B.shR.rotation.x = mix(idleArmX + 0.02 * breath, -angL * ar * armR, wL);
  const elL = -(elIdle + (elRun - elIdle) * sp * wL) - 0.15 * Math.max(0, -B.shL.rotation.x);
  const elR = -(elIdle + (elRun - elIdle) * sp * wL) - 0.15 * Math.max(0, -B.shR.rotation.x);
  B.elL.rotation.x = elL * (P.elbowL ?? 1);
  B.elR.rotation.x = elR * (P.elbowR ?? 1);

  // ---- action layers
  if (P.idle) P.idle(A, rig, 1 - wL, P);
  if (A.mode === MODE.SPAWN) (P.spawn || defaultSpawn)(A, rig, P);
  if (A.wAtk > 0.002 && P.attack) P.attack(A, rig, A.wAtk, P);
  if (A.wCast > 0.002 && P.cast) P.cast(A, rig, A.wCast, P);
  if (A.wEvade > 0.002 && P.evade) P.evade(A, rig, A.wEvade, P);
  if (A.wLeap > 0.002 || A.land > 0.01) if (P.leap) P.leap(A, rig, A.wLeap, P);
  if (A.deadK > 0 && P.dead !== false) (P.dead || defaultDead)(A, rig, P);
  if (P.extra) P.extra(A, rig, P);
}

function defaultDead(A, rig, P) {
  const B = rig.b;
  const d = smooth(A.deadK);
  const buck = smooth(A.deadK * 3);
  const dir = P.deadDir ?? -1;
  B.hips.position.y -= (P.hipsY * 0.35) * buck;
  add(B.thL, -0.5 * buck, 0, 0); add(B.thR, -0.4 * buck, 0, 0);
  add(B.shnL, 1.3 * buck, 0, 0); add(B.shnR, 1.1 * buck, 0, 0);
  add(B.shL, 0.5 * d, 0, 0.3 * d); add(B.shR, 0.3 * d, 0, -0.3 * d);
  add(B.head, 0.4 * d * -dir, 0, 0);
  rig.root.rotation.x += dir * 1.5 * smooth((A.deadK - 0.1) / 0.8);
  rig.root.position.y += 0.1 * d;
}

function defaultSpawn(A, rig, P) {
  const B = rig.b;
  const r = 1 - A.spawnK;
  B.hips.position.y -= P.hipsY * 0.3 * r;
  add(B.spine, 0.7 * r, 0, 0);
  add(B.head, 0.4 * r, 0, 0);
  add(B.thL, -0.5 * r, 0, 0); add(B.thR, -0.5 * r, 0, 0);
  add(B.shnL, 0.9 * r, 0, 0); add(B.shnR, 0.9 * r, 0, 0);
}
