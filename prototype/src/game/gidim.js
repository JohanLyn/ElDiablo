import * as THREE from 'three';
import { Enemy, TYPES } from '../entities/enemies.js';
import { GidimFx } from '../fx/gidimFx.js';
import { TOWN } from '../world/layout.js';
import { generateItem, rollRarity } from './items.js';
import {
  BASE, VARIANTS, BLESSINGS, ASH_COST, MAX_ACTIVE, RISE_RADIUS, RISE_SPREAD,
  markEligible, makeMark, pushMark, nightCap, ashFor, sanctuaryAt, wardStrength,
} from './gidimRules.js';

export * from './gidimRules.js';

const TAU = Math.PI * 2;
const CHAIN_LEN = 9;
const TRAIL_STEP = 0.9;
const MAX_TRAILS = 40;

// Night of the Gidim. The monsters you slay outdoors by day leave marks; at nightfall the marks
// rise as pale ghosts of what died there, shaped by how they died (see gidimRules.js). They are a
// bonus, not a wall: weaker than the originals, relentless, and unable to enter sanctuaries
// (town, shrines, waypoints, lantern light). The hero's sedu becomes a lantern and the Tether a ward.
export class Gidim {
  constructor(g) {
    this.g = g;
    this.marks = []; // per-session; the save keeps only counts
    this.active = []; // risen gidim (Enemy objects with .gidim)
    this.queue = []; // { mark, at } stagger-rising
    this.trails = []; // ghost-fire patches laid by burning gidim
    this.risenTonight = 0;
    this.cap = nightCap(1);
    this.nights = 0;
    this.blessing = null; // { id, left } left = nightfalls until it fades
    this.heroSafe = false;
    this.nextId = 1;
    this.scanT = 0;
    this.trailTick = 0;
    this.stats = { marks: 0, risen: 0, slain: 0, ash: 0, recoils: 0 };
    this.ctx = { regionAt: g.world.regionAt, town: TOWN, shrines: g.world.shrines, waypoints: g.world.waypoints, emitters: g.world.lights.emitters, lampMult: 1 };
    this.fx = new GidimFx(g);
    // The sedu's lantern: a pooled emitter that follows the familiar (never a new PointLight).
    this.seduLight = g.world.lights.add({ x: 0, y: 2, z: 0, color: 0xffd79a, intensity: 0, range: 15, decay: 1.5, flicker: 0.35, sedu: true, priority: 8 });
    g.events.on('kill', (p) => this.onKill(p));
    g.events.on('nightfall', () => this.onNightfall());
    g.events.on('daybreak', () => this.onDaybreak());
    g.settings.onChange((k, v) => { if (k === 'gidim' && !v) this.disable(); });
  }

  get enabled() { return this.g.settings.get('gidim') !== false; }
  liveCount() { let n = 0; for (const e of this.active) if (e.alive) n++; return n; }

  // ---- blessings -----------------------------------------------------------------------------
  lampMult() { return this.blessing?.id === 'lamp' ? 1.5 : 1; }
  damageTakenMult() { return this.blessing?.id === 'ashskin' && this.g.isNight ? 0.8 : 1; }
  ward() { return this.enabled ? wardStrength(this.blessing?.id === 'lamp') : null; }

  blessingLabel() {
    const b = this.blessing;
    if (!b) return '';
    const when = this.g.isNight ? (b.left > 1 ? 'tonight' : 'until nightfall') : b.left > 1 ? 'for tonight' : 'until nightfall';
    return `${BLESSINGS[b.id].name} · ${when}`;
  }

  buyBlessing(id) {
    const g = this.g, p = g.player;
    if (!BLESSINGS[id]) return false;
    if (p.ghostAsh < ASH_COST) { g.hud.notify('Not enough Ghost-ash', 'warn'); return false; }
    p.ghostAsh -= ASH_COST;
    // Bought by day it covers the coming night and ends at the nightfall after; bought at night it ends at the next nightfall.
    this.blessing = { id, left: g.isNight ? 1 : 2 };
    g.hud.banner(BLESSINGS[id].name, 'shrine', BLESSINGS[id].desc);
    g.events.emit('shrine', { kind: 'ninsun' });
    g.save();
    return true;
  }

  // Dialogue hooks for Ninsun (src/ui/ui.js).
  ninsunOptions(ui, npc) {
    const g = this.g;
    if (!this.enabled || !(g.flags.gidimSeen || g.player.ghostAsh > 0 || this.blessing)) return [];
    return [{ label: `Night Blessing: a ward against the gidim (${ASH_COST} ◈ Ghost-ash, you hold ${g.player.ghostAsh})`, run: () => ui.talk(npc, 'night'), keepOpen: true }];
  }

  nightDialog(ui, npc) {
    const g = this.g, p = g.player;
    const have = this.blessing ? `You carry ${BLESSINGS[this.blessing.id].name} (${this.blessingLabel().split(' · ')[1]}). Choosing another replaces it.\n\n` : '';
    const text = `${have}The day's dead are restless once the sun is gone, Gatewalker. Bring me their ash and I will ask a god to walk beside you until the night is spent. You hold ${p.ghostAsh} ◈ Ghost-ash; each blessing costs ${ASH_COST}.`;
    const options = Object.entries(BLESSINGS).map(([id, b]) => ({
      label: `${b.name}: ${b.desc}`, disabled: p.ghostAsh < ASH_COST, disabledMsg: 'Not enough Ghost-ash',
      run: () => { this.buyBlessing(id); },
    }));
    options.push({ label: 'Back', run: () => ui.talk(npc), keepOpen: true });
    return { text, options };
  }

  tickBlessing() {
    const b = this.blessing;
    if (!b) return;
    if (--b.left <= 0) {
      this.g.hud.notify(`${BLESSINGS[b.id].name} fades`, 'warn');
      this.blessing = null;
    }
  }

  // ---- marks -----------------------------------------------------------------------------------
  onKill({ enemy: e, source, crit, burning }) {
    const g = this.g;
    if (!e || e.gidim || !this.enabled) return;
    const region = g.world.regionAt(e.pos.x, e.pos.z);
    if (!markEligible({ enabled: true, night: g.isNight, inDungeon: g.inDungeon || !!g.instance, dungeon: !!e.dungeon, region, boss: !!e.boss })) return;
    if (sanctuaryAt(e.pos.x, e.pos.z, this.ctx)) return; // nothing could rise inside a sanctuary
    const mark = makeMark({ type: e.type, elite: e.elite, named: e.named, level: e.level, x: e.pos.x, z: e.pos.z, source, crit, burning, time: g.time, id: this.nextId++ });
    pushMark(this.marks, mark);
    this.stats.marks++;
    this.fx.setDirty();
  }

  // ---- nightfall / daybreak ------------------------------------------------------------------
  onNightfall() {
    const g = this.g;
    if (!this.enabled) return;
    this.nights++;
    this.risenTonight = 0;
    this.cap = nightCap(g.player.level);
    this.tickBlessing();
    if (!g.flags.gidimSeen) {
      g.flags.gidimSeen = true;
      g.hud.banner('Night falls', 'region', 'The gidim rise where you slew them');
    } else if (this.marks.length) g.hud.notify('Night falls. The day\'s dead stir', 'warn');
    this.scheduleNear(true);
  }

  onDaybreak() {
    const g = this.g;
    const had = this.liveCount() + this.queue.length;
    this.dissolveAll();
    this.queue.length = 0;
    this.marks.length = 0;
    this.trails.length = 0;
    this.fx.setDirty();
    if (had && this.enabled) g.hud.notify('Dawn. The gidim fade', 'good');
  }

  disable() {
    const had = this.liveCount();
    this.dissolveAll();
    this.queue.length = 0;
    this.marks.length = 0;
    this.trails.length = 0;
    this.fx.rises.length = 0;
    this.fx.setDirty();
    return had;
  }

  // Remaining gidim dissolve harmlessly: no loot, no XP, no ash.
  dissolveAll() {
    const g = this.g;
    for (const e of this.active) {
      if (!e.alive) continue;
      e.alive = false;
      e.dying = 0.5;
      e.gidim.dispelled = true;
      if (e.bar) e.bar.visible = false;
      g.fx.burst(e.pos.clone().setY(e.pos.y + 1), 0x9ff3ff, 8, 2.5, { up: 3, life: 0.8, gravity: -2 });
    }
    this.active.length = 0;
  }

  // Marks near the hero rise (the first wave staggered over ~4 s); farther ones wait until the hero comes within range.
  scheduleNear(initial) {
    const g = this.g;
    if (!g.isNight || g.inDungeon || !this.enabled || g.player.dead) return;
    const room = Math.min(this.cap - this.risenTonight - this.queue.length, MAX_ACTIVE - this.liveCount() - this.queue.length);
    if (room <= 0) return;
    const hp = g.player.pos;
    const queued = new Set(this.queue.map((q) => q.mark));
    const near = this.marks
      .filter((m) => !queued.has(m) && Math.hypot(m.x - hp.x, m.z - hp.z) < RISE_RADIUS)
      .sort((a, b) => Math.hypot(a.x - hp.x, a.z - hp.z) - Math.hypot(b.x - hp.x, b.z - hp.z))
      .slice(0, room);
    near.forEach((m, i) => {
      const at = g.time + (initial ? ((i + Math.random() * 0.8) / near.length) * RISE_SPREAD : 0.3 + Math.random() * 0.6 + i * 0.4);
      this.queue.push({ mark: m, at });
    });
  }

  // ---- rising ------------------------------------------------------------------------------------
  spawn(type, variant, x, z, { name, spawnTime = 1.4 } = {}) {
    const g = this.g;
    const V = VARIANTS[variant];
    const spec = {
      variant, lord: variant === 'lord', name, xpMult: BASE.xp * V.xp,
      hissCd: 0, lungeCd: 1.5 + Math.random() * 2, tell: 0, lunging: 0, hit: false, trailAcc: 0, lastX: x, lastZ: z,
    };
    if (variant === 'chained') spec.chain = { ax: x, az: z, len: CHAIN_LEN };
    const e = new Enemy(type, { level: g.player.level, gidim: spec, x, z }, g.scene);
    e.aggro = true;
    e.spawning = spawnTime;
    g.enemies.add(e);
    this.active.push(e);
    return e;
  }

  rise(mark) {
    const g = this.g;
    if (!g.isNight || g.inDungeon || this.liveCount() >= MAX_ACTIVE) return null; // the mark waits for a better moment
    const i = this.marks.indexOf(mark);
    if (i >= 0) this.marks.splice(i, 1);
    const lord = mark.lord;
    const name = lord ? (mark.named ? `Gidim ${mark.named}` : `Gidim Lord of the ${TYPES[mark.type].name}`) : undefined;
    const e = this.spawn(mark.type, mark.variant, mark.x, mark.z, { name, spawnTime: lord ? 2.4 : 1.4 });
    this.risenTonight++;
    this.stats.risen++;
    const y = g.world.heightAt(mark.x, mark.z);
    g.events.emit('gidimRise', { pos: new THREE.Vector3(mark.x, y, mark.z), variant: mark.variant, lord });
    this.fx.rise(mark, y);
    if (lord && Math.hypot(mark.x - g.player.pos.x, mark.z - g.player.pos.z) < 50) g.hud.banner(e.name, 'boss', 'Risen where it fell');
    return e;
  }

  // ---- death -----------------------------------------------------------------------------------------
  // Called from main.js onEnemyKilled for every slain gidim.
  onGidimKilled(e) {
    const g = this.g, G = e.gidim;
    this.stats.slain++;
    g.events.emit('gidimDeath', { pos: e.pos.clone(), variant: G.variant });
    this.fx.death(e.pos, G.lord);
    const reader = this.blessing?.id === 'reader';
    const n = ashFor(G.variant, { graveReader: reader, rand: Math.random() });
    if (n > 0) this.giveAsh(n, e.pos);
    if (G.lord || (reader && Math.random() < 0.15)) this.dropItem(e, G.lord ? 'magic' : 'common');
    if (G.variant === 'shattered') this.split(e);
    g.player.gainXp(e.xp, g);
  }

  giveAsh(n, pos) {
    const g = this.g, p = g.player;
    p.ghostAsh += n;
    this.stats.ash += n;
    g.hud.feed(`+${n} Ghost-ash`, 'ash');
    g.events.emit('pickup', { kind: 'ash', amount: n, pos });
    g.hud.pulseAsh?.();
  }

  dropItem(e, minRarity) {
    const g = this.g, rng = g.loot.rng;
    const ilvl = e.level;
    g.loot.dropItem(generateItem({ ilvl, rarity: rollRarity(rng, { magicFind: e.gidim.lord ? 1 : 0, minRarity, ilvl }), rng }), e.pos, g);
  }

  // A Shattered gidim splits once into two weak shards.
  split(e) {
    for (let i = 0; i < 2; i++) {
      if (this.liveCount() >= MAX_ACTIVE) break;
      const a = Math.random() * TAU + i * Math.PI;
      const s = this.spawn(e.type, 'shard', e.pos.x + Math.cos(a) * 0.9, e.pos.z + Math.sin(a) * 0.9, { spawnTime: 0.5 });
      s.knock.set(Math.cos(a) * 5, 0, Math.sin(a) * 5);
    }
  }

  // The chill a gidim's touch leaves: a short slow, shown in the buff row.
  chill() {
    const g = this.g, p = g.player;
    const fresh = !p.buffs.some((b) => b.id === 'chill');
    p.addBuff('chill', 'Gidim chill', { moveSpeed: -28 }, 2.2);
    if (fresh) g.fx.burst(p.pos.clone().setY(p.pos.y + 1.2), 0xbff8ff, 10, 2.5, { up: 1, life: 0.6, gravity: 0 });
  }

  // ---- save ----------------------------------------------------------------------------------------
  serialize() {
    return { blessing: this.blessing ? { ...this.blessing } : null, marks: this.marks.length, nights: this.nights, risen: this.stats.risen, ash: this.stats.ash };
  }

  // A hero was loaded or created: forget the session's marks and gidim (the stray-enemy sweep already removed the bodies).
  reset(data) {
    this.active.length = 0;
    this.queue.length = 0;
    this.marks.length = 0;
    this.trails.length = 0;
    this.fx.rises.length = 0;
    this.risenTonight = 0;
    this.stats = { marks: 0, risen: 0, slain: 0, ash: 0, recoils: 0 };
    this.nights = data?.nights ?? 0;
    const b = data?.blessing;
    this.blessing = b && BLESSINGS[b.id] ? { id: b.id, left: Math.max(1, Math.min(2, b.left | 0 || 1)) } : null;
    this.fx.setDirty();
  }

  // ---- per frame ---------------------------------------------------------------------------------
  update(dt) {
    const g = this.g, p = g.player;
    const enabled = this.enabled;
    this.ctx.lampMult = this.lampMult();
    this.updateSedu(enabled);
    this.heroSafe = enabled && !g.inDungeon && !!sanctuaryAt(p.pos.x, p.pos.z, this.ctx);
    if (enabled) {
      for (let i = this.queue.length - 1; i >= 0; i--) {
        if (g.time >= this.queue[i].at) this.rise(this.queue.splice(i, 1)[0].mark);
      }
      if (g.isNight) {
        this.scanT -= dt;
        if (this.scanT <= 0) { this.scanT = 0.5; this.scheduleNear(false); }
      }
      for (let i = this.active.length - 1; i >= 0; i--) {
        const e = this.active[i];
        if (!e.alive) { this.active.splice(i, 1); continue; }
        this.tick(e, dt);
      }
      this.updateTrails(dt);
    }
    this.fx.update(dt, { marks: this.marks, active: this.active, enabled });
  }

  updateSedu(enabled) {
    const g = this.g, tod = g.world.tod, B = g.tether.B;
    const dark = enabled && !g.inDungeon ? Math.max(tod.night, tod.dusk * 0.5) : 0;
    const lamp = this.blessing?.id === 'lamp';
    const L = this.seduLight;
    L.x = B.x; L.y = B.y + 0.3; L.z = B.z;
    L.intensity = dark * (lamp ? 10 : 7.5);
    L.range = lamp ? 19 : 15;
    this.fx.halo(B, dark);
  }

  tick(e, dt) {
    const g = this.g, p = g.player, G = e.gidim;
    G.hissCd = Math.max(0, G.hissCd - dt);

    if (G.chain && e.spawning <= 0) this.tickChain(e, dt);

    // Burning gidim leave ghost-fire where they have walked.
    if (G.variant === 'burning' && e.spawning <= 0) {
      G.trailAcc += Math.hypot(e.pos.x - G.lastX, e.pos.z - G.lastZ);
      G.lastX = e.pos.x; G.lastZ = e.pos.z;
      if (G.trailAcc >= TRAIL_STEP) { G.trailAcc = 0; this.addTrail(e.pos.x, e.pos.z, e.dmg * 0.3, e.level); }
    }

    // Sanctuaries: never inside. At the edge the gidim shrinks back with a hiss.
    for (let k = 0; k < 3; k++) {
      const s = sanctuaryAt(e.pos.x, e.pos.z, this.ctx);
      if (!s) break;
      let dx = e.pos.x - s.x, dz = e.pos.z - s.z, d = Math.hypot(dx, dz);
      if (d < 1e-3) { dx = e.pos.x - p.pos.x; dz = e.pos.z - p.pos.z; d = Math.hypot(dx, dz) || 1; }
      const R = s.r + 0.4;
      e.pos.x = s.x + (dx / d) * R;
      e.pos.z = s.z + (dz / d) * R;
      e.vel.x = e.vel.z = 0;
      e.knock.set((dx / d) * 3, 0, (dz / d) * 3);
      if (G.hissCd <= 0) {
        G.hissCd = 1.6;
        this.stats.recoils++;
        g.events.emit('gidimRecoil', { pos: e.pos.clone(), kind: s.kind });
        this.fx.recoil(e.pos, s.kind);
      }
    }
  }

  // Chained gidim cannot stray far from their mark; now and then they lunge.
  tickChain(e, dt) {
    const g = this.g, p = g.player, G = e.gidim, ch = G.chain;
    const dx = p.pos.x - e.pos.x, dz = p.pos.z - e.pos.z, d = Math.hypot(dx, dz) || 1;
    G.lungeCd -= dt;
    if (G.tell > 0) {
      G.tell -= dt;
      e.flash = Math.max(e.flash, 0.6);
      if (G.tell <= 0) {
        e.knock.x += (dx / d) * 34; e.knock.z += (dz / d) * 34;
        G.lunging = 0.38; G.hit = false;
      }
    } else if (G.lunging > 0) {
      G.lunging -= dt;
      if (!G.hit && d < e.radius + 0.9 && !p.dead && p.takeDamage(e.dmg * 0.9, g, e.level)) { G.hit = true; this.chill(); }
    } else if (G.lungeCd <= 0 && !this.heroSafe && !p.dead && d < 9 && d > 2.8 && e.state !== 'windup') {
      G.tell = 0.5; G.lungeCd = 3.5 + Math.random() * 2;
      g.events.emit('enemyWindup', { enemy: e });
    }
    const ax = e.pos.x - ch.ax, az = e.pos.z - ch.az, ad = Math.hypot(ax, az);
    if (ad > ch.len) { e.pos.x = ch.ax + (ax / ad) * ch.len; e.pos.z = ch.az + (az / ad) * ch.len; }
  }

  addTrail(x, z, dmg, level) {
    if (this.trails.length >= MAX_TRAILS) this.trails.shift();
    this.trails.push({ x, z, life: 3.2, max: 3.2, acc: Math.random(), glow: 0, dmg, level });
  }

  updateTrails(dt) {
    const g = this.g, p = g.player;
    this.trailTick -= dt;
    for (let i = this.trails.length - 1; i >= 0; i--) {
      const t = this.trails[i];
      t.life -= dt;
      if (t.life <= 0) { this.trails.splice(i, 1); continue; }
      this.fx.flames(t, dt);
      if (this.trailTick <= 0 && !p.dead && Math.hypot(p.pos.x - t.x, p.pos.z - t.z) < 1.1) {
        this.trailTick = 0.5;
        p.takeDamage(t.dmg, g, t.level);
      }
    }
  }
}
