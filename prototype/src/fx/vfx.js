import * as THREE from 'three';
import { F } from './atlas.js';
import { U, TAU, rr, clamp01, smooth, makeSurfaceHeight } from './shared.js';
import { HALF } from '../world/layout.js';
import { DUNGEON_Z } from '../world/terrain.js';
import { RibbonBatch } from './ribbons.js';
import { SlashPool } from './slash.js';
import { makePillarMaterial, makePillar, makeBarrierMaterial } from './beams.js';
import { makeGhost, makeWings } from './models.js';
import { getTelegraphs, styleForColor } from './telegraph.js';
import { ASPECTS } from '../game/skills.js';
import { RARITY_FX } from './rarity.js';

const _col = new THREE.Color();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();

const ASPECT_HEX = {};
for (const a of ASPECTS) ASPECT_HEX[a.id] = a.color;

// Set a template's start/end colour from a hex, with an HDR multiplier.
function c0(t, hex, k = 1) { _col.set(hex); t.r0 = _col.r * k; t.g0 = _col.g * k; t.b0 = _col.b * k; }
function c1(t, hex, k = 1) { _col.set(hex); t.r1 = _col.r * k; t.g1 = _col.g * k; t.b1 = _col.b * k; }

const MAX_HIT_FX = 16;
const LIGHT_K = 0.2; // sand is bright: flash lights must stay gentle

// The combat/loot VFX director. Gameplay only emits events; this class turns
// them into pooled sprites, ribbons, decals, shaders and short-lived lights.
export class Vfx {
  constructor(g) {
    this.g = g;
    this.scene = g.scene;
    this.ps = g.fx.ps;
    this.surface = makeSurfaceHeight(g.world.heightAt, HALF, 220, DUNGEON_Z);
    g.surface = this.surface;
    this.ps.heightAt = this.surface;
    this.A = this.ps.add;
    this.B = this.ps.alpha;
    this.frame = 0;
    this.now = 0;
    this.hitBudget = MAX_HIT_FX;
    this.srcFrame = -1;
    this.tetherFrame = -1;
    this.tetherEnemy = null;
    this.lastPulse = -1;
    this.later = [];

    this.ribbons = new RibbonBatch(this.scene);
    this.slashes = new SlashPool(this.scene, 7);

    // Pooled flash lights (never added/removed: avoids shader recompiles).
    this.lights = [0, 1].map(() => {
      const l = new THREE.PointLight(0xffffff, 0, 22, 1.7);
      l.userData = { t: 1, dur: 0.2, i0: 0 };
      this.scene.add(l);
      return l;
    });
    this.lightCursor = 0;

    // Light pillars.
    this.pillars = [0, 1, 2].map(() => {
      const mat = makePillarMaterial(0xffc040, 0xfff0c0, 1);
      const m = makePillar(mat, 1, 1);
      m.visible = false;
      this.scene.add(m);
      return { mesh: m, mat, t: 1, dur: 1, i0: 1, r: 1, h: 1, grow: 0 };
    });
    this.pillarCursor = 0;

    // Javelin and enemy-bolt trails.
    this.javs = [];
    this.projTrails = new Map();
    this.surgeT = -1;

    // Wings.
    const w = makeWings();
    this.wingsFx = w;
    g.player.group.add(w.root);
    this.wingT = -1;
    this.wingFade = -1;

    // Evade ghosts.
    this.ghosts = [];
    for (let i = 0; i < 7; i++) { const m = makeGhost(0x79b6ff); this.scene.add(m); this.ghosts.push({ mesh: m, t: 1, dur: 0.3 }); }
    this.ghostCursor = 0;
    this.ghostTimer = 0;

    // Aegis barrier shader on the existing sphere.
    this.barrierMat = makeBarrierMaterial();
    const bm = g.player.barrierMesh;
    bm.material = this.barrierMat;
    bm.geometry = new THREE.SphereGeometry(1.25, 36, 26);
    bm.renderOrder = 7;
    this.barrierPeak = 0;
    this.lastBarrier = 0;
    g.player.trail.visible = false; // replaced by the slash ribbons

    // Lightning bolts.
    this.bolts = [];
    this.potionSwirls = [];
    this.levelT = -1;
    this.pyreEmit = 0;
    this.tele = getTelegraphs(this.scene);

    this.bind(g.events);
  }

  // ---------------------------------------------------------------------
  // helpers
  // ---------------------------------------------------------------------
  ground(x, z) { return this.surface(x, z); }

  schedule(delay, fn) { this.later.push({ t: delay, fn }); }

  flashLight(x, y, z, hex, intensity, dur) {
    const l = this.lights[this.lightCursor];
    this.lightCursor = (this.lightCursor + 1) % this.lights.length;
    l.position.set(x, y, z);
    l.color.set(hex);
    intensity *= LIGHT_K;
    l.userData.t = 0; l.userData.dur = dur; l.userData.i0 = intensity;
    l.intensity = intensity;
  }

  pillar(x, y, z, hex, hot, radius, height, dur, intensity = 1, spin = 0) {
    const p = this.pillars[this.pillarCursor];
    this.pillarCursor = (this.pillarCursor + 1) % this.pillars.length;
    p.mat.uniforms.uColor.value.set(hex); p.mat.uniforms.uHot.value.set(hot); p.mat.uniforms.uSpin.value = spin;
    p.t = 0; p.dur = dur; p.i0 = intensity; p.r = radius; p.h = height;
    p.mesh.position.set(x, y, z);
    p.mesh.visible = true;
    p.mesh.scale.set(radius, height, radius);
  }

  glow(x, y, z, size, hex, life, a = 1, k = 1.4) {
    k /= 1 + size * 0.12;
    const t = this.A.begin(F.DOT);
    t.x = x; t.y = y; t.z = z; t.s0 = size; t.s1 = size * 0.4; t.life = life; t.a = a; c0(t, hex, k);
    this.A.emit();
  }

  flash(x, y, z, size, hex, life, k = 1.6, frame = F.STAR, spin = 0) {
    k /= 1 + size * 0.14;
    const t = this.A.begin(frame);
    t.x = x; t.y = y; t.z = z; t.s0 = size * 0.55; t.s1 = size; t.life = life; t.fp = 1.6; t.fin = 0.008;
    t.rot = Math.random() * 6.28; t.rotVel = spin; c0(t, hex, k);
    this.A.emit();
  }

  // Expanding ring lying on the terrain (mode 1) or at fixed height (mode 2).
  ringFlat(x, y, z, s0, s1, life, hex, a = 1, k = 1.5, frame = F.WAVE, mode = 1, hexEnd = null) {
    const t = this.A.begin(frame);
    t.x = x; t.y = y; t.z = z; t.s0 = s0; t.s1 = s1; t.life = life; t.a = a; t.mode = mode; t.fp = 1.3; t.fin = 0.01;
    t.rot = Math.random() * 6.28; c0(t, hex, k);
    if (hexEnd !== null) c1(t, hexEnd, k * 0.6);
    this.A.emit();
  }

  ringBill(x, y, z, s0, s1, life, hex, a = 1, k = 1.5) {
    const t = this.A.begin(F.RING);
    t.x = x; t.y = y; t.z = z; t.s0 = s0; t.s1 = s1; t.life = life; t.a = a; t.fp = 1.2; t.fin = 0.005; c0(t, hex, k);
    this.A.emit();
  }

  // Directional spark streaks. (dx,dz) is the main direction; cone is the spread.
  sparks(x, y, z, dx, dz, n, spd, cone, hex0, hex1, size = 0.28, life = 0.4, grav = 14, k = 1.8) {
    n = this.ps.n(n);
    const base = Math.atan2(dx, dz), omni = dx === 0 && dz === 0;
    for (let i = 0; i < n; i++) {
      const t = this.A.begin(F.STREAK);
      const a = omni ? Math.random() * TAU : base + (Math.random() - 0.5) * 2 * cone;
      const s = spd * (0.45 + Math.random() * 0.7);
      t.x = x; t.y = y; t.z = z;
      t.vx = Math.sin(a) * s; t.vz = Math.cos(a) * s; t.vy = rr(0.5, 5);
      t.life = life * (0.6 + Math.random() * 0.7);
      t.s0 = size * (0.8 + Math.random() * 0.8); t.s1 = size * 0.3; t.stretch = 0.11; t.grav = grav; t.drag = 1.2; t.fin = 0.005;
      c0(t, hex0, k); c1(t, hex1, k * 0.5);
      this.A.emit();
    }
  }

  // Round glowing motes (embers, magic dust). up<0 falls.
  motes(x, y, z, n, spread, speed, up, hex0, hex1, size, life, grav = -1, frame = F.DOT, k = 1.5) {
    n = this.ps.n(n);
    for (let i = 0; i < n; i++) {
      const t = this.A.begin(frame);
      const a = Math.random() * TAU, r = Math.random() * spread;
      t.x = x + Math.cos(a) * r; t.y = y + Math.random() * 0.3; t.z = z + Math.sin(a) * r;
      const s = speed * Math.random();
      t.vx = Math.cos(a) * s; t.vz = Math.sin(a) * s; t.vy = up * (0.5 + Math.random());
      t.life = life * (0.6 + Math.random() * 0.8);
      t.s0 = size * (0.6 + Math.random() * 0.8); t.s1 = t.s0 * 0.2; t.grav = grav; t.drag = 0.8;
      if (frame === F.SHARD) { t.rotVel = (Math.random() - 0.5) * 10; t.rot = Math.random() * 6.28; }
      c0(t, hex0, k); c1(t, hex1, k * 0.6);
      this.A.emit();
    }
  }

  // Soft alpha-blended puffs (dust, smoke).
  puffs(x, y, z, n, spread, speed, up, hex, size0, size1, life, a = 0.5, grav = -0.4) {
    n = this.ps.n(n);
    for (let i = 0; i < n; i++) {
      const t = this.B.begin(F.SMOKE);
      const ang = Math.random() * TAU, r = Math.random() * spread;
      t.x = x + Math.cos(ang) * r; t.y = y; t.z = z + Math.sin(ang) * r;
      const s = speed * (0.4 + Math.random() * 0.6);
      t.vx = Math.cos(ang) * s; t.vz = Math.sin(ang) * s; t.vy = up * (0.4 + Math.random() * 0.8);
      t.life = life * (0.7 + Math.random() * 0.6);
      t.s0 = size0 * (0.7 + Math.random() * 0.6); t.s1 = size1 * (0.8 + Math.random() * 0.5);
      t.rot = Math.random() * 6.28; t.rotVel = (Math.random() - 0.5) * 1.2; t.drag = 2.2; t.grav = grav; t.a = a; t.fin = 0.06; t.fp = 1.4;
      c0(t, hex, 1);
      this.B.emit();
    }
  }

  // Ground stain / crack on the terrain, alpha-blended (dark) or additive (glowing).
  decal(x, z, size, frame, hex, a, life, glow = false, k = 1) {
    const L = glow ? this.A : this.B;
    const t = L.begin(frame);
    t.x = x; t.y = 0.05; t.z = z; t.s0 = t.s1 = size; t.life = life; t.a = a; t.mode = 1; t.rot = Math.random() * 6.28;
    t.fp = glow ? 1.5 : 0.6; t.fin = 0.02; c0(t, hex, k);
    L.emit();
  }

  wisps(x, y, z, n, spread, hex0, hex1, size, life, up = 2.6, k = 1.6) {
    n = this.ps.n(n);
    for (let i = 0; i < n; i++) {
      const t = this.A.begin(F.WISP);
      const a = Math.random() * TAU, r = Math.random() * spread;
      t.x = x + Math.cos(a) * r; t.y = y + Math.random() * 0.4; t.z = z + Math.sin(a) * r;
      t.vx = Math.cos(a) * 0.6; t.vz = Math.sin(a) * 0.6; t.vy = up * (0.6 + Math.random() * 0.7);
      t.life = life * (0.7 + Math.random() * 0.6);
      t.s0 = size * (0.5 + Math.random() * 0.4); t.s1 = size * 1.3; t.drag = 0.7; t.fp = 1.3; t.fin = 0.1;
      t.rot = (Math.random() - 0.5) * 0.5;
      c0(t, hex0, k); c1(t, hex1, k * 0.5);
      this.A.emit();
    }
  }

  glint(x, y, z, size, hex, life, k = 1.8) {
    const t = this.A.begin(F.GLINT);
    t.x = x; t.y = y; t.z = z; t.s0 = size * 0.4; t.s1 = size; t.life = life; t.fp = 1.3; t.fin = 0.05; t.rot = (Math.random() - 0.5) * 0.8; t.rotVel = (Math.random() - 0.5) * 2;
    c0(t, hex, k);
    this.A.emit();
  }

  // ---------------------------------------------------------------------
  // event wiring
  // ---------------------------------------------------------------------
  bind(ev) {
    ev.on('skillCast', (e) => this.onSkillCast(e));
    ev.on('strikeSwing', (e) => this.onStrikeImpact(e));
    ev.on('hit', (e) => this.onHit(e));
    ev.on('kill', (e) => this.onKill(e));
    ev.on('javelinThrow', (e) => this.onJavelinThrow(e));
    ev.on('javelinHit', (e) => this.onJavelinHit(e));
    ev.on('tetherHit', (e) => this.onTetherHit(e));
    ev.on('snap', (e) => this.onSnap(e));
    ev.on('lightning', (e) => this.onLightning(e));
    ev.on('leapStart', (e) => this.onLeapStart(e));
    ev.on('leapLand', (e) => this.onLeapLand(e));
    ev.on('aegis', (e) => this.onAegis(e));
    ev.on('pyrePulse', (e) => this.onPyrePulse(e));
    ev.on('evade', (e) => this.onEvade(e));
    ev.on('potion', (e) => this.onPotion(e));
    ev.on('hazardBlast', (e) => this.onHazardBlast(e));
    ev.on('enemyWindup', (e) => this.onWindup(e));
    ev.on('enemyAttack', (e) => this.onEnemyAttack(e));
    ev.on('enemyProjectile', (e) => this.onEnemyProjectile(e));
    ev.on('bossPhase', (e) => this.onBossPhase(e));
    ev.on('lootDrop', (e) => this.onLootDrop(e));
    ev.on('pickup', (e) => this.onPickup(e));
    ev.on('levelUp', (e) => this.onLevelUp(e));
    ev.on('aspectChange', (e) => this.onAspect(e));
    ev.on('playerHurt', (e) => this.onPlayerHurt(e));
    ev.on('chestOpen', (e) => this.onChest(e));
    ev.on('playerDeath', (e) => { this.wisps(e.pos.x, e.pos.y + 0.6, e.pos.z, 10, 0.6, 0x79b6ff, 0xffffff, 1.1, 1.6); });
  }

  // ---------------------------------------------------------------------
  // Sickle Strike
  // ---------------------------------------------------------------------
  onSkillCast(e) {
    if (e.id !== 'strike') return;
    const g = this.g, p = g.player, combo = g.abilities.combo;
    const speed = p.stats.attackSpeed || 1;
    const f = p.facing;
    const sf = Math.sin(f), cf = Math.cos(f);
    const center = _v.set(p.pos.x, p.pos.y + 1.05, p.pos.z);
    if (combo < 2) {
      const dir = combo === 0 ? 1 : -1;
      const tilt = 0.14;
      this.slashes.spawn({
        center, axU: _v2.set(sf * Math.cos(tilt), Math.sin(tilt), cf * Math.cos(tilt)), axV: _v3.set(cf, 0, -sf),
        a0: 1.5 * dir, a1: -1.5 * dir, r0: 0.7, r1: 2.95, color: 0xff8a14, hot: 0xfff0c8,
        dur: 0.115 / speed, hold: 0.16, tail: 2.6, power: 1.0,
      });
    } else {
      // Big golden overhead chop in a plane that leans toward the camera so it reads from above.
      const fx = sf * 0.45 + (sf >= 0 ? 0.9 : -0.9), fz = cf * 0.45;
      const fl = Math.hypot(fx, fz);
      this.slashes.spawn({
        center, axU: _v2.set(0, 1, 0), axV: _v3.set(fx / fl, 0.12, fz / fl),
        a0: -0.75, a1: 1.95, r0: 0.6, r1: 3.9, color: 0xff8a00, hot: 0xfff4c8,
        dur: 0.19 / speed, hold: 0.3, tail: 2.2, power: 1.15,
      });
      this.slashes.spawn({
        center, axU: _v2.set(sf, 0.05, cf), axV: _v3.set(cf, 0, -sf),
        a0: 2.1, a1: -2.1, r0: 1.4, r1: 3.5, color: 0xffb020, hot: 0xfff6dd,
        dur: 0.2 / speed, hold: 0.2, tail: 3.2, power: 0.9,
      });
    }
  }

  onStrikeImpact(e) {
    this.srcFrame = this.frame;
    const p = this.g.player, f = e.facing;
    const sf = Math.sin(f), cf = Math.cos(f);
    const gy = this.ground(p.pos.x, p.pos.z);
    // Dust kicked forward on every swing.
    this.puffs(p.pos.x + sf * 1.2, gy + 0.1, p.pos.z + cf * 1.2, e.combo === 2 ? 7 : 3, 0.7, 2.2, 0.6, 0xc9ae80, 0.7, 1.6, 0.7, 0.3);
    if (e.combo === 2) {
      const x = p.pos.x + sf * e.reach * 0.78, z = p.pos.z + cf * e.reach * 0.78;
      const y = this.ground(x, z);
      this.decal(x, z, 5.2, F.CRACK, 0xffa030, 0.9, 0.9, true, 1.6);
      this.decal(x, z, 5.2, F.CRACK, 0x100a06, 0.85, 5.5, false, 1);
      this.ringFlat(x, 0.08, z, 0.8, 7.5, 0.5, 0xffc860, 0.9, 1.7);
      this.puffs(x, y + 0.2, z, 16, 0.6, 5, 0.9, 0xcdb18a, 0.9, 2.8, 0.9, 0.42);
      this.sparks(x, y + 0.4, z, 0, 0, 16, 9, 3, 0xfff1c0, 0xff9a2a, 0.34, 0.5);
      this.motes(x, y + 0.2, z, 8, 1.4, 3, 4, 0xffd27a, 0xff8a2a, 0.3, 0.8, 8, F.SHARD, 1.2);
      this.flashLight(x, y + 1.6, z, 0xffb050, 26, 0.22);
      this.g.renderer.pulse(0xffd070, 0.07);
    }
  }

  // ---------------------------------------------------------------------
  // Hits
  // ---------------------------------------------------------------------
  onHit(e) {
    const en = e.enemy, g = this.g, p = g.player;
    let dx = en.pos.x - p.pos.x, dz = en.pos.z - p.pos.z;
    const dl = Math.hypot(dx, dz) || 1;
    dx /= dl; dz /= dl;
    const crit = e.crit;
    const direct = this.srcFrame === this.frame;
    const tether = this.tetherFrame === this.frame && this.tetherEnemy === en;
    const dot = !crit && !direct && !tether && en.burn > 0;
    const x = en.pos.x - dx * en.radius * 0.6, y = en.pos.y + 1.0 + Math.random() * 0.3, z = en.pos.z - dz * en.radius * 0.6;
    if (dot) { this.motes(en.pos.x, en.pos.y + 1, en.pos.z, 1, 0.3, 0.5, 1.5, 0xffb060, 0xff4a10, 0.22, 0.5, -2); return; }
    if (tether && !crit) return; // tetherHit handles its own sparks
    if (this.hitBudget <= 0 && !crit) return;
    this.hitBudget--;

    // Directional sparks and a quick slash mark.
    const n = crit ? 22 : 7;
    this.sparks(x, y, z, dx, dz, n, crit ? 15 : 10, crit ? 1.1 : 0.7, 0xfff4d8, crit ? 0xffb02a : 0xff8a30, crit ? 0.42 : 0.3, crit ? 0.55 : 0.4);
    this.flash(x, y, z, crit ? 3.0 : 1.25, crit ? 0xfff0b0 : 0xffd8a0, crit ? 0.16 : 0.09, crit ? 2.4 : 1.8);
    {
      const t = this.A.begin(F.STREAK);
      t.x = x; t.y = y; t.z = z; t.s0 = crit ? 2.6 : 1.5; t.s1 = t.s0 * 1.2; t.life = crit ? 0.14 : 0.1; t.rot = Math.random() * 6.28; t.fp = 1.5; t.fin = 0.004;
      t.vx = Math.cos(t.rot); t.stretch = 0; c0(t, 0xffffff, 2);
      this.A.emit();
    }
    if (crit) {
      // Chromatic star: red/cyan fringes offset around the white core + shock ring.
      for (const [hex, ox] of [[0xff3040, 0.18], [0x30c8ff, -0.18]]) this.flash(x + ox, y, z - ox * 0.5, 2.6, hex, 0.14, 1.6);
      this.ringBill(x, y, z, 0.5, 3.2, 0.2, 0xffe29a, 0.9, 1.8);
      this.glow(x, y, z, 4.2, 0xffcf6a, 0.14, 0.6, 1.5);
      this.motes(x, y, z, 6, 0.3, 4, 3, 0xffe6a0, 0xff9a2a, 0.28, 0.6, 9, F.SHARD, 1.3);
      g.fx.stop(0.045);
      g.fx.shake(0.1);
      if (this.now - this.lastPulse > 0.18) { this.lastPulse = this.now; g.renderer.pulse(0xffffff, 0.09); }
      this.flashLight(x, y + 0.6, z, 0xffd890, 14, 0.15);
    }
  }

  // ---------------------------------------------------------------------
  // Javelin
  // ---------------------------------------------------------------------
  onJavelinThrow(e) {
    const st = { mesh: e.mesh, strip: this.ribbons.alloc(), ended: false, shard: 0 };
    if (st.strip >= 0) this.ribbons.tp[st.strip] = 1.4;
    this.javs.push(st);
    const m = e.mesh.position;
    this.sparks(m.x, m.y, m.z, Math.sin(e.dir), Math.cos(e.dir), 8, 7, 0.5, 0xd8e8ff, 0x4d86ff, 0.24, 0.3);
    this.glow(m.x, m.y, m.z, 2.2, 0x6aa0ff, 0.12, 0.8);
  }

  onJavelinHit(e) {
    const p = e.pos;
    this.flash(p.x, p.y, p.z, 2.6, 0xbcd8ff, 0.18, 2.2);
    this.ringBill(p.x, p.y, p.z, 0.4, 3.0, 0.28, 0x6aa0ff, 1, 1.8);
    this.ringFlat(p.x, p.y - 0.05, p.z, 0.4, 4.2, 0.35, 0x5d95ff, 0.9, 1.6, F.WAVE, 2);
    this.motes(p.x, p.y, p.z, 14, 0.2, 7, 3, 0xd8e8ff, 0x3b6dff, 0.34, 0.6, 12, F.SHARD, 1.7);
    this.sparks(p.x, p.y, p.z, 0, 0, 10, 9, 0, 0xcfe2ff, 0x4d86ff, 0.26, 0.4);
    this.flashLight(p.x, p.y + 0.5, p.z, 0x6aa0ff, 14, 0.18);
  }

  // ---------------------------------------------------------------------
  // Tether / Snap
  // ---------------------------------------------------------------------
  onTetherHit(e) {
    this.tetherFrame = this.frame;
    this.tetherEnemy = e.enemy;
    if (this.hitBudget <= 0) return;
    const hex = ASPECT_HEX[e.aspect] ?? 0x5d95ff;
    const p = e.pos;
    this.sparks(p.x, p.y, p.z, 0, 0, 5, 6, 0, 0xffffff, hex, 0.24, 0.35);
    this.flash(p.x, p.y, p.z, 1.0, hex, 0.1, 1.8);
  }

  onSnap(e) {
    this.surgeT = 0;
    const hex = ASPECT_HEX[e.aspect] ?? 0x5d95ff;
    const a = e.a, b = e.b;
    const steps = 9;
    for (let i = 0; i <= steps; i++) {
      const k = i / steps;
      const x = a.x + (b.x - a.x) * k, y = a.y + (b.y - a.y) * k, z = a.z + (b.z - a.z) * k;
      this.glow(x, y, z, 1.4 + Math.sin(k * Math.PI) * 0.8, hex, 0.25, 0.7);
      this.sparks(x, y, z, 0, 0, 3, 5, 0, 0xffffff, hex, 0.25, 0.4, 6);
      if (i % 3 === 0) this.glint(x, y + 0.2, z, 0.9, 0xffffff, 0.3);
    }
    this.flash(b.x, b.y, b.z, 3.6, hex, 0.22, 2.2);
    this.ringBill(b.x, b.y, b.z, 0.5, 4.5, 0.3, hex, 1, 1.8);
    this.ringFlat(b.x, b.y - 0.1, b.z, 0.5, 6.5, 0.4, hex, 0.9, 1.5, F.WAVE, 2);
    this.flashLight(b.x, b.y + 0.8, b.z, hex, 18, 0.22);
    if (e.aspect === 'fire') this.motes(b.x, b.y, b.z, 14, 1.4, 3, 5, 0xffd06a, 0xff4a10, 0.32, 0.9, -1);
  }

  onAspect(e) {
    const g = this.g;
    const t = g.tether, hex = ASPECT_HEX[e.aspect] ?? 0x5d95ff;
    this.flash(t.B.x, t.B.y, t.B.z, 3, hex, 0.3, 2);
    this.ringBill(t.B.x, t.B.y, t.B.z, 0.3, 3.4, 0.35, hex, 1, 1.6);
    this.motes(t.B.x, t.B.y, t.B.z, 10, 0.3, 2.5, 2, 0xffffff, hex, 0.26, 0.6, 0);
  }

  // ---------------------------------------------------------------------
  // Storm of Adad: procedural branching lightning
  // ---------------------------------------------------------------------
  onLightning(e) {
    const p = e.pos;
    const b = { t: 0, x: p.x, y: p.y, z: p.z, ids: [-1, -1, -1], seed: Math.random() * 100, regen: 0 };
    for (let i = 0; i < 3; i++) b.ids[i] = this.ribbons.alloc();
    this.bolts.push(b);
    this.genBolt(b);
    const gy = p.y;
    this.decal(p.x, p.z, 3.4, F.SCORCH, 0x05060a, 0.85, 7, false);
    this.decal(p.x, p.z, 3.6, F.GLOW_RING, 0x7fcfff, 0.9, 0.55, true, 1.4);
    this.ringFlat(p.x, 0.1, p.z, 0.6, 5.4, 0.3, 0xbfe8ff, 0.9, 1.7);
    this.flash(p.x, gy + 0.5, p.z, 5.0, 0xcfeeff, 0.2, 2.6);
    this.flash(p.x, gy + 1.2, p.z, 3.0, 0xffffff, 0.1, 3);
    this.sparks(p.x, gy + 0.3, p.z, 0, 0, 14, 11, 0, 0xffffff, 0x58b8ff, 0.3, 0.5, 14);
    this.puffs(p.x, gy + 0.2, p.z, 3, 0.4, 1.4, 0.6, 0x9a9aa6, 0.6, 1.5, 0.8, 0.25);
    this.flashLight(p.x, gy + 3, p.z, 0xa8dcff, 55, 0.3);
  }

  genBolt(b) {
    const R = this.ribbons;
    const top = 17, segs = 13;
    const cam = this.g.camera.position;
    let lastX = b.x, lastZ = b.z;
    const main = b.ids[0];
    if (main >= 0) {
      R.n[main] = 0;
      let jx = rr(-2.5, 2.5), jz = rr(-2.5, 2.5);
      for (let i = 0; i <= segs; i++) {
        const k = i / segs;
        const y = b.y + top * (1 - k);
        const amp = (1 - k) * 1.4 * (i === segs ? 0 : 1);
        jx = jx * 0.55 + rr(-1, 1) * amp; jz = jz * 0.55 + rr(-1, 1) * amp;
        const x = b.x + jx * (1 - k) * 1.2, z = b.z + jz * (1 - k) * 1.2;
        R.set(main, i, x, y, z, 0.34 + 0.2 * (1 - k), 0.55, 0.8, 1.0, 1);
        if (i === 6) { lastX = x; lastZ = z; }
      }
    }
    for (let bi = 1; bi <= 2; bi++) {
      const id = b.ids[bi];
      if (id < 0) continue;
      R.n[id] = 0;
      const si = 3 + bi * 2;
      const sy = b.y + top * (1 - si / segs);
      const sx = R.pos[(b.ids[0] * R.P + si) * 3], sz = R.pos[(b.ids[0] * R.P + si) * 3 + 2];
      const ang = rr(0, TAU), len = rr(0.7, 1.2);
      let x = sx, y = sy, z = sz;
      for (let i = 0; i < 6; i++) {
        R.set(id, i, x, y, z, 0.2 * (1 - i / 7), 0.5, 0.78, 1, 0.85 * (1 - i / 7));
        x += Math.cos(ang + rr(-0.6, 0.6)) * len; z += Math.sin(ang + rr(-0.6, 0.6)) * len; y -= rr(0.6, 1.6);
      }
    }
    void cam; void lastX; void lastZ;
  }

  updateBolts(dt) {
    const R = this.ribbons;
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      b.t += dt;
      b.regen -= dt;
      if (b.regen <= 0 && b.t < 0.2) { b.regen = 0.06; this.genBolt(b); }
      const k = b.t / 0.3;
      const flick = k < 0.8 ? (0.7 + 0.3 * Math.sin(b.t * 90 + b.seed)) : 0;
      const a = (1 - clamp01(k)) * flick;
      for (const id of b.ids) if (id >= 0) { R.sa[id] = a * 1.6; R.sw[id] = 1 + (1 - k) * 0.3; }
      if (b.t >= 0.3) { for (const id of b.ids) R.release(id); this.bolts.splice(i, 1); }
    }
  }

  // ---------------------------------------------------------------------
  // Wings of the Sedu
  // ---------------------------------------------------------------------
  onLeapStart(e) {
    this.wingT = 0;
    this.wingFade = -1;
    const p = e.pos;
    const gy = this.ground(p.x, p.z);
    this.ringFlat(p.x, 0.1, p.z, 0.5, 4.2, 0.35, 0xffe6a8, 0.9, 1.5);
    this.puffs(p.x, gy + 0.15, p.z, 8, 0.4, 3, 0.8, 0xcdb48a, 0.7, 1.8, 0.7, 0.35);
    this.motes(p.x, gy + 0.5, p.z, 16, 0.5, 4, 5, 0xfff2c8, 0xffc050, 0.3, 0.8, 4, F.SHARD, 1.6);
    this.flash(p.x, p.y + 1.2, p.z, 3.2, 0xfff0c0, 0.2, 2);
  }

  onLeapLand(e) {
    const p = e.pos, r = e.r;
    const gy = this.ground(p.x, p.z);
    this.wingFade = 0;
    this.ringFlat(p.x, 0.1, p.z, 1, r * 2.9, 0.5, 0xffe6a8, 1, 1.8);
    this.ringFlat(p.x, 0.12, p.z, 0.6, r * 2.0, 0.35, 0xffffff, 0.8, 2);
    this.decal(p.x, p.z, r * 2.6, F.CRACK, 0xffb040, 0.9, 0.8, true, 1.5);
    this.decal(p.x, p.z, r * 2.6, F.CRACK, 0x120c08, 0.85, 6, false);
    this.decal(p.x, p.z, r * 2.2, F.SCORCH, 0x15100a, 0.5, 6, false);
    this.puffs(p.x, gy + 0.2, p.z, 22, 0.8, 5.2, 0.9, 0xcdb48a, 1.0, 3.2, 1.0, 0.45);
    this.motes(p.x, gy + 0.3, p.z, 12, 1.2, 4, 7, 0xc8b490, 0x786a58, 0.34, 0.9, 16, F.SHARD, 0.9);
    this.sparks(p.x, gy + 0.4, p.z, 0, 0, 20, 10, 0, 0xffffff, 0xffc050, 0.34, 0.5);
    this.flash(p.x, gy + 0.8, p.z, 5.5, 0xffe9b0, 0.22, 2.2);
    this.flashLight(p.x, gy + 2.4, p.z, 0xffd48a, 30, 0.28);
  }

  updateWings(dt) {
    const w = this.wingsFx, g = this.g;
    if (this.wingT < 0) return;
    this.wingT += dt;
    let open = smooth(0, 0.12, this.wingT);
    let fade = 1;
    if (this.wingFade >= 0) { this.wingFade += dt; fade = 1 - smooth(0, 0.25, this.wingFade); if (fade <= 0) { this.wingT = -1; w.root.visible = false; return; } }
    else if (this.wingT > 1.2) { this.wingT = -1; w.root.visible = false; return; }
    w.root.visible = true;
    w.mat.opacity = 0.95 * open * fade;
    const flap = Math.sin(this.wingT * 26) * 0.32;
    w.wings[0].rotation.set(-0.35 + (1 - open) * 0.5, -0.85 * open, -(0.5 + flap) * open);
    w.wings[1].rotation.set(-0.35 + (1 - open) * 0.5, 0.85 * open, (0.5 + flap) * open);
    w.root.scale.setScalar(0.65 + open * 0.55);
    // Shed golden feathers.
    if (Math.random() < 0.8) {
      const p = g.player.pos, s = Math.random() < 0.5 ? -1 : 1;
      const f = g.player.facing;
      const rx = Math.cos(f) * s * rr(0.6, 2.6) - Math.sin(f) * 0.6, rz = -Math.sin(f) * s * rr(0.6, 2.6) - Math.cos(f) * 0.6;
      const t = this.A.begin(F.SHARD);
      t.x = p.x + rx; t.y = p.y + rr(1.4, 2.4); t.z = p.z + rz; t.vy = -0.5; t.vx = rr(-0.5, 0.5); t.vz = rr(-0.5, 0.5);
      t.life = 0.7; t.s0 = 0.32; t.s1 = 0.1; t.rot = Math.random() * 6; t.rotVel = rr(-6, 6); t.grav = 1.5; c0(t, 0xfff0c0, 1.8); c1(t, 0xffb030, 1.2);
      this.A.emit();
    }
  }

  // ---------------------------------------------------------------------
  // Aegis of Nergal
  // ---------------------------------------------------------------------
  onAegis(e) {
    const p = e.pos, gy = this.ground(p.x, p.z);
    this.ringFlat(p.x, 0.1, p.z, 0.8, 7.2, 0.55, 0xffcf4a, 1, 1.8);
    this.decal(p.x, p.z, 4.6, F.GLYPH_A, 0xffcf4a, 0.9, 1.0, true, 1.7);
    this.ringBill(p.x, p.y + 1, p.z, 0.8, 5.5, 0.4, 0xffe9a0, 1, 1.7);
    this.motes(p.x, gy + 0.2, p.z, 30, 1.4, 1.5, 6, 0xfff0b0, 0xffa020, 0.3, 0.9, -1);
    this.flash(p.x, p.y + 1, p.z, 4.5, 0xffe9a0, 0.25, 2.2);
    this.flashLight(p.x, p.y + 2, p.z, 0xffcf60, 22, 0.35);
    this.barrierMat.uniforms.uHit.value = 1;
  }

  updateBarrier(dt) {
    const p = this.g.player, u = this.barrierMat.uniforms;
    const op = p.barrierMat.opacity;
    if (p.barrier > this.barrierPeak) this.barrierPeak = p.barrier;
    if (p.barrier <= 0) this.barrierPeak = 0;
    const frac = this.barrierPeak > 0 ? clamp01(p.barrier / this.barrierPeak) : u.uFrac.value;
    u.uFrac.value += (frac - u.uFrac.value) * Math.min(1, dt * 8);
    let I = clamp01(op / 0.18) * 1.1;
    if (p.barrier > 0 && p.barrierTime < 1.2) I *= 0.65 + 0.35 * Math.sin(this.now * 28);
    u.uI.value = I;
    if (p.barrier < this.lastBarrier - 0.01) u.uHit.value = 1;
    this.lastBarrier = p.barrier;
    u.uHit.value = Math.max(0, u.uHit.value - dt * 3.5);
    p.barrierMesh.visible = I > 0.01;
    if (p.barrier > 0 && Math.random() < dt * 14) {
      const a = Math.random() * TAU;
      this.glint(p.pos.x + Math.cos(a) * 1.2, p.pos.y + rr(0.3, 2.0), p.pos.z + Math.sin(a) * 1.2, 0.45, 0xffe6a0, 0.35);
    }
  }

  // ---------------------------------------------------------------------
  // Gibil's Pyre
  // ---------------------------------------------------------------------
  onPyrePulse(e) {
    const p = e.pos, r = e.r, gy = this.ground(p.x, p.z);
    this.srcFrame = this.frame;
    this.ringFlat(p.x, 0.1, p.z, 1.2, r * 2.2, 0.5, 0xff9a3a, 0.95, 1.7, F.WAVE, 1, 0xff3a10);
    this.ringFlat(p.x, 0.12, p.z, 0.8, r * 1.9, 0.4, 0xffe0a0, 0.7, 1.9, F.RING);
    const n = this.ps.n(14);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + Math.random() * 0.3;
      const rad = r * rr(0.7, 1.0);
      const t = this.A.begin(F.FLAME);
      t.x = p.x + Math.sin(a) * rad; t.y = gy + 0.5; t.z = p.z + Math.cos(a) * rad;
      t.vx = Math.sin(a) * 1.5; t.vz = Math.cos(a) * 1.5; t.vy = rr(2.4, 4.2);
      t.life = rr(0.45, 0.8); t.s0 = rr(1.2, 1.9); t.s1 = t.s0 * 0.4; t.drag = 1.2; t.fp = 1.2;
      c0(t, 0xffe08a, 2.0); c1(t, 0xff3a0a, 1.0);
      this.A.emit();
    }
    this.motes(p.x, gy + 0.3, p.z, 10, r * 0.8, 2, 5, 0xffd070, 0xff4010, 0.26, 1.0, -1.5);
    this.flashLight(p.x, gy + 2, p.z, 0xff7a2a, 24, 0.3);
  }

  updatePyreAura(dt) {
    const g = this.g, p = g.player;
    if (g.abilities.pyre <= 0 || p.dead) return;
    this.pyreEmit -= dt;
    if (this.pyreEmit > 0) return;
    this.pyreEmit = 0.045;
    const a = Math.random() * TAU, r = rr(0.3, 1.1);
    const t = this.A.begin(F.FLAME);
    t.x = p.pos.x + Math.cos(a) * r; t.y = p.pos.y + 0.2; t.z = p.pos.z + Math.sin(a) * r;
    t.vy = rr(1.8, 3.2); t.vx = Math.cos(a) * 0.4; t.vz = Math.sin(a) * 0.4;
    t.life = rr(0.4, 0.7); t.s0 = rr(0.9, 1.3); t.s1 = 0.3; t.fp = 1.2;
    c0(t, 0xffd070, 1.8); c1(t, 0xff3000, 1);
    this.A.emit();
    if (Math.random() < 0.4) this.motes(p.pos.x, p.pos.y + 0.6, p.pos.z, 1, 1.0, 1, 4, 0xffe090, 0xff4010, 0.2, 1.0, -1.5);
  }

  // ---------------------------------------------------------------------
  // Evade, potion
  // ---------------------------------------------------------------------
  onEvade(e) {
    const p = e.pos, d = e.dir, gy = this.ground(p.x, p.z);
    this.ghostTimer = 0;
    this.puffs(p.x, gy + 0.15, p.z, 6, 0.3, 2.2, 0.6, 0xcdb48a, 0.6, 1.5, 0.6, 0.38);
    this.sparks(p.x, gy + 0.3, p.z, -d.x, -d.z, 8, 5, 0.6, 0xd8e8ff, 0x4d86ff, 0.22, 0.3, 4);
    this.ringFlat(p.x, 0.1, p.z, 0.4, 2.8, 0.3, 0x9fc4ff, 0.7, 1.4);
    this.flash(p.x, p.y + 0.8, p.z, 2.2, 0xb8d4ff, 0.14, 1.6);
  }

  updateGhosts(dt) {
    const p = this.g.player;
    if (p.state === 'evade') {
      this.ghostTimer -= dt;
      if (this.ghostTimer <= 0) {
        this.ghostTimer = 0.028;
        const gh = this.ghosts[this.ghostCursor];
        this.ghostCursor = (this.ghostCursor + 1) % this.ghosts.length;
        gh.t = 0; gh.dur = 0.34;
        gh.mesh.position.copy(p.pos); gh.mesh.rotation.y = p.facing;
        gh.mesh.visible = true;
      }
      if (Math.random() < 0.7) {
        const gy = this.ground(p.pos.x, p.pos.z);
        this.puffs(p.pos.x, gy + 0.1, p.pos.z, 1, 0.3, 1.2, 0.3, 0xcdb48a, 0.5, 1.2, 0.5, 0.3);
        this.glow(p.pos.x, p.pos.y + 1, p.pos.z, 1.4, 0x6aa0ff, 0.15, 0.5);
      }
    }
    for (const gh of this.ghosts) {
      if (!gh.mesh.visible) continue;
      gh.t += dt;
      const k = gh.t / gh.dur;
      if (k >= 1) { gh.mesh.visible = false; continue; }
      gh.mesh.material.uniforms.uA.value = (1 - k) * (1 - k) * 0.9;
      const s = 1 + k * 0.06;
      gh.mesh.scale.set(s, 1, s);
    }
  }

  onPotion(e) {
    const p = e.pos;
    this.potionSwirls.push({ t: 0, x: 0, follow: true });
    this.ringFlat(p.x, 0.1, p.z, 0.5, 3.6, 0.7, 0x5dff8a, 0.9, 1.5, F.GLOW_RING);
    this.flash(p.x, p.y + 1, p.z, 3.4, 0x9dffb0, 0.3, 1.8, F.DOT);
    for (let i = 0; i < 3; i++) {
      const t = this.A.begin(F.PLUS);
      t.x = p.x + rr(-0.5, 0.5); t.y = p.y + 0.6 + i * 0.35; t.z = p.z + rr(-0.5, 0.5); t.vy = rr(1.4, 2.2);
      t.life = 0.9; t.s0 = 0.5; t.s1 = 0.85; t.fp = 1.3; t.fin = 0.08; c0(t, 0xa0ffb4, 1.8); c1(t, 0x3aff72, 1);
      this.A.emit();
    }
  }

  updateSwirls(dt) {
    const p = this.g.player;
    for (let i = this.potionSwirls.length - 1; i >= 0; i--) {
      const s = this.potionSwirls[i];
      s.t += dt;
      if (s.t > 1.0) { this.potionSwirls.splice(i, 1); continue; }
      const n = this.ps.n(5);
      for (let k = 0; k < n; k++) {
        const ph = s.t * 9 + k * (TAU / n);
        const red = k % 3 === 2;
        const rad = 0.85 - s.t * 0.3;
        const t = this.A.begin(F.DOT);
        t.x = p.pos.x + Math.cos(ph) * rad; t.z = p.pos.z + Math.sin(ph) * rad; t.y = p.pos.y + 0.1 + s.t * 1.8;
        t.vy = 1.8; t.vx = -Math.sin(ph) * 1.2; t.vz = Math.cos(ph) * 1.2;
        t.life = 0.5; t.s0 = 0.4; t.s1 = 0.1; t.fp = 1.4;
        if (red) { c0(t, 0xff6a6a, 1.8); c1(t, 0xff2030, 1); } else { c0(t, 0x9dffb0, 1.8); c1(t, 0x20ff60, 1); }
        this.A.emit();
      }
    }
  }

  onPlayerHurt(e) {
    const p = e.pos;
    this.sparks(p.x, p.y + 1.1, p.z, 0, 0, 8, 6, 0, 0xff8a8a, 0xb01020, 0.26, 0.35);
    this.flash(p.x, p.y + 1.1, p.z, 2.0, 0xff6a6a, 0.12, 1.5);
  }

  // ---------------------------------------------------------------------
  // Enemies: windup, attacks, hazards, death
  // ---------------------------------------------------------------------
  onWindup(e) {
    const en = e.enemy;
    if (this.hitBudget <= 0) return;
    this.flash(en.pos.x, en.pos.y + 1.7 * en.scale, en.pos.z, 1.3 * en.scale, en.def.ai === 'caster' ? 0xd29bff : 0xff5a3a, 0.28, 1.6, F.GLINT);
  }

  onEnemyAttack(e) {
    const en = e.enemy, f = en.facing;
    const sf = Math.sin(f), cf = Math.cos(f);
    const reach = (en.def.range ?? 1.8) * en.scale + 0.6;
    this.slashes.spawn({
      center: _v.set(en.pos.x, en.pos.y + 1.0, en.pos.z), axU: _v2.set(sf, 0.1, cf), axV: _v3.set(cf, 0, -sf),
      a0: 1.1, a1: -1.1, r0: 0.5, r1: reach, color: 0xff3a2a, hot: 0xffc9a8, dur: 0.07, hold: 0.1, tail: 3, power: 1.3,
    });
  }

  onEnemyProjectile(e) {
    const en = e.enemy, f = en.facing;
    const x = en.pos.x + Math.sin(f) * 0.9, y = en.pos.y + 1.1, z = en.pos.z + Math.cos(f) * 0.9;
    this.flash(x, y, z, 1.6, 0xb8ff6a, 0.14, 2);
    this.sparks(x, y, z, Math.sin(f), Math.cos(f), 6, 7, 0.5, 0xeaffb0, 0x66dd22, 0.22, 0.3, 2);
  }

  onHazardBlast(e) {
    const { x, z, r } = e;
    const style = styleForColor(e.color);
    const gy = this.ground(x, z);
    this.hitBudget = Math.max(this.hitBudget, 0);
    if (style === 'void') {
      this.ringFlat(x, 0.1, z, r * 0.6, r * 2.5, 0.45, 0xc47dff, 1, 1.7, F.WAVE);
      this.decal(x, z, r * 2.2, F.GLYPH_B, 0xe0b0ff, 0.9, 0.55, true, 1.8);
      this.flash(x, gy + 0.8, z, r * 2.2, 0xe3b8ff, 0.2, 2.2);
      this.wisps(x, gy + 0.2, z, 10, r * 0.7, 0xd9a0ff, 0x7a2bd8, 1.3, 1.1, 4.2);
      this.motes(x, gy + 0.4, z, 14, r * 0.6, 3, 6, 0xf0d0ff, 0x8a3bff, 0.3, 0.9, -1);
      this.puffs(x, gy + 0.4, z, 4, r * 0.4, 1.4, 0.8, 0x4a1f6a, 1.0, 2.6, 1.0, 0.4);
      this.flashLight(x, gy + 2, z, 0xb06dff, 26, 0.3);
    } else if (style === 'crack') {
      this.decal(x, z, r * 2.6, F.CRACK, 0xff6a20, 0.95, 1.0, true, 1.6);
      this.decal(x, z, r * 2.6, F.CRACK, 0x120a08, 0.85, 7, false);
      this.ringFlat(x, 0.1, z, r * 0.5, r * 2.8, 0.45, 0xffa050, 0.9, 1.6);
      this.puffs(x, gy + 0.3, z, 20, r * 0.5, 5, 1.2, 0x9a8870, 1.0, 3.4, 1.1, 0.5);
      this.motes(x, gy + 0.4, z, 16, r * 0.6, 4, 8, 0xb8a890, 0x5a5048, 0.4, 1.0, 18, F.SHARD, 0.9);
      this.sparks(x, gy + 0.5, z, 0, 0, 14, 10, 0, 0xffe0a0, 0xff6a20, 0.32, 0.5);
      this.flash(x, gy + 0.8, z, r * 2.4, 0xffc080, 0.2, 2);
      this.flashLight(x, gy + 2, z, 0xff7a3a, 24, 0.3);
    } else if (style === 'seal') {
      this.pillar(x, gy, z, 0xffc13a, 0xfff6c8, r * 0.7, 16, 0.55, 1.3);
      this.ringFlat(x, 0.1, z, r * 0.4, r * 2.6, 0.5, 0xffd560, 1, 1.8);
      this.decal(x, z, r * 2.2, F.GLYPH_A, 0xffe08a, 0.9, 0.6, true, 1.8);
      this.motes(x, gy + 0.3, z, 22, r * 0.5, 1.5, 9, 0xfff2b8, 0xff9a20, 0.3, 1.1, -2);
      this.flash(x, gy + 1, z, r * 2.2, 0xfff0c0, 0.2, 2.2);
      this.flashLight(x, gy + 3, z, 0xffcf60, 28, 0.35);
    } else if (style === 'storm') {
      this.onLightning({ pos: _v.set(x, gy, z) });
    } else if (style === 'molten') {
      this.ringFlat(x, 0.1, z, r * 0.5, r * 2.5, 0.4, 0xff8a30, 1, 1.7, F.WAVE, 1, 0xff3000);
      this.decal(x, z, r * 2.3, F.SCORCH, 0x1a0804, 0.8, 7, false);
      this.decal(x, z, r * 2.2, F.SCORCH, 0xff5a10, 0.8, 1.4, true, 1.6);
      for (let i = 0; i < this.ps.n(8); i++) {
        const t = this.A.begin(F.FLAME);
        const a = Math.random() * TAU, d = Math.random() * r * 0.7;
        t.x = x + Math.cos(a) * d; t.y = gy + 0.3; t.z = z + Math.sin(a) * d; t.vy = rr(3, 6); t.life = rr(0.5, 0.9); t.s0 = rr(1.3, 2.2); t.s1 = 0.4; t.grav = 3;
        c0(t, 0xffe08a, 2); c1(t, 0xff2a00, 1); this.A.emit();
      }
      this.motes(x, gy + 0.4, z, 18, r * 0.6, 3, 8, 0xffd070, 0xff3a00, 0.34, 1.1, 12);
      this.flash(x, gy + 0.8, z, r * 2.2, 0xffd090, 0.22, 2);
      this.flashLight(x, gy + 2, z, 0xff6a1a, 26, 0.35);
    } else {
      this.ringFlat(x, 0.1, z, r * 0.5, r * 2.5, 0.4, 0xff6a3a, 1, 1.6);
      this.flash(x, gy + 0.6, z, r * 2.0, 0xffb090, 0.2, 2);
      this.motes(x, gy + 0.4, z, 16, r * 0.5, 4, 6, 0xffd0a0, 0xff3a1a, 0.3, 0.7, 10);
      this.puffs(x, gy + 0.3, z, 8, r * 0.4, 3, 0.8, 0x6a5040, 0.8, 2.4, 0.9, 0.4);
      this.flashLight(x, gy + 2, z, 0xff5a3a, 20, 0.28);
    }
  }

  onBossPhase(e) {
    const g = this.g, b = e.boss;
    g.renderer.pulse(0xb48aff, 0.35);
    if (b) {
      const gy = this.ground(b.pos.x, b.pos.z);
      this.ringFlat(b.pos.x, 0.1, b.pos.z, 1, 22, 0.8, 0xb48aff, 1, 1.7);
      this.pillar(b.pos.x, gy, b.pos.z, 0x9a6bff, 0xf0e0ff, 2.4, 26, 1.2, 1.2);
      this.wisps(b.pos.x, gy, b.pos.z, 24, 4, 0xd9b0ff, 0x6a2bd8, 1.6, 1.6);
      this.flashLight(b.pos.x, gy + 3, b.pos.z, 0xb48aff, 40, 0.5);
    }
  }

  onKill(e) {
    const en = e.enemy;
    const x = en.pos.x, y = en.pos.y, z = en.pos.z;
    const big = en.boss ? 3 : en.named ? 2 : en.elite ? 1 : 0;
    const sc = en.scale ?? 1;
    this.wisps(x, y + 0.8, z, big === 3 ? 30 : big === 2 ? 14 : big === 1 ? 7 : 4, 0.5 * sc, 0xb070ff, 0x5a18d0, 1.5 + big * 0.4, 1.5 + big * 0.2, 2.6, 1.1);
    this.motes(x, y + 0.9, z, big ? 24 + big * 12 : 8, 0.4 * sc, 3 + big, 3 + big, 0xffe39a, 0xd6a740, 0.2 + big * 0.06, 0.9, 5);
    this.flash(x, y + 1.0, z, 2.4 + big, 0xb070ff, 0.22, 1.2, F.DOT);
    this.ringFlat(x, 0.1, z, 0.5, 3.4 + big * 1.8, 0.4, 0xb98aff, 0.7 + big * 0.1, 1.4);
    if (big >= 1) {
      this.glint(x, y + 1.4, z, 2.2 + big, 0xfff0c0, 0.4, 2.2);
      this.ringFlat(x, 0.12, z, 1, 6 + big * 2.5, 0.6, 0xffd68a, 0.8, 1.5);
    }
    if (big >= 2) {
      this.decal(x, z, 7, F.GLYPH_A, 0xc9a0ff, 0.9, 1.4, true, 1.5);
      this.flashLight(x, y + 2, z, 0xb48aff, 30, 0.5);
    }
    if (en.boss) {
      const g = this.g;
      this.pillar(x, y, z, 0xb48aff, 0xffffff, 2.6, 34, 3.0, 1.5, 1);
      this.ringFlat(x, 0.1, z, 2, 28, 1.1, 0xe0c8ff, 1, 1.8);
      this.ringFlat(x, 0.12, z, 1, 18, 0.8, 0xffffff, 0.8, 2);
      this.schedule(0.4, () => { this.wisps(x, y + 0.5, z, 26, 3.5, 0xe0b8ff, 0x7a3bff, 1.7, 2.2, 5); this.ringFlat(x, 0.1, z, 2, 30, 1.0, 0xc9a0ff, 0.9, 1.6); });
      this.schedule(1.0, () => { this.motes(x, y + 0.5, z, 60, 3, 3, 9, 0xffe39a, 0xd6a740, 0.34, 2.2, -0.5); });
      g.renderer.pulse(0xe9d8ff, 0.55);
      g.fx.shake(0.7);
    }
  }

  // ---------------------------------------------------------------------
  // Loot
  // ---------------------------------------------------------------------
  onLootDrop(e) {
    const rar = e.item.rarity;
    const cfg = RARITY_FX[rar] ?? RARITY_FX.common;
    const p = e.pos;
    this.schedule(0.42, () => {
      const gy = this.ground(p.x, p.z);
      this.puffs(p.x, gy + 0.1, p.z, 3 + cfg.tier * 2, 0.2, 1.2, 0.5, 0xcdb48a, 0.5, 1.2, 0.5, 0.35);
      this.ringFlat(p.x, 0.1, p.z, 0.4, 1.6 + cfg.tier * 0.8, 0.45, cfg.hex, 0.9, 1.6, F.WAVE);
      this.sparks(p.x, gy + 0.3, p.z, 0, 0, 3 + cfg.tier * 4, 4 + cfg.tier, 0, cfg.hot, cfg.hex, 0.2, 0.4, 10);
      if (cfg.tier >= 2) { this.flash(p.x, gy + 0.6, p.z, 2.5 + cfg.tier, cfg.hot, 0.25, 2, F.STAR); this.flashLight(p.x, gy + 1.4, p.z, cfg.hex, 12 + cfg.tier * 6, 0.35); }
      if (cfg.tier >= 3) {
        this.g.renderer.pulse(0xff9a2e, 0.25);
        this.pillar(p.x, gy, p.z, cfg.hex, 0xfff0d0, 0.9, 22, 1.0, 1.4, 1);
        this.ringFlat(p.x, 0.12, p.z, 0.5, 8, 0.7, 0xffb050, 0.9, 1.8);
        this.motes(p.x, gy + 0.3, p.z, 28, 0.6, 3, 8, 0xfff0c0, 0xff8a20, 0.3, 1.4, -1);
        for (let i = 0; i < 4; i++) this.glint(p.x + rr(-0.8, 0.8), gy + rr(0.4, 2.5), p.z + rr(-0.8, 0.8), 1.2, 0xfff0c0, 0.6);
      }
    });
  }

  updateLoot(dt) {
    const g = this.g, items = g.loot.items;
    const player = g.player.pos;
    for (let i = 0; i < items.length; i++) {
      const L = items[i];
      const cfg = RARITY_FX[L.item.rarity] ?? RARITY_FX.common;
      const dx = L.pos.x - player.x, dz = L.pos.z - player.z;
      if (dx * dx + dz * dz > 1600) continue; // far away: skip ambient effects
      if (L.t < 1) {
        if (cfg.tier >= 1 && Math.random() < 0.7) this.glow(L.mesh.position.x, L.mesh.position.y, L.mesh.position.z, 0.9, cfg.hex, 0.2, 0.8);
        continue;
      }
      L.fxT = (L.fxT ?? Math.random() * 0.2) - dt;
      if (L.fxT <= 0) {
        L.fxT = 0.2;
        const t = this.A.begin(F.GLOW_RING);
        t.x = L.pos.x; t.y = 0.07; t.z = L.pos.z; t.mode = 1; t.s0 = cfg.ring * 0.92; t.s1 = cfg.ring * 1.08; t.life = 0.3; t.a = cfg.ringA; t.fp = 0.8; t.fin = 0.06; t.rot = 0;
        c0(t, cfg.hex, 1.5);
        this.A.emit();
      }
      if (cfg.tier === 1 && Math.random() < dt * 1.1) this.glint(L.pos.x + rr(-0.35, 0.35), L.pos.y + rr(0.2, 0.9), L.pos.z + rr(-0.35, 0.35), 0.55, 0xbcd8ff, 0.45);
      if (cfg.tier === 2 && Math.random() < dt * 2.2) this.glint(L.pos.x + rr(-0.4, 0.4), L.pos.y + rr(0.2, 2.5), L.pos.z + rr(-0.4, 0.4), 0.6, 0xfff0a0, 0.5);
      if (cfg.tier >= 3) {
        // Spiral of sparks winding up the beam.
        for (let k = 0; k < 2; k++) {
          const ph = this.now * 3.2 + k * Math.PI;
          const t = this.A.begin(F.DOT);
          t.x = L.pos.x + Math.cos(ph) * 0.55; t.z = L.pos.z + Math.sin(ph) * 0.55; t.y = L.pos.y + 0.1;
          t.vy = rr(2.6, 3.6); t.vx = -Math.sin(ph) * 1.0; t.vz = Math.cos(ph) * 1.0; t.life = 1.6; t.s0 = 0.34; t.s1 = 0.1; t.fp = 0.9;
          c0(t, 0xfff0c0, 1.9); c1(t, 0xff7a20, 1.3);
          this.A.emit();
        }
        if (Math.random() < dt * 4) this.glint(L.pos.x + rr(-0.5, 0.5), L.pos.y + rr(0.3, 5), L.pos.z + rr(-0.5, 0.5), 0.9, 0xfff0c0, 0.5);
      }
    }
    const pk = g.loot.pickups;
    for (let i = 0; i < pk.length; i++) {
      const o = pk[i];
      if (o.age < 0.5) continue;
      if (o.kind === 'gold') {
        if (Math.random() < dt * 1.6) this.glint(o.pos.x + rr(-0.15, 0.15), o.pos.y + 0.15, o.pos.z + rr(-0.15, 0.15), 0.55, 0xfff0a0, 0.4);
      } else if (Math.random() < dt * 8) {
        this.glow(o.pos.x, o.pos.y + 0.1, o.pos.z, 0.8, 0xff4a5a, 0.2, 0.7);
      }
    }
  }

  onPickup(e) {
    const p = this.g.player;
    const from = e.pos ?? p.pos;
    const hex = e.kind === 'gold' ? 0xffd45a : e.kind === 'orb' ? 0xff4a5a : (RARITY_FX[e.rarity] ?? RARITY_FX.common).hex;
    const n = this.ps.n(e.kind === 'item' ? 18 : 10);
    for (let i = 0; i < n; i++) {
      const t = this.A.begin(F.DOT);
      const a = Math.random() * TAU;
      t.x = from.x; t.y = from.y + 0.2; t.z = from.z;
      // Fly toward the hero's chest.
      const tx = p.pos.x - from.x, ty = p.pos.y + 1.1 - from.y, tz = p.pos.z - from.z;
      const d = Math.hypot(tx, ty, tz) || 1, sp = 7 + Math.random() * 5;
      t.vx = tx / d * sp + Math.cos(a) * 2; t.vy = ty / d * sp + rr(0, 3); t.vz = tz / d * sp + Math.sin(a) * 2;
      t.life = Math.min(0.5, d / sp + 0.1); t.s0 = 0.3; t.s1 = 0.08; t.drag = 0.5; t.fp = 0.7;
      c0(t, 0xffffff, 1.8); c1(t, hex, 1.6);
      this.A.emit();
    }
    this.flash(p.pos.x, p.pos.y + 1.1, p.pos.z, 1.6, hex, 0.18, 1.6, F.GLINT);
    if (e.kind === 'item') this.ringFlat(p.pos.x, 0.1, p.pos.z, 0.4, 2.4, 0.35, hex, 0.8, 1.5);
  }

  onChest(e) {
    const p = e.pos;
    this.flash(p.x, p.y + 1.1, p.z, 4, 0xffe39a, 0.3, 2);
    this.motes(p.x, p.y + 0.8, p.z, 24, 0.5, 2.5, 6, 0xfff0b0, 0xffa020, 0.3, 1.0, 2);
    this.pillar(p.x, p.y, p.z, 0xffd060, 0xffffff, 0.6, 8, 0.7, 0.9);
  }

  // ---------------------------------------------------------------------
  // Level up
  // ---------------------------------------------------------------------
  onLevelUp() {
    const p = this.g.player.pos, gy = this.ground(p.x, p.z);
    this.levelT = 0;
    this.pillar(p.x, gy, p.z, 0xffc844, 0xfff6d0, 1.35, 24, 1.9, 1.5, 0.5);
    this.decal(p.x, p.z, 7, F.GLYPH_A, 0xffd870, 0.9, 1.6, true, 1.8);
    this.ringFlat(p.x, 0.1, p.z, 1, 14, 0.9, 0xffe29a, 1, 1.7);
    for (let i = 0; i < 4; i++) {
      this.schedule(i * 0.2, () => {
        const q = this.g.player.pos;
        const t = this.A.begin(F.GLYPH_A);
        t.x = q.x; t.y = q.y + 0.2; t.z = q.z; t.mode = 2; t.vy = 3.0; t.s0 = 5.0; t.s1 = 3.2; t.life = 1.15; t.fp = 1.2; t.fin = 0.1;
        t.rotVel = i % 2 ? 1.4 : -1.4; c0(t, 0xffd870, 1.8); c1(t, 0xffa020, 1.2);
        this.A.emit();
      });
    }
    this.flash(p.x, gy + 1.2, p.z, 6, 0xfff0c0, 0.4, 2.4, F.DOT);
    this.flashLight(p.x, gy + 2.5, p.z, 0xffd870, 34, 0.7);
  }

  updateLevel(dt) {
    if (this.levelT < 0) return;
    this.levelT += dt;
    if (this.levelT > 1.6) { this.levelT = -1; return; }
    const p = this.g.player.pos;
    const n = this.ps.n(4);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, r = rr(0.5, 1.4);
      const t = this.A.begin(F.GLINT);
      t.x = p.x + Math.cos(a) * r; t.y = p.y + 0.2; t.z = p.z + Math.sin(a) * r; t.vy = rr(3, 7); t.life = rr(0.6, 1.2);
      t.s0 = rr(0.3, 0.7); t.s1 = 0.1; t.fp = 0.9; t.fin = 0.06; c0(t, 0xfff2c0, 2); c1(t, 0xffb030, 1.3);
      this.A.emit();
    }
  }

  // ---------------------------------------------------------------------
  // per frame
  // ---------------------------------------------------------------------
  update(dt) {
    const g = this.g;
    this.frame++;
    this.now += dt;
    U.time.value = (U.time.value + dt) % 3600;
    this.hitBudget = MAX_HIT_FX;
    this.ps.q = g.settings.quality.particles;

    for (let i = this.later.length - 1; i >= 0; i--) {
      const l = this.later[i];
      l.t -= dt;
      if (l.t <= 0) { this.later.splice(i, 1); l.fn(); }
    }

    this.slashes.update(dt);
    this.updateJavelins(dt);
    this.updateProjectiles(dt);
    this.updateBolts(dt);
    this.updateWings(dt);
    this.updateBarrier(dt);
    this.updatePyreAura(dt);
    this.updateGhosts(dt);
    this.updateSwirls(dt);
    this.updateLoot(dt);
    this.updateLevel(dt);

    // Tether surge animation.
    if (this.surgeT >= 0) {
      this.surgeT += dt;
      const k = this.surgeT / 0.24;
      g.tether.beam.setSurge(k >= 1 ? -1 : k * k * (3 - 2 * k));
      if (k >= 1) this.surgeT = -1;
    }

    for (const p of this.pillars) {
      if (!p.mesh.visible) continue;
      p.t += dt;
      const k = p.t / p.dur;
      if (k >= 1) { p.mesh.visible = false; continue; }
      const grow = smooth(0, 0.12, k);
      p.mat.uniforms.uInt.value = p.i0 * (k < 0.12 ? grow : 1 - smooth(0.35, 1, k));
      const w = p.r * (0.55 + 0.45 * grow) * (1 - 0.35 * smooth(0.5, 1, k));
      p.mesh.scale.set(w, p.h * (0.3 + 0.7 * smooth(0, 0.18, k)), w);
    }

    for (const l of this.lights) {
      if (l.userData.t >= l.userData.dur) { l.intensity = 0; continue; }
      l.userData.t += dt;
      const k = clamp01(l.userData.t / l.userData.dur);
      l.intensity = l.userData.i0 * (1 - k) * (1 - k);
    }

    this.ribbons.flush(g.camera.position);
  }

  updateJavelins(dt) {
    const R = this.ribbons;
    for (let i = this.javs.length - 1; i >= 0; i--) {
      const j = this.javs[i];
      const m = j.mesh.position;
      if (!j.ended && !j.mesh.parent) {
        j.ended = true; j.fade = 0;
        this.flash(m.x, m.y, m.z, 1.4, 0x9cc0ff, 0.14, 1.8);
        this.sparks(m.x, m.y, m.z, 0, 0, 5, 5, 0, 0xcfe2ff, 0x4d86ff, 0.2, 0.3, 6);
      }
      if (!j.ended) {
        if (j.strip >= 0) R.push(j.strip, m.x, m.y, m.z, 0.62, 0.15, 0.45, 1.5, 1);
        this.glow(m.x, m.y, m.z, 1.5, 0x6aa0ff, 0.07, 0.9, 1.6);
        j.shard -= dt;
        if (j.shard <= 0) {
          j.shard = 0.03;
          const t = this.A.begin(F.SHARD);
          t.x = m.x + rr(-0.15, 0.15); t.y = m.y + rr(-0.15, 0.15); t.z = m.z + rr(-0.15, 0.15);
          t.vx = rr(-1.2, 1.2); t.vy = rr(-0.5, 1.5); t.vz = rr(-1.2, 1.2); t.life = rr(0.3, 0.55);
          t.s0 = rr(0.16, 0.3); t.s1 = 0.04; t.rot = Math.random() * 6; t.rotVel = rr(-9, 9); t.drag = 1;
          c0(t, 0xcfe2ff, 1.8); c1(t, 0x3b6dff, 1.1);
          this.A.emit();
        }
      } else {
        j.fade += dt;
        if (j.strip >= 0) R.sa[j.strip] = Math.max(0, 1 - j.fade / 0.28);
        if (j.fade > 0.3) { R.release(j.strip); this.javs.splice(i, 1); }
      }
    }
  }

  updateProjectiles(dt) {
    const g = this.g, R = this.ribbons;
    const list = g.enemies.projectiles;
    const stamp = this.frame;
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      let tr = this.projTrails.get(b);
      if (!tr) {
        tr = { strip: R.alloc(), seen: stamp, fade: 0, ended: false, spark: 0 };
        if (tr.strip >= 0) R.tp[tr.strip] = 1.3;
        this.projTrails.set(b, tr);
      }
      tr.seen = stamp;
      const m = b.pos;
      if (tr.strip >= 0) R.push(tr.strip, m.x, m.y, m.z, 0.5, 0.45, 1.0, 0.18, 1);
      this.glow(m.x, m.y, m.z, 1.2, 0x7cff2a, 0.07, 0.9, 1.5);
      tr.spark -= dt;
      if (tr.spark <= 0) {
        tr.spark = 0.05;
        const t = this.A.begin(F.DOT);
        t.x = m.x + rr(-0.1, 0.1); t.y = m.y + rr(-0.1, 0.1); t.z = m.z + rr(-0.1, 0.1); t.vy = rr(0.3, 1.2); t.life = 0.45; t.s0 = 0.28; t.s1 = 0.05;
        c0(t, 0xd8ff7a, 1.6); c1(t, 0x2a9a14, 0.8);
        this.A.emit();
      }
    }
    this._dt = dt;
    this._stamp = stamp;
    this.projTrails.forEach(this._fadeTrail);
  }

  // Fades the trail of a projectile that no longer exists (Map.forEach callback, no allocation).
  _fadeTrail = (tr, b) => {
    if (tr.seen === this._stamp) return;
    if (!tr.ended) {
      tr.ended = true;
      const m = b.pos;
      this.flash(m.x, m.y, m.z, 1.5, 0xb8ff6a, 0.16, 1.8);
      this.sparks(m.x, m.y, m.z, 0, 0, 6, 5, 0, 0xeaffb0, 0x44aa18, 0.2, 0.35, 8);
    }
    tr.fade += this._dt;
    if (tr.strip >= 0) this.ribbons.sa[tr.strip] = Math.max(0, 1 - tr.fade / 0.25);
    if (tr.fade > 0.28) { this.ribbons.release(tr.strip); this.projTrails.delete(b); }
  };
}
