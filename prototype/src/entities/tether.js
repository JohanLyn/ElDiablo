import * as THREE from 'three';
import { clamp, clampLength, damp, distPointSegment } from '../core/util.js';
import { ASPECTS } from '../game/skills.js';
import { rollDamage } from '../game/stats.js';

// The Gatewalker's signature: a sedu spirit bound to the hero. Steer it with the
// right stick (or mouse); the line between you is a weapon. Left alone, the
// spirit sweeps toward nearby enemies by itself at reduced power.
const MAX_REACH = 6.5;
const HEIGHT = 1.1;
const HIT_INTERVAL = 0.25;
const TICK_COEF = 0.32;
const AUTO_MULT = 0.6;
const MAX_PATCHES = 70;

export class Tether {
  constructor(scene) {
    this.scene = scene;
    this.sweep = 0;
    this.flare = 0;
    this.A = new THREE.Vector3();
    this.B = new THREE.Vector3();
    this.prevB = new THREE.Vector3();
    this.lastPatch = new THREE.Vector3(1e9, 0, 1e9);
    this.autoAngle = 0;
    this.mode = 'rest';

    this.familiar = new THREE.Group();
    this.coreMat = new THREE.MeshBasicMaterial({ color: ASPECTS[0].color });
    this.core = new THREE.Mesh(new THREE.OctahedronGeometry(0.28), this.coreMat);
    const wingMat = new THREE.MeshBasicMaterial({ color: 0xffe7b0, transparent: true, opacity: 0.55, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false });
    const wingGeo = new THREE.PlaneGeometry(0.9, 0.35);
    wingGeo.translate(0.5, 0, 0);
    this.wings = [-1, 1].map((s) => { const w = new THREE.Mesh(wingGeo, wingMat); w.scale.x = s; this.familiar.add(w); return w; });
    const halo = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.03, 6, 24), this.coreMat);
    halo.rotation.x = Math.PI / 2;
    this.light = new THREE.PointLight(ASPECTS[0].color, 5, 7, 1.5);
    this.familiar.add(this.core, halo, this.light);
    scene.add(this.familiar);

    const cyl = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true);
    this.lineCoreMat = new THREE.MeshBasicMaterial({ color: coreTint(ASPECTS[0].color), transparent: true, opacity: 0.9, depthWrite: false });
    this.lineGlowMat = new THREE.MeshBasicMaterial({ color: ASPECTS[0].color, transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending });
    this.lineCore = new THREE.Mesh(cyl, this.lineCoreMat);
    this.lineGlow = new THREE.Mesh(cyl, this.lineGlowMat);
    scene.add(this.lineCore, this.lineGlow);

    this.patches = [];
    this.patchGeo = new THREE.PlaneGeometry(2.2, 2.2);
    this.patchGeo.rotateX(-Math.PI / 2);
    this.patchTex = makeEmberTexture();
    this._tmp = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);
  }

  aspect(g) { return ASPECTS[g.player.aspectIndex] ?? ASPECTS[0]; }

  unlockedAspects(level) { return ASPECTS.filter((a) => level >= a.unlock); }

  cycleAspect(g, dir) {
    const unlocked = this.unlockedAspects(g.player.level);
    if (unlocked.length < 2) { g.hud.notify('Reach level 3 to unlock more Tether Aspects', 'warn'); return; }
    const cur = unlocked.indexOf(this.aspect(g));
    const next = unlocked[(cur + dir + unlocked.length) % unlocked.length];
    g.player.aspectIndex = ASPECTS.indexOf(next);
    this.applyColors(g);
    g.hud.toast(next.name, next.desc, next.css);
    g.fx.rumble(0.1, 0.25, 40);
  }

  applyColors(g) {
    const a = this.aspect(g);
    this.coreMat.color.set(a.color);
    this.lineGlowMat.color.set(a.color);
    this.lineCoreMat.color.copy(coreTint(a.color));
    this.light.color.set(a.color);
  }

  reset(g) {
    for (const p of this.patches) this.scene.remove(p.mesh);
    this.patches = [];
    this.B.set(g.player.pos.x + 1, g.player.pos.y + HEIGHT, g.player.pos.z + 1);
    this.prevB.copy(this.B);
    this.applyColors(g);
  }

  update(dt, g) {
    const { player, input } = g;
    if (!g.uiOpen && input.pressed.aspectNext) this.cycleAspect(g, 1);
    if (!g.uiOpen && input.pressed.aspectPrev) this.cycleAspect(g, -1);
    this.flare = Math.max(0, this.flare - dt * 3);
    this.A.set(player.pos.x, player.pos.y + HEIGHT, player.pos.z);

    let tx, tz;
    this.mode = 'rest';
    if (input.aim.active && !player.dead && !g.inSafeZone && !g.uiOpen) {
      this.mode = 'manual';
      if (input.aim.mouse) { const c = clampLength(input.aim.x, input.aim.z, MAX_REACH); tx = c.x; tz = c.z; } else { tx = input.aim.x * MAX_REACH; tz = input.aim.z * MAX_REACH; }
    } else {
      // Auto: sweep back and forth through the nearest enemy.
      const target = !player.dead && !g.inSafeZone ? this.nearestEnemy(g, 7) : null;
      if (target) {
        this.mode = 'auto';
        const base = Math.atan2(target.pos.x - player.pos.x, target.pos.z - player.pos.z);
        this.autoAngle = base + Math.sin(g.time * 3.2) * 0.7;
        const reach = Math.min(MAX_REACH, Math.hypot(target.pos.x - player.pos.x, target.pos.z - player.pos.z) + 1.5);
        tx = Math.sin(this.autoAngle) * reach; tz = Math.cos(this.autoAngle) * reach;
      } else {
        const f = player.facing;
        tx = Math.sin(f) * -0.9 + Math.cos(f) * 1.0;
        tz = Math.cos(f) * -0.9 - Math.sin(f) * 1.0;
      }
    }
    this.prevB.copy(this.B);
    const follow = damp(this.mode === 'auto' ? 9 : input.aim.mouse ? 14 : 22, dt);
    this.B.x += (player.pos.x + tx - this.B.x) * follow;
    this.B.z += (player.pos.z + tz - this.B.z) * follow;
    this.B.y = g.world.heightAt(this.B.x, this.B.z) + HEIGHT + Math.sin(g.time * 3) * 0.12;

    const tipSpeed = dt > 0 ? this.prevB.distanceTo(this.B) / dt : 0;
    const targetSweep = this.mode === 'manual' ? clamp((tipSpeed - 5) / 14, 0, 1.5) : 0;
    this.sweep += (targetSweep - this.sweep) * damp(targetSweep > this.sweep ? 20 : 5, dt);

    const len = Math.hypot(this.B.x - this.A.x, this.B.z - this.A.z);
    const live = this.mode !== 'rest' && len > 1.2;
    if (live) {
      this.applyLineHits(g);
      const burning = this.aspect(g).id === 'fire' || g.abilities.pyreActive;
      if (burning && this.B.distanceTo(this.lastPatch) > 0.9 && len > 2) { this.addPatch(this.B.x, this.B.z, 2.8); this.lastPatch.copy(this.B); }
    }
    this.updatePatches(dt, g);
    this.updateVisuals(dt, g, len, live);
  }

  nearestEnemy(g, range) {
    let best = null, bd = range;
    for (const e of g.enemies.list) {
      if (!e.alive || e.spawning > 0) continue;
      const d = Math.hypot(e.pos.x - g.player.pos.x, e.pos.z - g.player.pos.z);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  applyLineHits(g) {
    const id = this.aspect(g).id;
    const stats = g.player.stats;
    const half = id === 'bulwark' ? 0.45 : 0.3;
    const mult = (1 + this.sweep) * stats.tetherMult * (this.mode === 'auto' ? AUTO_MULT : 1);
    const burning = id === 'fire' || g.abilities.pyreActive;
    for (const e of g.enemies.list) {
      if (!e.alive || e.spawning > 0 || e.tetherCd > 0) continue;
      const r = distPointSegment(e.pos.x, e.pos.z, this.A.x, this.A.z, this.B.x, this.B.z);
      if (r.t <= 0 || r.dist > e.radius + half) continue;
      e.tetherCd = HIT_INTERVAL;
      g.fx.burst(this._tmp.set(r.cx, this.A.y, r.cz), this.aspect(g).color, 3, 3, { life: 0.3 });
      const coef = TICK_COEF * (id === 'lapis' ? 1.5 : id === 'bulwark' ? 0.6 : 1);
      const { amount, crit } = rollDamage(stats, coef, Math.random, mult);
      let knockX = 0, knockZ = 0;
      if (id === 'chain') {
        const dx = this.A.x - e.pos.x, dz = this.A.z - e.pos.z, d = Math.hypot(dx, dz) || 1;
        knockX = (dx / d) * 6; knockZ = (dz / d) * 6;
        e.slow = 1.5;
      } else if (id === 'bulwark') {
        const [nx, nz] = this.lineNormalToward(e.pos.x, e.pos.z, r);
        knockX = nx * 7; knockZ = nz * 7;
      }
      if (burning) { e.burn = 3; e.burnDps = Math.max(e.burnDps, amount * 0.8); }
      if (stats.powers.has('ereshkigal')) e.vulnerable = 3;
      g.enemies.damage(e, amount, g, { crit, knockX, knockZ, color: this.aspect(g).css, silent: !crit });
      g.player.heal(stats.lifeOnHit * 0.3);
      g.player.anima = Math.min(g.player.stats.maxAnima, g.player.anima + 2);
    }
  }

  lineNormalToward(x, z, r) {
    let nx = x - r.cx, nz = z - r.cz;
    if (Math.hypot(nx, nz) < 1e-4) { nx = -(this.B.z - this.A.z); nz = this.B.x - this.A.x; }
    const n = Math.hypot(nx, nz) || 1;
    return [nx / n, nz / n];
  }

  // Tether Snap (skill). Returns the number of enemies hit.
  snap(g, coef) {
    this.flare = 1;
    const a = this.aspect(g);
    const stats = g.player.stats;
    let hits = 0;
    for (let k = 0; k <= 10; k++) {
      this._tmp.lerpVectors(this.A, this.B, k / 10);
      g.fx.burst(this._tmp, a.color, 5, 4, { up: 3, life: 0.6 });
      if ((a.id === 'fire' || g.abilities.pyreActive) && k % 2 === 0 && k > 0) this.addPatch(this._tmp.x, this._tmp.z, 4);
    }
    for (const e of g.enemies.list) {
      if (!e.alive || e.spawning > 0) continue;
      const r = distPointSegment(e.pos.x, e.pos.z, this.A.x, this.A.z, this.B.x, this.B.z);
      if (r.dist > e.radius + 1.3) continue;
      hits++;
      const { amount, crit } = rollDamage(stats, coef * (a.id === 'lapis' ? 1.3 : 1), Math.random, stats.tetherMult);
      let knockX = 0, knockZ = 0;
      if (a.id === 'chain') {
        const dx = this.A.x - e.pos.x, dz = this.A.z - e.pos.z, d = Math.hypot(dx, dz) || 1;
        knockX = (dx / d) * 16; knockZ = (dz / d) * 16; e.slow = 2.5;
      } else if (a.id === 'bulwark') {
        const [nx, nz] = this.lineNormalToward(e.pos.x, e.pos.z, r);
        knockX = nx * 18; knockZ = nz * 18;
      } else if (a.id === 'fire') { e.burn = 5; e.burnDps = Math.max(e.burnDps, amount * 0.4); }
      g.enemies.damage(e, amount, g, { crit, knockX, knockZ, color: a.css });
    }
    if (a.id === 'bulwark') for (const b of g.enemies.projectiles) if (Math.hypot(b.pos.x - this.A.x, b.pos.z - this.A.z) < 7) b.life = 0;
    return hits;
  }

  blocksProjectile(pos, g) {
    if (this.aspect(g).id !== 'bulwark' || g.player.dead || this.mode === 'rest') return false;
    const r = distPointSegment(pos.x, pos.z, this.A.x, this.A.z, this.B.x, this.B.z);
    if (r.t <= 0 || r.dist > 0.55) return false;
    g.fx.burst(pos, 0xffcf4a, 10, 4, { life: 0.35 });
    return true;
  }

  addPatch(x, z, life) {
    if (this.patches.length >= MAX_PATCHES) { const old = this.patches.shift(); this.scene.remove(old.mesh); old.mesh.material.dispose(); }
    const mesh = new THREE.Mesh(this.patchGeo, new THREE.MeshBasicMaterial({ color: 0xff7a2a, map: this.patchTex, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending }));
    mesh.position.set(x, 0, z);
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
      p.mesh.position.y = g.world.heightAt(p.x, p.z) + 0.05;
      p.mesh.material.opacity = 0.55 * Math.min(1, k * 3) * (0.8 + Math.random() * 0.2);
    }
    if (!this.patches.length) return;
    const dps = rollDamage(g.player.stats, 0.5, () => 0.5).amount;
    for (const e of g.enemies.list) {
      if (!e.alive || e.spawning > 0) continue;
      for (const p of this.patches) {
        if (Math.hypot(e.pos.x - p.x, e.pos.z - p.z) < 0.85 + e.radius) { e.burn = Math.max(e.burn, 1.2); e.burnDps = Math.max(e.burnDps, dps); break; }
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
    this.familiar.rotation.y = Math.atan2(this.B.x - this.A.x, this.B.z - this.A.z);
    this.light.intensity = 4 + this.sweep * 5 + this.flare * 18;
    const show = !g.player.dead && len > 0.3;
    this.lineCore.visible = this.lineGlow.visible = show;
    if (!show) return;
    this._tmp.subVectors(this.B, this.A);
    const l3 = this._tmp.length();
    const dir = this._tmp.normalize();
    const mid = this.A.clone().lerp(this.B, 0.5);
    const thick = (this.aspect(g).id === 'bulwark' ? 1.6 : 1) * (live ? 1 : 0.5);
    for (const [mesh, r] of [[this.lineCore, 0.04], [this.lineGlow, 0.16]]) {
      mesh.position.copy(mid);
      mesh.quaternion.setFromUnitVectors(this._up, dir);
      const rr = r * thick * (1 + this.sweep * 0.5 + this.flare * 2.5);
      mesh.scale.set(rr, l3, rr);
    }
    this.lineGlowMat.opacity = (live ? 0.22 : 0.08) + this.sweep * 0.2 + this.flare * 0.5 + Math.sin(g.time * 20) * 0.03;
    this.lineCoreMat.opacity = live ? 0.9 : 0.3;
  }
}

function coreTint(hex) {
  return new THREE.Color(hex).lerp(new THREE.Color(0xffffff), 0.55);
}

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
