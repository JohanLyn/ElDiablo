import * as THREE from 'three';
import { SKILLS, skillCoef } from '../game/skills.js';
import { rollDamage } from '../game/stats.js';
import { inCone, angleDelta, distPointSegment } from '../core/util.js';
import { makeJavelinMesh } from '../fx/models.js';

// Combo for Sickle Strike: [duration, hit moment 0..1, coef mult, reach, half-arc, knockback]
const COMBO = [
  { time: 0.32, hitAt: 0.4, mult: 1.0, reach: 2.6, arc: 1.15, knock: 3 },
  { time: 0.32, hitAt: 0.4, mult: 1.0, reach: 2.6, arc: 1.15, knock: 3 },
  { time: 0.46, hitAt: 0.45, mult: 1.6, reach: 3.0, arc: 1.4, knock: 9 },
];

// Casts the six slotted skills: targeting, costs, cooldowns and effects.
export class Abilities {
  constructor(scene) {
    this.scene = scene;
    this.cooldowns = {};
    this.charges = { wings: 1 };
    this.combo = 0;
    this.comboWindow = 0;
    this.hitDone = false;
    this.queued = null;
    this.pyre = 0;
    this.pyreTick = 0;
    this.channel = null; // town portal
    this.javelins = [];
    this.bolts = [];
    this.leap = null;
  }

  get pyreActive() { return this.pyre > 0; }

  reset() {
    this.cooldowns = {};
    this.charges = { wings: 1 };
    this.pyre = 0;
    this.channel = null;
    this.leap = null;
    for (const j of this.javelins) this.scene.remove(j.mesh);
    this.javelins = [];
  }

  cooldownLeft(id, stats) {
    if (id === 'wings') return this.charges.wings > 0 ? 0 : this.cooldownTotal('wings', stats) - (this.wingsTimer ?? 0);
    return this.cooldowns[id] ?? 0;
  }
  cooldownTotal(id, stats) { return (SKILLS[id].cooldown ?? 0) * (1 - stats.cdr); }

  cancel() {
    this.queued = null;
    this.channel = null;
  }

  interruptChannel() {
    if (this.channel) { this.channel = null; this._g?.hud.notify('Town Portal interrupted', 'warn'); }
  }

  // ---- input -------------------------------------------------------------
  update(dt, g) {
    this._g = g;
    const p = g.player;
    const stats = p.stats;
    this.comboWindow = Math.max(0, this.comboWindow - dt);
    for (const k of Object.keys(this.cooldowns)) this.cooldowns[k] = Math.max(0, this.cooldowns[k] - dt);
    // Wings of the Sedu recharges one charge at a time.
    const maxWings = this.maxWingCharges(stats);
    this.charges.wings = Math.min(this.charges.wings, maxWings);
    if (this.charges.wings < maxWings) {
      this.wingsTimer = (this.wingsTimer ?? 0) + dt;
      if (this.wingsTimer >= this.cooldownTotal('wings', stats)) { this.charges.wings++; this.wingsTimer = 0; }
    } else this.wingsTimer = 0;

    if (!p.dead && !g.uiOpen) {
      // Which slot buttons were pressed (held counts for the basic attack).
      for (let i = 0; i < 6; i++) {
        const id = p.slots[i];
        if (!id) continue;
        const pressed = g.input.pressed[`skill${i + 1}`];
        const held = g.input.down[`skill${i + 1}`];
        if (pressed && i === 0 && g.interactTarget && !g.combatNearby) continue; // A = interact
        if (pressed || (held && SKILLS[id].category === 'Basic')) this.tryCast(id, g, pressed);
      }
    }

    if (p.state === 'attack') this.updateStrike(dt, g);
    if (p.state === 'leap') this.updateLeap(dt, g);
    this.updateJavelins(dt, g);
    this.updateBolts(dt);
    if (this.pyre > 0) this.updatePyre(dt, g);
    if (this.channel) {
      this.channel.t += dt;
      g.fx.burst(p.pos.clone().setY(p.pos.y + 0.2 + Math.random() * 2), 0x7fb2ff, 1, 1, { up: 1, life: 0.5, gravity: -1 });
      if (p.vel.lengthSq() > 4) this.channel = null;
      else if (this.channel.t >= 1.5) { this.channel = null; g.openTownPortal(); }
    }
  }

  maxWingCharges(stats) { return stats.powers.has('lamassu') ? 2 : 1; }

  tryCast(id, g, fresh) {
    const p = g.player;
    const def = SKILLS[id];
    const rank = p.skillRanks[id] ?? 0;
    if (rank <= 0) return;
    if (p.state === 'evade' || p.state === 'leap') { if (fresh) this.queued = id; return; }
    if (p.state === 'attack' && !(this.hitDone && id !== 'strike')) { if (fresh) this.queued = id; return; }
    if (id === 'wings') {
      if (this.charges.wings <= 0) { if (fresh) this.denied(g, 'Not ready yet'); return; }
    } else if ((this.cooldowns[id] ?? 0) > 0) { if (fresh) this.denied(g, `${def.name} is not ready`); return; }
    if (def.cost && p.anima < def.cost) { if (fresh) this.denied(g, 'Not enough Anima'); return; }
    if (def.cost) p.anima -= def.cost;
    if (id === 'wings') this.charges.wings--;
    else if (def.cooldown) this.cooldowns[id] = this.cooldownTotal(id, p.stats);
    this.queued = null;
    this.channel = null;
    this[`cast_${id}`](g, skillCoef(id, rank));
    g.events.emit('skillCast', { id, pos: p.pos });
  }

  denied(g, msg) {
    if (this._lastDenied && g.time - this._lastDenied < 0.6) return;
    this._lastDenied = g.time;
    g.hud.notify(msg, 'warn');
    g.events.emit('denied', { reason: msg });
  }

  // ---- targeting -----------------------------------------------------------
  // Mouse: the cursor. Pad: soft-target the best enemy in front, else straight ahead.
  aimPoint(g, range) {
    const p = g.player;
    if (g.input.device === 'kbm' && g.input.aim.mouse) {
      const dx = g.input.mouseGround.x - p.pos.x, dz = g.input.mouseGround.z - p.pos.z;
      const d = Math.hypot(dx, dz) || 1, k = Math.min(1, range / d);
      return { x: p.pos.x + dx * k, z: p.pos.z + dz * k, target: this.enemyNear(g, g.input.mouseGround, 2) };
    }
    const t = this.softTarget(g, range);
    if (t) return { x: t.pos.x, z: t.pos.z, target: t };
    const dir = g.input.move.mag > 0.2 ? Math.atan2(g.input.move.x, g.input.move.z) : p.facing;
    const d = Math.min(range, 8);
    return { x: p.pos.x + Math.sin(dir) * d, z: p.pos.z + Math.cos(dir) * d, target: null };
  }

  softTarget(g, range) {
    const p = g.player;
    const dir = g.input.move.mag > 0.2 ? Math.atan2(g.input.move.x, g.input.move.z) : p.facing;
    let best = null, bestScore = Infinity;
    for (const e of g.enemies.list) {
      if (!e.alive || e.spawning > 0) continue;
      const d = Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z);
      if (d > range) continue;
      const off = Math.abs(angleDelta(dir, Math.atan2(e.pos.x - p.pos.x, e.pos.z - p.pos.z)));
      if (off > 1.2 && d > 2.5) continue;
      const score = d + off * 3 - (e.elite || e.boss ? 2 : 0);
      if (score < bestScore) { bestScore = score; best = e; }
    }
    return best;
  }

  enemyNear(g, point, r) {
    let best = null, bd = r;
    for (const e of g.enemies.list) {
      if (!e.alive || e.spawning > 0) continue;
      const d = Math.hypot(e.pos.x - point.x, e.pos.z - point.z);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  face(g, x, z) { const p = g.player; p.facing = Math.atan2(x - p.pos.x, z - p.pos.z); }

  // Shared damage helper: hits every enemy within r of pos.
  areaDamage(pos, r, coef, g, { knock = 0, color = '#fff', fx = null, onHit = null } = {}) {
    const stats = g.player.stats;
    let hits = 0;
    for (const e of g.enemies.list) {
      if (!e.alive || e.spawning > 0) continue;
      const dx = e.pos.x - pos.x, dz = e.pos.z - pos.z, d = Math.hypot(dx, dz);
      if (d > r + e.radius) continue;
      const { amount, crit } = rollDamage(stats, coef);
      g.enemies.damage(e, amount, g, { crit, color, knockX: d > 0 ? (dx / d) * knock : 0, knockZ: d > 0 ? (dz / d) * knock : 0 });
      onHit?.(e);
      hits++;
    }
    if (fx) g.fx.burst(new THREE.Vector3(pos.x, (pos.y ?? 0) + 0.5, pos.z), fx, 30, r * 2.2, { up: 3, life: 0.6 });
    return hits;
  }

  // ---- skills --------------------------------------------------------------
  cast_strike(g) {
    const p = g.player;
    if (this.comboWindow <= 0) this.combo = 0;
    const target = this.softTarget(g, 5.5);
    const aim = g.input.device === 'kbm' && g.input.aim.mouse && !target ? g.input.mouseGround : null;
    if (target) {
      this.face(g, target.pos.x, target.pos.z);
      const d = Math.hypot(target.pos.x - p.pos.x, target.pos.z - p.pos.z);
      const lunge = Math.max(0, Math.min(d - 1.8 - target.radius * 0.5, 2.2));
      p.vel.set(Math.sin(p.facing), 0, Math.cos(p.facing)).multiplyScalar(lunge / 0.12);
    } else {
      if (aim) this.face(g, aim.x, aim.z);
      else if (g.input.move.mag > 0.2) p.facing = Math.atan2(g.input.move.x, g.input.move.z);
      p.vel.multiplyScalar(0.3);
    }
    this.hitDone = false;
    p.setState('attack');
    p.weaponPivot.rotation.y = this.combo === 1 ? -1.6 : 1.6;
  }

  updateStrike(dt, g) {
    const p = g.player;
    const step = COMBO[this.combo];
    const time = step.time / p.stats.attackSpeed;
    const k = p.stateTime / time;
    if (p.stateTime > 0.12) p.vel.multiplyScalar(Math.max(0, 1 - dt * 20));
    const from = this.combo === 1 ? -1.6 : 1.6;
    const sweep = Math.min(1, k / step.hitAt) ** 2;
    p.weaponPivot.rotation.y = from - from * 2 * sweep;
    if (!this.hitDone && k >= step.hitAt) {
      this.hitDone = true;
      p.trailMat.opacity = 0.75;
      g.events.emit('strikeSwing', { combo: this.combo, pos: p.pos, facing: p.facing, reach: step.reach });
      p.trail.scale.setScalar(step.reach / 2.6);
      const coef = skillCoef('strike', p.skillRanks.strike ?? 1) * step.mult;
      let hits = 0;
      for (const e of g.enemies.list) {
        if (!e.alive || e.spawning > 0) continue;
        const d = Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z);
        if (d > step.reach + e.radius) continue;
        if (d > 0.8 + e.radius && !inCone(p.pos.x, p.pos.z, p.facing, e.pos.x, e.pos.z, step.arc)) continue;
        const { amount, crit } = rollDamage(p.stats, coef);
        const kx = e.pos.x - p.pos.x, kz = e.pos.z - p.pos.z, kl = Math.hypot(kx, kz) || 1;
        g.enemies.damage(e, amount, g, { crit, knockX: (kx / kl) * step.knock, knockZ: (kz / kl) * step.knock });
        p.heal(p.stats.lifeOnHit);
        hits++;
      }
      if (hits) {
        p.anima = Math.min(p.stats.maxAnima, p.anima + SKILLS.strike.gain);
        g.fx.stop(this.combo === 2 ? 0.08 : 0.045);
        g.fx.shake(this.combo === 2 ? 0.3 : 0.15);
        g.fx.rumble(this.combo === 2 ? 0.7 : 0.35, 0.5, this.combo === 2 ? 110 : 60);
      }
    }
    if (k >= 1) {
      this.combo = (this.combo + 1) % COMBO.length;
      this.comboWindow = this.combo === 0 ? 0 : 0.4;
      p.setState('move');
      const q = this.queued;
      this.queued = null;
      if (q) this.tryCast(q, g, true);
    }
  }

  cast_javelin(g, coef) {
    const p = g.player;
    const aim = this.aimPoint(g, SKILLS.javelin.range);
    this.face(g, aim.x, aim.z);
    p.castLock = 0.22;
    const spreads = p.stats.powers.has('inanna') ? [-0.22, 0, 0.22] : [0];
    for (const s of spreads) {
      const a = p.facing + s;
      const mesh = makeJavelinMesh(); // glowing lapis spear; trail and impact come from src/fx/vfx.js
      mesh.position.set(p.pos.x + Math.sin(a) * 0.8, p.pos.y + 1.2, p.pos.z + Math.cos(a) * 0.8);
      mesh.rotation.y = a;
      this.scene.add(mesh);
      g.events.emit('javelinThrow', { pos: mesh.position, dir: a, mesh });
      this.javelins.push({ mesh, vx: Math.sin(a) * 30, vz: Math.cos(a) * 30, life: SKILLS.javelin.range / 30, coef: coef * (spreads.length > 1 ? 0.7 : 1), hit: new Set() });
    }
    g.fx.rumble(0.2, 0.2, 50);
  }

  updateJavelins(dt, g) {
    for (let i = this.javelins.length - 1; i >= 0; i--) {
      const j = this.javelins[i];
      const ox = j.mesh.position.x, oz = j.mesh.position.z;
      j.mesh.position.x += j.vx * dt;
      j.mesh.position.z += j.vz * dt;
      j.life -= dt;
      for (const e of g.enemies.list) {
        if (!e.alive || e.spawning > 0 || j.hit.has(e)) continue;
        const r = distPointSegment(e.pos.x, e.pos.z, ox, oz, j.mesh.position.x, j.mesh.position.z);
        if (r.dist > e.radius + 0.35) continue;
        j.hit.add(e);
        const { amount, crit } = rollDamage(g.player.stats, j.coef);
        g.enemies.damage(e, amount, g, { crit, color: '#9cc0ff', knockX: j.vx * 0.08, knockZ: j.vz * 0.08 });
        g.events.emit('javelinHit', { pos: e.pos.clone().setY(e.pos.y + 1.1) });
        g.player.heal(g.player.stats.lifeOnHit * 0.5);
      }
      if (j.life <= 0 || g.world.colliders.pointBlocked(j.mesh.position.x, j.mesh.position.z)) {
        this.scene.remove(j.mesh);
        this.javelins.splice(i, 1);
      }
    }
  }

  cast_snap(g, coef) {
    const p = g.player;
    p.castLock = 0.2;
    const hits = g.tether.snap(g, coef);
    g.events.emit('snap', { a: g.tether.A.clone(), b: g.tether.B.clone(), aspect: g.tether.aspect(g).id, hits });
    g.fx.stop(hits ? 0.07 : 0.02);
    g.fx.shake(0.35);
    g.fx.rumble(0.9, 0.7, 160);
    if (p.stats.powers.has('gatekeeper')) {
      this.areaDamage(p.pos, 5, 1.2, g, { knock: 8, color: '#c8a8ff', fx: 0x9a6bff });
    }
  }

  cast_wings(g, coef) {
    const p = g.player;
    const aim = this.aimPoint(g, SKILLS.wings.range);
    let dx = aim.x - p.pos.x, dz = aim.z - p.pos.z;
    let d = Math.hypot(dx, dz);
    if (d < 3) {
      const a = g.input.move.mag > 0.2 ? Math.atan2(g.input.move.x, g.input.move.z) : p.facing;
      dx = Math.sin(a) * 6; dz = Math.cos(a) * 6; d = 6;
    }
    this.face(g, p.pos.x + dx, p.pos.z + dz);
    this.leap = { from: p.pos.clone(), to: new THREE.Vector3(p.pos.x + dx, 0, p.pos.z + dz), coef, t: 0, time: 0.45 };
    // Don't land inside a wall: resolve the landing spot up front.
    g.world.colliders.resolve(this.leap.to, 0.5, g.inDungeon);
    p.setState('leap');
    p.invuln = 0.5;
    g.fx.burst(p.pos.clone().setY(p.pos.y + 0.5), 0xffe6a8, 16, 3, { up: 3, life: 0.5 });
    g.events.emit('leapStart', { pos: p.pos.clone(), to: this.leap.to.clone() });
  }

  updateLeap(dt, g) {
    const p = g.player;
    const L = this.leap;
    if (!L) { p.setState('move'); return; }
    L.t += dt;
    const k = Math.min(1, L.t / L.time);
    p.pos.x = L.from.x + (L.to.x - L.from.x) * k;
    p.pos.z = L.from.z + (L.to.z - L.from.z) * k;
    p.pos.y = g.world.heightAt(p.pos.x, p.pos.z) + Math.sin(k * Math.PI) * 3;
    if (k >= 1) {
      p.pos.y = g.world.heightAt(p.pos.x, p.pos.z);
      p.vel.set(0, 0, 0);
      p.setState('move');
      this.leap = null;
      this.areaDamage(p.pos, 3.4, L.coef, g, { knock: 10, color: '#ffe6a8', fx: 0xffe6a8 });
      g.events.emit('leapLand', { pos: p.pos.clone(), r: 3.4 });
      g.fx.shake(0.4);
      g.fx.stop(0.06);
      g.fx.rumble(0.8, 0.6, 140);
      const q = this.queued;
      this.queued = null;
      if (q) this.tryCast(q, g, true);
    }
  }

  cast_storm(g, coef) {
    const p = g.player;
    const aim = this.aimPoint(g, SKILLS.storm.range);
    this.face(g, aim.x, aim.z);
    p.castLock = 0.3;
    const strikes = 6 + (p.stats.powers.has('adad') ? 4 : 0);
    for (let i = 0; i < strikes; i++) {
      setTimeoutGame(g, i * 0.12, () => {
        // Prefer enemies near the target area, else random spots around it.
        const candidates = g.enemies.list.filter((e) => e.alive && e.spawning <= 0 && Math.hypot(e.pos.x - aim.x, e.pos.z - aim.z) < 7);
        const e = candidates.length ? candidates[Math.floor(Math.random() * candidates.length)] : null;
        const x = e ? e.pos.x : aim.x + (Math.random() - 0.5) * 8;
        const z = e ? e.pos.z : aim.z + (Math.random() - 0.5) * 8;
        const y = g.world.heightAt(x, z);
        this.lightning(x, y, z);
        g.events.emit('lightning', { pos: new THREE.Vector3(x, y, z) });
        this.areaDamage({ x, y, z }, 1.9, coef, g, { knock: 2, color: '#bfe8ff', fx: 0x8fd3ff, onHit: (en) => { en.slow = Math.max(en.slow, 0.6); } });
        g.fx.shake(0.12);
        g.fx.rumble(0.3, 0.6, 50);
      });
    }
  }

  // The bolt itself (jagged ribbons, scorch, light) is drawn by src/fx/vfx.js from the 'lightning' event.
  lightning() {}

  updateBolts() {}

  cast_aegis(g) {
    const p = g.player;
    p.addBarrier(p.stats.maxLife * (0.4 + 0.04 * ((p.skillRanks.aegis ?? 1) - 1)), 6);
    g.events.emit('aegis', { pos: p.pos });
    g.fx.burst(p.pos.clone().setY(p.pos.y + 1), 0xffcf4a, 30, 4, { up: 3, life: 0.6 });
    g.fx.rumble(0.3, 0.5, 100);
  }

  cast_pyre(g, coef) {
    this.pyre = 8;
    this.pyreTick = 0;
    this.pyreCoef = coef;
    g.hud.notify("Gibil's Pyre burns!", 'good');
    g.fx.shake(0.3);
  }

  updatePyre(dt, g) {
    const p = g.player;
    this.pyre -= dt;
    this.pyreTick -= dt;
    if (this.pyreTick <= 0 && !p.dead) {
      this.pyreTick = 0.5;
      this.areaDamage(p.pos, 4.2, this.pyreCoef, g, { color: '#ff9a4a', fx: 0xff7a2a, onHit: (e) => { e.burn = 2; } });
      g.events.emit('pyrePulse', { pos: p.pos.clone(), r: 4.2 });
    }
  }
}

// Gameplay-time delays (respect pause and hit-stop).
function setTimeoutGame(g, delay, fn) {
  g.timers.push({ t: delay, fn });
}
