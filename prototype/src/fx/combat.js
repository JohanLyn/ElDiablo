import { F } from './atlas.js';
import { TAU, rr, col0, col1 } from './shared.js';
import * as THREE from 'three';

// Combat feel layered on top of the Vfx director: stylised ichor per monster
// family, short-lived ground splatter, screen-space shockwaves with sensible
// anti-flood rules, hit-weight tuning, and the slow-motion death moments of
// elites, champions and guardians. Everything draws through the shared particle
// layers (no draw calls of its own) and allocates nothing per frame.

// Ichor palette per family. dark: dried stain / droplets at the end of life;
// core: wet colour at birth; hot: additive fleck (visible on dark floors).
export const FAMILY = {
  gallu: { dark: 0x1b0509, core: 0x7a0e1c, hot: 0xd02a30, glow: 0.4, splat: 0x2a060b },   // dark crimson-black
  utukku: { dark: 0x7fb0d8, core: 0xbfe4ff, hot: 0xf0ffff, glow: 1.0, mist: true },       // pale ghost-blue mist
  lilitu: { dark: 0x2a0d4a, core: 0x8a3dff, hot: 0xe6c8ff, glow: 0.8, splat: 0x2a0d4a },  // violet
  scorpion: { dark: 0x3d4a0a, core: 0xb8b81c, hot: 0xd4ff46, glow: 0.8, splat: 0x3a4a0a, venom: true }, // amber-green venom
  asag: { dark: 0x2e2822, core: 0x8a7b68, hot: 0xffa03a, glow: 1.0, splat: 0x2a2420, chips: true, ember: true }, // molten + stone chips
  neti: { dark: 0x201850, core: 0x8f66ff, hot: 0xffe6a0, glow: 0.9, splat: 0x1c1448 },
};

const MIN_GAP = [0.24, 0.12, 0];       // seconds between waves of the same tier
const SPLAT_CAP = 44;                    // live ground splatters at once
const _p = new THREE.Vector3();

export class CombatFx {
  constructor(v) {
    this.v = v;
    this.g = v.g;
    this.waveT = [-9, -9, -9];
    this.splatT = new Float32Array(SPLAT_CAP);
    this.splatI = 0;
    this.ichorLeft = 8;
    this.kickFrame = -1;
  }

  frame() { this.ichorLeft = 8; }

  // ---------------------------------------------------------------------
  // shockwaves
  // ---------------------------------------------------------------------
  // tier 0 = small (crit, lightning), 1 = slam, 2 = boss. Small waves yield to bigger ones that just fired.
  shock(x, y, z, strength, radius, life, tier = 0) {
    const v = this.v, now = v.now, T = this.waveT;
    if (now - T[tier] < MIN_GAP[tier]) return;
    if (tier === 0 && (now - T[1] < 0.3 || now - T[2] < 0.6)) return;
    if (tier === 1 && now - T[2] < 0.45) return;
    T[tier] = now;
    if (this.g.settings?.get('screenShake') === false) strength *= 0.5; // motion-sensitive players get a calmer ring
    _p.set(x, y, z);
    this.g.renderer.shockwave(_p, strength, radius, life);
  }

  // ---------------------------------------------------------------------
  // ichor
  // ---------------------------------------------------------------------
  family(en) { return FAMILY[en.type] ?? FAMILY.gallu; }

  canSplat(life) {
    const i = this.splatI;
    if (this.splatT[i] > this.v.now) return false;
    this.splatT[i] = this.v.now + life;
    this.splatI = (i + 1) % SPLAT_CAP;
    return true;
  }

  // Thrown droplets (alpha layer, stretched along their velocity).
  droplets(f, x, y, z, dx, dz, n, spd, cone, size, life) {
    n = this.v.ps.n(n);
    const B = this.v.B, base = Math.atan2(dx, dz), omni = dx === 0 && dz === 0;
    for (let i = 0; i < n; i++) {
      const t = B.begin(F.DOT);
      const a = omni ? Math.random() * TAU : base + (Math.random() - 0.5) * 2 * cone;
      const s = spd * (0.45 + Math.random() * 0.75);
      t.x = x; t.y = y; t.z = z;
      t.vx = Math.sin(a) * s; t.vz = Math.cos(a) * s; t.vy = rr(1.5, 5.5);
      t.life = life * (0.7 + Math.random() * 0.6);
      t.s0 = size * (0.7 + Math.random() * 0.8); t.s1 = t.s0 * 0.5;
      t.stretch = 0.06; t.grav = 20; t.drag = 0.4; t.a = 0.95; t.fp = 0.5; t.fin = 0.004;
      col0(t, f.core); col1(t, f.dark);
      B.emit();
    }
  }

  // Bright additive flecks so ichor still reads on dark floors and in shadow.
  flecks(f, x, y, z, dx, dz, n, spd, cone, size, life) {
    n = this.v.ps.n(n);
    const A = this.v.A, base = Math.atan2(dx, dz), omni = dx === 0 && dz === 0;
    for (let i = 0; i < n; i++) {
      const t = A.begin(F.DOT);
      const a = omni ? Math.random() * TAU : base + (Math.random() - 0.5) * 2 * cone;
      const s = spd * (0.4 + Math.random() * 0.8);
      t.x = x; t.y = y; t.z = z;
      t.vx = Math.sin(a) * s; t.vz = Math.cos(a) * s; t.vy = rr(0.8, 4.5);
      t.life = life * (0.6 + Math.random() * 0.7);
      t.s0 = size * (0.7 + Math.random() * 0.8); t.s1 = t.s0 * 0.25;
      t.grav = f.mist ? -0.4 : 14; t.drag = 0.9; t.a = f.glow;
      col0(t, f.hot, 1.5); col1(t, f.core, 1.1);
      A.emit();
    }
  }

  // Pale ghost mist (Utukku): soft puffs plus a few rising wisps.
  mist(f, x, y, z, n, size) {
    const v = this.v;
    n = v.ps.n(n);
    const B = v.B;
    for (let i = 0; i < n; i++) {
      const t = B.begin(F.SMOKE);
      const a = Math.random() * TAU, r = Math.random() * 0.3;
      t.x = x + Math.cos(a) * r; t.y = y + Math.random() * 0.3; t.z = z + Math.sin(a) * r;
      t.vx = Math.cos(a) * 0.9; t.vz = Math.sin(a) * 0.9; t.vy = rr(0.4, 1.3);
      t.life = rr(0.6, 1.0); t.s0 = size * rr(0.5, 0.8); t.s1 = size * rr(1.5, 2.2);
      t.rot = Math.random() * 6.28; t.rotVel = rr(-1, 1); t.drag = 1.8; t.grav = -0.5; t.a = 0.42; t.fin = 0.05; t.fp = 1.4;
      col0(t, f.core);
      B.emit();
    }
    v.wisps(x, y, z, Math.max(1, Math.round(n * 0.6)), 0.3, f.hot, f.dark, size * 1.1, 0.9, 1.4, 1.1);
  }

  // A fast soft puff of ichor colour thrown out of the wound (alpha layer).
  spray(f, x, y, z, dx, dz, n, size) {
    n = this.v.ps.n(n);
    const B = this.v.B;
    for (let i = 0; i < n; i++) {
      const t = B.begin(F.SMOKE);
      t.x = x; t.y = y; t.z = z;
      t.vx = dx * rr(2.5, 4.5) + rr(-0.6, 0.6); t.vz = dz * rr(2.5, 4.5) + rr(-0.6, 0.6); t.vy = rr(0.4, 1.6);
      t.life = rr(0.28, 0.42); t.s0 = size * 0.45; t.s1 = size * rr(1.1, 1.5);
      t.rot = Math.random() * 6.28; t.rotVel = rr(-3, 3); t.drag = 3.2; t.a = 0.6; t.fin = 0.01; t.fp = 1.3;
      col0(t, f.core); col1(t, f.dark);
      B.emit();
    }
  }

  // Stone chips (Asag): tumbling alpha shards.
  chips(f, x, y, z, dx, dz, n, spd, size) {
    n = this.v.ps.n(n);
    const B = this.v.B, base = Math.atan2(dx, dz), omni = dx === 0 && dz === 0;
    for (let i = 0; i < n; i++) {
      const t = B.begin(F.SHARD);
      const a = omni ? Math.random() * TAU : base + (Math.random() - 0.5) * 1.6;
      const s = spd * (0.4 + Math.random() * 0.8);
      t.x = x; t.y = y; t.z = z;
      t.vx = Math.sin(a) * s; t.vz = Math.cos(a) * s; t.vy = rr(2, 6);
      t.life = rr(0.5, 0.9); t.s0 = size * rr(0.7, 1.4); t.s1 = t.s0 * 0.7;
      t.rot = Math.random() * 6.28; t.rotVel = rr(-14, 14); t.grav = 22; t.drag = 0.3; t.a = 1; t.fp = 0.4; t.fin = 0.004;
      col0(t, f.core); col1(t, f.dark);
      B.emit();
    }
  }

  // A fading stain on the ground, thrown (dx,dz) away from the wound.
  splat(f, x, z, dx, dz, dist, size, life) {
    if (!f.splat || !this.canSplat(life)) return;
    const v = this.v;
    const sx = x + dx * dist, sz = z + dz * dist;
    v.decal(sx, sz, size, F.SCORCH, f.splat, 0.78, life, false);
    if (f.venom || f.ember) v.decal(sx, sz, size * 0.75, F.SCORCH, f.ember ? 0xff6a10 : 0xb8d820, 0.8, 0.9, true, 1.3);
  }

  // A normal hit on a monster: directional ichor. (x,y,z) is the wound, (dx,dz) points away from the hero.
  hit(en, e, x, y, z, dx, dz, crit, direct) {
    const f = this.family(en);
    const big = crit || (direct && this.g.abilities.combo === 2) || e.amount >= en.maxHp * 0.22;
    if (this.ichorLeft <= 0 && !crit) return;
    this.ichorLeft--;
    const n = crit ? 14 : big ? 9 : 5;
    if (f.mist) {
      this.mist(f, x, y, z, crit ? 5 : 2, crit ? 1.6 : 1.1);
      this.flecks(f, x, y, z, dx, dz, n - 1, 5, 0.9, 0.3, 0.55);
    } else {
      this.droplets(f, x, y, z, dx, dz, n, crit ? 9.5 : 6.5, crit ? 0.9 : 0.65, 0.42, 0.6);
      // A short, soft spray of wet colour at the wound so the hit has a visible "splash" and not just sparks.
      this.spray(f, x, y, z, dx, dz, crit ? 2 : 1, crit ? 1.5 : 1.0);
      if (f.chips) this.chips(f, x, y, z, dx, dz, crit ? 7 : big ? 5 : 3, 8, 0.36);
      if (f.glow > 0.3) this.flecks(f, x, y, z, dx, dz, crit ? 6 : 3, 7, 0.7, 0.3, 0.45);
    }
    if (crit || big || Math.random() < 0.3) this.splat(f, en.pos.x, en.pos.z, dx, dz, rr(0.9, 2.2), crit ? rr(1.2, 1.9) : rr(0.6, 1.2), crit ? 8 : 6);
  }

  // The last blow: a full burst around the body and a ring of stains.
  deathIchor(en, tier) {
    const f = this.family(en), x = en.pos.x, z = en.pos.z, y = en.pos.y + 1.0 * en.scale;
    const k = 1 + tier * 0.8;
    if (f.mist) {
      this.mist(f, x, y, z, Math.round(7 * k), 1.4 + tier * 0.5);
      this.flecks(f, x, y, z, 0, 0, Math.round(10 * k), 5, 0, 0.22, 0.8);
      return;
    }
    this.droplets(f, x, y, z, 0, 0, Math.round(18 * k), 7.5, 0, 0.48, 0.75);
    this.spray(f, x, y, z, 0, 0, Math.round(3 * k), 2.0 + tier * 0.5);
    if (f.chips) this.chips(f, x, y, z, 0, 0, Math.round(12 * k), 9, 0.4);
    if (f.glow > 0.3) this.flecks(f, x, y, z, 0, 0, Math.round(10 * k), 8, 0, 0.3, 0.6);
    const n = 2 + tier;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      this.splat(f, x, z, Math.sin(a), Math.cos(a), rr(0.5, 1.8 + tier * 0.7) * en.scale, rr(1.3, 2.2 + tier * 0.9), 8);
    }
  }

  // ---------------------------------------------------------------------
  // hit weight
  // ---------------------------------------------------------------------
  // Hit-stop, kick and wave for a critical blow. `heavy` marks elites and bosses.
  critFeel(x, y, z, dx, dz, heavy) {
    const fx = this.g.fx;
    fx.stop(heavy ? 0.09 : 0.065);
    fx.shake(heavy ? 0.16 : 0.11);
    if (this.kickFrame !== this.v.frame) { this.kickFrame = this.v.frame; fx.kick(dx, dz, heavy ? 5.5 : 4); }
    this.shock(x, y, z, heavy ? 0.014 : 0.011, 3.4, 0.32, 0);
  }

  // ---------------------------------------------------------------------
  // death moments
  // ---------------------------------------------------------------------
  // 0 normal, 1 elite, 2 named champion, 3 boss / instance guardian
  tierOf(en) {
    if (en.boss) return 3;
    if (en.named) return this.g.instance?.guardian?.id === en.named.id ? 3 : 2;
    return en.elite ? 1 : 0;
  }

  deathMoment(en) {
    const g = this.g, v = this.v, fx = g.fx, tier = this.tierOf(en);
    this.deathIchor(en, tier);
    if (!tier) return;
    const x = en.pos.x, z = en.pos.z, y = en.pos.y + 1.2 * en.scale;
    const gy = en.pos.y;
    if (tier === 1) {
      fx.slowmo(0.35, 0.25);
      fx.stop(0.07);
      g.renderer.pulse(0xffd070, 0.16);
      v.flash(x, y, z, 6.5, 0xffe29a, 0.26, 1.8, F.STAR);
      v.glow(x, y, z, 7, 0xffc050, 0.3, 0.7, 1.3);
      v.ringFlat(x, 0.12, z, 0.8, 9, 0.5, 0xffd68a, 0.9, 1.6);
      v.flashLight(x, gy + 2, z, 0xffcf70, 24, 0.3);
      this.shock(x, y, z, 0.03, 9, 0.55, 1);
      fx.shake(0.28);
    } else if (tier === 2) {
      fx.slowmo(0.3, 0.32);
      fx.stop(0.09);
      g.renderer.pulse(0xffe0a0, 0.24);
      v.flash(x, y, z, 8.5, 0xfff0c0, 0.3, 2, F.STAR);
      v.glow(x, y, z, 9, 0xffc050, 0.35, 0.8, 1.3);
      v.ringFlat(x, 0.12, z, 1, 12, 0.6, 0xffd68a, 0.95, 1.7);
      v.flashLight(x, gy + 2.5, z, 0xffd070, 32, 0.4);
      this.shock(x, y, z, 0.04, 12, 0.6, 1);
      fx.shake(0.4);
      fx.fovPunch(24);
    } else {
      // Guardian down: a hard freeze-frame, then a long, heavy slow-motion fall.
      fx.stop(0.14);
      fx.slowmo(0.22, 0.5);
      g.renderer.pulse(0xfff0d0, 0.3);
      v.flash(x, y, z, 12, 0xfff4d0, 0.4, 2.2, F.STAR);
      v.glow(x, y, z, 14, 0xffd070, 0.5, 0.9, 1.3);
      v.ringFlat(x, 0.12, z, 1.5, 20, 0.9, 0xffe29a, 1, 1.8);
      v.flashLight(x, gy + 3, z, 0xffe0a0, 70, 0.7);
      this.shock(x, y, z, 0.055, 26, 1.0, 2);
      v.schedule(0.38, () => { this.waveT[2] = -9; this.shock(x, y, z, 0.03, 32, 0.9, 2); g.renderer.pulse(0xe9d8ff, 0.2); });
      fx.shake(0.85);
      fx.fovPunch(46);
    }
  }
}
