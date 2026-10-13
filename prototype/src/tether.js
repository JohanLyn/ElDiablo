import * as THREE from 'three';
import { clamp, clampLength, damp, distPointSegment } from './util.js';

// Twist #1: the hero is bound to a sedu spirit (the familiar). The right stick
// (or mouse) positions it; the line between hero and familiar is the weapon.
export const MODES = [
  { id: 'lapis', name: 'Lapis Tether', color: 0x5d95ff, css: '#5d95ff', desc: 'Pure damage. Whip the familiar fast for up to 2.5x damage.' },
  { id: 'fire', name: 'Tether of Gibil', color: 0xff7a2a, css: '#ff8a3a', desc: 'Sets enemies alight and leaves burning ground where the familiar sweeps.' },
  { id: 'chain', name: 'Chain of Ereshkigal', color: 0xb36bff, css: '#c08bff', desc: 'Drags struck enemies toward you and slows them.' },
  { id: 'bulwark', name: 'Bulwark of Nergal', color: 0xffcf4a, css: '#ffcf4a', desc: 'A wall of light: blocks bolts and shoves enemies away.' },
];

const MAX_REACH = 6.5;
const HEIGHT = 1.1;
const HIT_INTERVAL = 0.2; // per-enemy damage tick
const SNAP_COOLDOWN = 3.5;
const MAX_PATCHES = 70;

export class Tether {
  constructor(scene) {
    this.scene = scene;
    this.modeIndex = 0;
    this.snapCd = 0;
    this.sweep = 0; // 0..1.5 bonus from whipping
    this.flare = 0; // snap flash
    this.A = new THREE.Vector3();
    this.B = new THREE.Vector3(0, HEIGHT, 2);
    this.prevB = this.B.clone();
    this.lastPatch = new THREE.Vector3(999, 0, 999);

    // Familiar: a winged sedu spirit with a glowing core.
    this.familiar = new THREE.Group();
    this.coreMat = new THREE.MeshBasicMaterial({ color: MODES[0].color });
    const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.28), this.coreMat);
    this.wingMat = new THREE.MeshBasicMaterial({ color: 0xffe7b0, transparent: true, opacity: 0.55, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false });
    const wingGeo = new THREE.PlaneGeometry(0.9, 0.35);
    wingGeo.translate(0.5, 0, 0);
    this.wings = [-1, 1].map((s) => {
      const w = new THREE.Mesh(wingGeo, this.wingMat);
      w.scale.x = s;
      this.familiar.add(w);
      return w;
    });
    this.halo = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.03, 6, 24), this.coreMat);
    this.halo.rotation.x = Math.PI / 2;
    this.light = new THREE.PointLight(MODES[0].color, 6, 7, 1.5);
    this.familiar.add(core, this.halo, this.light);
    this.core = core;
    scene.add(this.familiar);

    // The line: a bright core and a wide additive glow.
    const cyl = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true);
    this.lineCoreMat = new THREE.MeshBasicMaterial({ color: coreTint(MODES[0].color), transparent: true, opacity: 0.9, depthWrite: false });
    this.lineGlowMat = new THREE.MeshBasicMaterial({ color: MODES[0].color, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending });
    this.lineCore = new THREE.Mesh(cyl, this.lineCoreMat);
    this.lineGlow = new THREE.Mesh(cyl, this.lineGlowMat);
    scene.add(this.lineCore, this.lineGlow);

    // Burning ground patches (Tether of Gibil).
    this.patches = [];
    this.patchGeo = new THREE.PlaneGeometry(2.2, 2.2);
    this.patchGeo.rotateX(-Math.PI / 2);
    this.patchTex = makeEmberTexture();

    this._tmp = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);
  }

  get mode() { return MODES[this.modeIndex]; }

  reset(player) {
    this.snapCd = 0;
    this.sweep = 0;
    for (const p of this.patches) this.scene.remove(p.mesh);
    this.patches = [];
    this.B.set(player.pos.x, HEIGHT, player.pos.z + 1.5);
    this.prevB.copy(this.B);
  }

  setMode(i, g) {
    this.modeIndex = (i + MODES.length) % MODES.length;
    const m = this.mode;
    this.coreMat.color.set(m.color);
    this.lineGlowMat.color.set(m.color);
    this.lineCoreMat.color.copy(coreTint(m.color));
    this.light.color.set(m.color);
    g.hud.toast(m.name, m.desc, m.css);
    g.fx.burst(this.B, m.color, 16, 3, { life: 0.5, gravity: 0 });
    g.fx.rumble(0.1, 0.25, 40);
  }

  update(dt, g) {
    const { player, input } = g;
    if (input.pressed.modeNext) this.setMode(this.modeIndex + 1, g);
    if (input.pressed.modePrev) this.setMode(this.modeIndex - 1, g);
    this.snapCd = Math.max(0, this.snapCd - dt);
    this.flare = Math.max(0, this.flare - dt * 3);

    this.A.set(player.pos.x, HEIGHT, player.pos.z);

    // Where the familiar wants to be.
    let tx, tz;
    if (input.aim.active && !player.dead) {
      if (input.aim.mouse) {
        const c = clampLength(input.aim.x, input.aim.z, MAX_REACH);
        tx = c.x; tz = c.z;
      } else {
        tx = input.aim.x * MAX_REACH; tz = input.aim.z * MAX_REACH;
      }
    } else {
      // Rest: hover just behind the hero's right shoulder.
      const f = player.facing;
      tx = Math.sin(f) * -0.9 + Math.cos(f) * 1.0;
      tz = Math.cos(f) * -0.9 - Math.sin(f) * 1.0;
    }
    this.prevB.copy(this.B);
    const follow = damp(input.aim.mouse ? 14 : 22, dt);
    this.B.x += (player.pos.x + tx - this.B.x) * follow;
    this.B.z += (player.pos.z + tz - this.B.z) * follow;
    this.B.y = HEIGHT + Math.sin(g.time * 3) * 0.12;

    // Whip bonus from how fast the familiar is moving.
    const tipSpeed = dt > 0 ? this.prevB.distanceTo(this.B) / dt : 0;
    const targetSweep = clamp((tipSpeed - 5) / 14, 0, 1.5);
    this.sweep += (targetSweep - this.sweep) * damp(targetSweep > this.sweep ? 20 : 5, dt);

    const len = Math.hypot(this.B.x - this.A.x, this.B.z - this.A.z);
    const live = !player.dead && input.aim.active && len > 1.2;

    if (live) {
      this.applyLineHits(g);
      if (this.mode.id === 'fire' && this.B.distanceTo(this.lastPatch) > 0.9 && len > 2) {
        this.addPatch(this.B.x, this.B.z, 2.8);
        this.lastPatch.copy(this.B);
      }
    }
    if (input.pressed.snap && this.snapCd <= 0 && !player.dead) this.snap(g);

    this.updatePatches(dt, g);
    this.updateVisuals(dt, g, len, live);
  }

  applyLineHits(g) {
    const m = this.mode.id;
    const half = m === 'bulwark' ? 0.45 : 0.3;
    const mult = 1 + this.sweep;
    for (const e of g.enemies.list) {
      if (!e.alive || e.spawning > 0 || e.tetherCd > 0) continue;
      const r = distPointSegment(e.pos.x, e.pos.z, this.A.x, this.A.z, this.B.x, this.B.z);
      if (r.t <= 0 || r.dist > e.radius + half) continue;
      e.tetherCd = HIT_INTERVAL;
      g.fx.burst(this._tmp.set(r.cx, HEIGHT, r.cz), this.mode.color, 4, 3, { life: 0.3 });
      if (m === 'lapis') {
        e.hit(5 * mult, g, { color: this.mode.css, crit: this.sweep > 1.1 });
      } else if (m === 'fire') {
        e.burn = 3;
        e.hit(3 * (1 + this.sweep * 0.5), g, { color: this.mode.css });
      } else if (m === 'chain') {
        const dx = this.A.x - e.pos.x, dz = this.A.z - e.pos.z, d = Math.hypot(dx, dz) || 1;
        e.slow = 1.5;
        e.hit(3 * (1 + this.sweep * 0.5), g, { color: this.mode.css, knockX: (dx / d) * 6, knockZ: (dz / d) * 6 });
      } else if (m === 'bulwark') {
        const [nx, nz] = this.lineNormalToward(e.pos.x, e.pos.z, r);
        e.hit(2, g, { color: this.mode.css, knockX: nx * 7, knockZ: nz * 7, silent: true });
      }
    }
  }

  // Unit normal of the line pointing from the closest line point toward (x, z).
  lineNormalToward(x, z, r) {
    let nx = x - r.cx, nz = z - r.cz;
    const l = Math.hypot(nx, nz);
    if (l < 1e-4) { nx = -(this.B.z - this.A.z); nz = this.B.x - this.A.x; }
    const n = Math.hypot(nx, nz) || 1;
    return [nx / n, nz / n];
  }

  // Tether Snap: the line flares and unleashes its mode's effect at full power.
  snap(g) {
    this.snapCd = SNAP_COOLDOWN;
    this.flare = 1;
    const m = this.mode.id;
    g.fx.stop(0.07);
    g.fx.shake(0.4);
    g.fx.rumble(0.9, 0.7, 180);
    for (let k = 0; k <= 10; k++) {
      this._tmp.lerpVectors(this.A, this.B, k / 10);
      g.fx.burst(this._tmp, this.mode.color, 5, 4, { up: 3, life: 0.6 });
      if (m === 'fire' && k % 2 === 0 && k > 0) this.addPatch(this._tmp.x, this._tmp.z, 4);
    }
    for (const e of g.enemies.list) {
      if (!e.alive || e.spawning > 0) continue;
      const r = distPointSegment(e.pos.x, e.pos.z, this.A.x, this.A.z, this.B.x, this.B.z);
      if (r.dist > e.radius + 1.3) continue;
      if (m === 'lapis') {
        e.hit(30, g, { color: this.mode.css, crit: true });
      } else if (m === 'fire') {
        e.burn = 5;
        e.hit(15, g, { color: this.mode.css, crit: true });
      } else if (m === 'chain') {
        const dx = this.A.x - e.pos.x, dz = this.A.z - e.pos.z, d = Math.hypot(dx, dz) || 1;
        e.slow = 2.5;
        e.hit(12, g, { color: this.mode.css, crit: true, knockX: (dx / d) * 16, knockZ: (dz / d) * 16 });
      } else {
        const [nx, nz] = this.lineNormalToward(e.pos.x, e.pos.z, r);
        e.hit(12, g, { color: this.mode.css, crit: true, knockX: nx * 18, knockZ: nz * 18 });
      }
    }
    if (m === 'bulwark') {
      // Shockwave also erases every bolt near the hero.
      for (const b of g.enemies.projectiles) {
        if (Math.hypot(b.pos.x - this.A.x, b.pos.z - this.A.z) < 7) b.life = 0;
      }
    }
  }

  // Called by EnemyManager for each projectile. Only the Bulwark blocks bolts.
  blocksProjectile(pos, g) {
    if (this.mode.id !== 'bulwark' || g.player.dead) return false;
    const r = distPointSegment(pos.x, pos.z, this.A.x, this.A.z, this.B.x, this.B.z);
    if (r.t <= 0 || r.dist > 0.55) return false;
    g.fx.burst(pos, this.mode.color, 10, 4, { life: 0.35 });
    g.fx.rumble(0.1, 0.3, 40);
    return true;
  }

  addPatch(x, z, life) {
    if (this.patches.length >= MAX_PATCHES) {
      const old = this.patches.shift();
      this.scene.remove(old.mesh);
    }
    const mesh = new THREE.Mesh(this.patchGeo, new THREE.MeshBasicMaterial({
      color: 0xff7a2a, map: this.patchTex, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    mesh.position.set(x, 0.04, z);
    mesh.rotation.y = Math.random() * Math.PI;
    this.scene.add(mesh);
    this.patches.push({ mesh, x, z, life, max: life });
  }

  updatePatches(dt, g) {
    for (let i = this.patches.length - 1; i >= 0; i--) {
      const p = this.patches[i];
      p.life -= dt;
      if (p.life <= 0) { this.scene.remove(p.mesh); p.mesh.material.dispose(); this.patches.splice(i, 1); continue; }
      const k = p.life / p.max;
      p.mesh.material.opacity = 0.55 * Math.min(1, k * 3) * (0.8 + Math.random() * 0.2);
      p.mesh.scale.setScalar(0.8 + (1 - k) * 0.3);
      if (Math.random() < 0.15) g.fx.burst(this._tmp.set(p.x, 0.2, p.z), 0xff8a3a, 1, 0.6, { up: 2.5, life: 0.5, gravity: -2 });
    }
    // Enemies standing in fire keep burning.
    for (const e of g.enemies.list) {
      if (!e.alive || e.spawning > 0) continue;
      for (const p of this.patches) {
        if (Math.hypot(e.pos.x - p.x, e.pos.z - p.z) < 0.85 + e.radius) { e.burn = Math.max(e.burn, 1.2); break; }
      }
    }
  }

  updateVisuals(dt, g, len, live) {
    this.familiar.position.copy(this.B);
    this.familiar.visible = !g.player.dead;
    this.core.rotation.y += dt * 3;
    this.core.rotation.x += dt * 1.7;
    const flap = Math.sin(g.time * 14) * 0.6;
    this.wings[0].rotation.y = flap;
    this.wings[1].rotation.y = -flap;
    const yaw = Math.atan2(this.B.x - this.A.x, this.B.z - this.A.z);
    this.familiar.rotation.y = yaw;
    this.light.intensity = 4 + this.sweep * 5 + this.flare * 18;

    const show = !g.player.dead && len > 0.3;
    this.lineCore.visible = this.lineGlow.visible = show;
    if (!show) return;
    this._tmp.subVectors(this.B, this.A);
    const l3 = this._tmp.length();
    const dir = this._tmp.normalize();
    const mid = this.A.clone().lerp(this.B, 0.5);
    const thick = (this.mode.id === 'bulwark' ? 1.6 : 1) * (live ? 1 : 0.5);
    for (const [mesh, r] of [[this.lineCore, 0.04], [this.lineGlow, 0.16]]) {
      mesh.position.copy(mid);
      mesh.quaternion.setFromUnitVectors(this._up, dir);
      const rr = r * thick * (1 + this.sweep * 0.5 + this.flare * 2.5);
      mesh.scale.set(rr, l3, rr);
    }
    this.lineGlowMat.opacity = (live ? 0.22 : 0.1) + this.sweep * 0.2 + this.flare * 0.5 + Math.sin(g.time * 20) * 0.03;
    this.lineCoreMat.opacity = live ? 0.9 : 0.35;
  }
}

// Pale version of a mode colour for the bright line core (pure white blooms out).
function coreTint(hex) {
  return new THREE.Color(hex).lerp(new THREE.Color(0xffffff), 0.55);
}

// Soft, uneven ember glow for burning ground.
function makeEmberTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  for (let k = 0; k < 6; k++) {
    const x = 32 + (Math.random() - 0.5) * 16, y = 32 + (Math.random() - 0.5) * 16, r = 14 + Math.random() * 12;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(255,255,255,0.55)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
  }
  return new THREE.CanvasTexture(c);
}
