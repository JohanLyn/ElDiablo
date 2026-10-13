import * as THREE from 'three';
import { Rng } from '../core/rng.js';
import { damp, angleDelta } from '../core/util.js';
import { makeEnemyModel } from './enemyModels.js';
import { monsterLevelFor, monsterLifeMult, monsterDamageMult, monsterXp } from '../game/stats.js';
import { REGIONS, ROSTER, AQRABU, PLAY_LIMIT, TOWN, WAYPOINTS, flatSpots } from '../world/layout.js';
import { regionAt, roadDistance } from '../world/terrain.js';
import { DUNGEON_SPOTS } from '../world/dungeon.js';

// ai: melee = chase + telegraphed arc, brute = slow chase + ground slam,
// ranged = keep distance + bolt, caster = keep distance + delayed ground blast.
export const TYPES = {
  gallu: { name: 'Gallu', ai: 'melee', hp: 30, dmg: 9, speed: 3.6, radius: 0.55, range: 1.9, windup: 0.55, recover: 0.6, xp: 1, color: 0x7a1f1f },
  utukku: { name: 'Utukku', ai: 'melee', hp: 14, dmg: 5, speed: 5.3, radius: 0.45, range: 1.5, windup: 0.3, recover: 0.45, xp: 0.6, color: 0x8fb8b0 },
  lilitu: { name: 'Lilitu', ai: 'caster', hp: 22, dmg: 13, speed: 3.0, radius: 0.5, keep: 9, cooldown: 3.4, windup: 0.6, recover: 0.5, xp: 1.1, color: 0x4a2a5a },
  scorpion: { name: 'Girtablullu', ai: 'ranged', hp: 24, dmg: 8, speed: 3.0, radius: 0.55, keep: 8, cooldown: 2.4, windup: 0.6, recover: 0.5, xp: 1.1, color: 0x6b5a2a, projSpeed: 12 },
  asag: { name: 'Asag Stoneborn', ai: 'brute', hp: 80, dmg: 17, speed: 2.4, radius: 0.95, range: 2.8, windup: 1.0, recover: 0.9, xp: 2.2, color: 0x5a5048 },
  neti: { name: 'Neti, Keeper of the First Gate', ai: 'boss', hp: 1000, dmg: 22, speed: 3.2, radius: 1.5, xp: 30, color: 0x6a5a8a },
};

export const ELITE_AFFIXES = {
  fast: { name: 'Fast', color: '#8cff6a' },
  vampiric: { name: 'Vampiric', color: '#ff4a6a' },
  molten: { name: 'Molten', color: '#ff8a3a' },
  storm: { name: 'Storm-Touched', color: '#8fd3ff' },
};
const ELITE_PREFIX = ['Grave-Born', 'Ash-Crowned', 'Bitter', 'Silt-Eyed', 'Hollow', 'Sunscorched', 'Dread'];

const SPAWN_TIME = 0.6;
const ACTIVATE_DIST = 62;
const DEACTIVATE_DIST = 92;
const RESPAWN_TIME = 150;

let nextId = 1;

export class Enemy {
  constructor(type, { level, elite = null, named = null, camp = null, x, z }, scene) {
    this.id = nextId++;
    this.type = type;
    this.def = TYPES[type];
    this.level = level;
    this.elite = elite; // array of affix ids or null
    this.named = named;
    this.camp = camp;
    this.boss = this.def.ai === 'boss';
    const eliteMult = named ? 6 : elite ? 3.5 : 1;
    this.maxHp = Math.round(this.def.hp * monsterLifeMult(level) * eliteMult);
    this.hp = this.maxHp;
    this.dmg = this.def.dmg * monsterDamageMult(level) * (elite ? 1.4 : 1);
    this.speedMult = elite?.includes('fast') ? 1.4 : 1;
    this.scale = this.boss ? 1 : named ? 1.5 : elite ? 1.3 : 1;
    this.radius = this.def.radius * this.scale;
    this.name = named ? named.name : elite ? `${elite.prefix} ${this.def.name}` : this.def.name;
    this.alive = true;
    this.spawning = SPAWN_TIME;
    this.state = 'idle';
    this.stateTime = 0;
    this.cooldown = 1 + Math.random() * 1.5;
    this.aggro = false;
    this.home = new THREE.Vector3(x, 0, z);
    this.wander = new THREE.Vector3(x, 0, z);
    this.vel = new THREE.Vector3();
    this.knock = new THREE.Vector3();
    this.tetherCd = 0;
    this.burn = 0; this.burnDps = 0; this.burnTick = 0;
    this.slow = 0;
    this.vulnerable = 0;
    this.flash = 0;
    this.dying = 0;
    this.facing = Math.random() * Math.PI * 2;
    this.affixTimer = 2 + Math.random() * 3;

    this.group = makeEnemyModel(type, elite || named ? shade(this.def.color) : this.def.color);
    this.group.scale.setScalar(this.scale);
    this.mat = this.group.userData.mat;
    this.group.position.set(x, -2, z);
    this.pos = this.group.position;
    scene.add(this.group);

    if (!this.boss) {
      this.bar = new THREE.Group();
      const bg = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.12), new THREE.MeshBasicMaterial({ color: 0x220a0a, depthTest: false, transparent: true }));
      this.barFill = new THREE.Mesh(new THREE.PlaneGeometry(1.06, 0.08), new THREE.MeshBasicMaterial({ color: elite || named ? 0xf2d24b : 0xe0393a, depthTest: false, transparent: true }));
      this.barFill.position.z = 0.001;
      bg.renderOrder = 10; this.barFill.renderOrder = 11;
      this.bar.add(bg, this.barFill);
      this.bar.rotation.x = -0.96;
      this.bar.visible = false;
      scene.add(this.bar);
    }
  }

  get xp() { return monsterXp(this.level, this.def.xp * (this.named ? 8 : this.elite ? 4 : 1)); }

  setState(s) { this.state = s; this.stateTime = 0; }

  dispose(scene) {
    scene.remove(this.group);
    if (this.bar) scene.remove(this.bar);
  }
}

// Darker, richer tint for elites so they read as special.
function shade(hex) {
  const c = new THREE.Color(hex);
  c.offsetHSL(0, 0.15, -0.05);
  return c.getHex();
}

export class EnemyManager {
  constructor(scene) {
    this.scene = scene;
    this.list = [];
    this.projectiles = [];
    this.hazards = [];
    this.camps = [];
    this.boltGeo = new THREE.SphereGeometry(0.22, 8, 6);
    this.boltMat = new THREE.MeshBasicMaterial({ color: 0xff5a3a });
    this.hazardDisc = new THREE.CircleGeometry(1, 32);
    this.hazardDisc.rotateX(-Math.PI / 2);
    this.hazardRing = new THREE.RingGeometry(0.94, 1, 40);
    this.hazardRing.rotateX(-Math.PI / 2);
    this.generateCamps();
  }

  // Seeded camp placement across all overworld regions.
  generateCamps() {
    const rng = new Rng(777);
    const flats = flatSpots();
    const counts = { sunfields: 30, marsh: 24, ruins: 24, ashen: 22 };
    for (const [region, count] of Object.entries(counts)) {
      let placed = 0, tries = 0;
      while (placed < count && tries < 4000) {
        tries++;
        const x = rng.float(-PLAY_LIMIT + 12, PLAY_LIMIT - 12), z = rng.float(-PLAY_LIMIT + 12, PLAY_LIMIT - 12);
        if (regionAt(x, z) !== region) continue;
        if (Math.hypot(x - TOWN.x, z - TOWN.z) < TOWN.r + 22) continue;
        if (WAYPOINTS.some((w) => Math.hypot(x - w.x, z - w.z) < 16)) continue;
        if (flats.some((f) => Math.hypot(x - f.x, z - f.z) < f.r + 4)) continue;
        if (this.camps.some((c) => Math.hypot(x - c.x, z - c.z) < 17)) continue;
        if (roadDistance(x, z) < 2) continue;
        const eliteChance = region === 'ashen' ? 0.3 : region === 'sunfields' ? 0.1 : 0.2;
        const elite = rng.chance(eliteChance);
        const size = elite ? rng.int(3, 5) : rng.int(3, 6);
        const members = [];
        for (let i = 0; i < size; i++) members.push(rng.weighted(ROSTER[region]));
        const affixes = elite ? pickAffixes(rng, region === 'sunfields' ? 1 : rng.int(1, 2)) : null;
        this.camps.push({ id: `camp-${this.camps.length}`, x, z, region, members, elite: affixes ? { affixes, prefix: rng.pick(ELITE_PREFIX), type: members[0] } : null, state: 'dormant', clearedAt: 0, enemies: [] });
        placed++;
      }
    }
    // Aqrabu the Venomed and his guard.
    this.camps.push({
      id: 'camp-aqrabu', x: AQRABU.x, z: AQRABU.z, region: 'ruins', members: ['scorpion', 'scorpion', 'scorpion', 'gallu'],
      named: { id: AQRABU.id, name: 'Aqrabu the Venomed', type: 'scorpion', affixes: ['fast', 'storm'] }, state: 'dormant', clearedAt: 0, enemies: [],
    });
  }

  get namedPositions() {
    return { 'named-aqrabu': { x: AQRABU.x, z: AQRABU.z } };
  }

  // Spawn / despawn camps around the hero and respawn cleared ones over time.
  updateCamps(g) {
    const p = g.player.pos;
    for (const c of this.camps) {
      const d = Math.hypot(p.x - c.x, p.z - c.z);
      if (c.state === 'dormant' && d < ACTIVATE_DIST && !g.inDungeon) this.spawnCamp(c, g);
      else if (c.state === 'active' && (d > DEACTIVATE_DIST || g.inDungeon)) this.despawnCamp(c);
      else if (c.state === 'cleared' && g.time - c.clearedAt > RESPAWN_TIME && d > ACTIVATE_DIST + 10) c.state = 'dormant';
    }
  }

  spawnCamp(c, g) {
    c.state = 'active';
    const level = monsterLevelFor(REGIONS[c.region].level, g.player.level);
    c.enemies = [];
    const leader = c.named ?? c.elite;
    if (leader) {
      const e = new Enemy(leader.type, { level: level + 1, elite: Object.assign([...leader.affixes], { prefix: leader.prefix }), named: c.named ?? null, camp: c, x: c.x, z: c.z }, this.scene);
      c.enemies.push(e);
      this.list.push(e);
    }
    c.members.forEach((type, i) => {
      if (leader && i === 0) return;
      const a = (i / c.members.length) * Math.PI * 2;
      const e = new Enemy(type, { level, camp: c, x: c.x + Math.cos(a) * 3, z: c.z + Math.sin(a) * 3 }, this.scene);
      e.spawning = 0.01; // camps are already there when you arrive
      c.enemies.push(e);
      this.list.push(e);
    });
    if (leader) c.enemies[0].spawning = 0.01;
  }

  despawnCamp(c) {
    for (const e of c.enemies) {
      e.alive = false; // fresh Enemy objects are created when the camp spawns again
      e.dispose(this.scene);
      const i = this.list.indexOf(e);
      if (i >= 0) this.list.splice(i, 1);
    }
    c.enemies = [];
    c.state = 'dormant';
  }

  // Dungeon content resets every time you enter (D4-style instances).
  populateDungeon(g) {
    this.clearDungeon();
    const level = monsterLevelFor(REGIONS.dungeon.level, g.player.level);
    const rng = new Rng(Math.floor(Math.random() * 1e9));
    DUNGEON_SPOTS.packs.forEach((spot, i) => {
      const n = rng.int(3, 5);
      for (let k = 0; k < n; k++) {
        const type = rng.weighted(ROSTER.dungeon);
        const isElite = k === 0 && i % 2 === 1;
        const e = new Enemy(isElite ? 'asag' : type, {
          level: level + (isElite ? 1 : 0),
          elite: isElite ? Object.assign(pickAffixes(rng, 2), { prefix: rng.pick(ELITE_PREFIX) }) : null,
          x: spot.x + rng.float(-3, 3), z: spot.z + rng.float(-3, 3),
        }, this.scene);
        e.spawning = 0.01;
        e.dungeon = true;
        this.list.push(e);
      }
    });
  }

  clearDungeon() {
    for (let i = this.list.length - 1; i >= 0; i--) {
      if (this.list[i].dungeon) { this.list[i].alive = false; this.list[i].dispose(this.scene); this.list.splice(i, 1); }
    }
    for (const h of this.hazards) this.scene.remove(h.group);
    this.hazards = [];
  }

  add(enemy) { this.list.push(enemy); return enemy; }

  // ---- damage --------------------------------------------------------------------
  damage(e, amount, g, { crit = false, knockX = 0, knockZ = 0, color = '#fff', silent = false } = {}) {
    if (!e.alive || e.spawning > 0) return 0;
    if (e.vulnerable > 0) amount *= 1.2;
    if (e.shielded) amount *= 0.25;
    e.hp -= amount;
    e.flash = 1;
    if (!e.boss) { e.knock.x += knockX; e.knock.z += knockZ; }
    if (!silent || crit) g.fx.number(e.pos, amount, { color: crit ? '#ffd166' : color, big: crit });
    g.fx.burst(e.pos.clone().setY(e.pos.y + 1), 0xffc27a, silent ? 2 : 7, 4, { life: 0.35 });
    this.alertPack(e);
    g.hud.setTarget(e);
    g.events.emit('hit', { enemy: e, amount, crit, pos: e.pos });
    if (amount >= e.maxHp * 0.25 && e.state === 'windup' && !e.boss && !e.elite) e.setState('recover');
    if (e.hp <= 0) this.kill(e, g);
    return amount;
  }

  alertPack(e) {
    e.aggro = true;
    if (e.camp) for (const o of e.camp.enemies) o.aggro = true;
    if (e.dungeon) for (const o of this.list) if (o.dungeon && o.alive && o.pos.distanceTo(e.pos) < 12) o.aggro = true;
  }

  kill(e, g) {
    e.alive = false;
    e.dying = 0.5;
    if (e.bar) e.bar.visible = false;
    g.fx.burst(e.pos.clone().setY(e.pos.y + 1), 0xd6a740, 22, 6, { up: 4, life: 0.9 });
    g.fx.burst(e.pos.clone().setY(e.pos.y + 0.8), 0x5a2bd8, 12, 3, { up: 6, life: 1.1, gravity: -2 });
    g.fx.stop(e.boss ? 0.3 : 0.03);
    g.fx.rumble(0.25, 0.4, 60);
    if (e.elite?.includes('molten')) this.hazard({ x: e.pos.x, z: e.pos.z, r: 3.6, delay: 1.3, dmg: e.dmg * 1.6, color: 0xff6a1a, level: e.level });
    if (e.burn > 0 && g.player.stats.powers.has('gibil')) {
      g.abilities.areaDamage(e.pos, 3.5, 0.8, g, { color: '#ff9a4a', fx: 0xff7a2a });
    }
    if (e.camp && e.camp.enemies.every((o) => !o.alive)) { e.camp.state = 'cleared'; e.camp.clearedAt = g.time; }
    g.events.emit('kill', { enemy: e, pos: e.pos });
    g.onEnemyKilled(e);
  }

  // ---- hazards and projectiles ---------------------------------------------------------
  hazard({ x, z, r, delay, dmg, color = 0xff2a2a, level = 1, onHit = null }) {
    const group = new THREE.Group();
    const fillMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.15, depthWrite: false, blending: THREE.AdditiveBlending });
    const ringMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending });
    const fill = new THREE.Mesh(this.hazardDisc, fillMat);
    const ring = new THREE.Mesh(this.hazardRing, ringMat);
    ring.scale.setScalar(r);
    group.add(fill, ring);
    group.position.set(x, 0, z);
    this.scene.add(group);
    this.hazards.push({ x, z, r, delay, t: 0, dmg, color, level, group, fill, onHit });
  }

  fire(from, facing, speed, damage, level) {
    const mesh = new THREE.Mesh(this.boltGeo, this.boltMat);
    mesh.position.set(from.x + Math.sin(facing) * 0.8, from.y + 1.1, from.z + Math.cos(facing) * 0.8);
    this.scene.add(mesh);
    this.projectiles.push({ mesh, pos: mesh.position, vx: Math.sin(facing) * speed, vz: Math.cos(facing) * speed, damage, level, life: 2.5 });
  }

  // ---- per frame -------------------------------------------------------------------------
  update(dt, g) {
    this.updateCamps(g);
    const p = g.player;
    for (const e of this.list) this.updateEnemy(e, dt, g);

    // Separation between nearby live enemies.
    const live = this.list.filter((e) => e.alive && e.spawning <= 0 && e.pos.distanceToSquared(p.pos) < 900);
    for (let i = 0; i < live.length; i++) {
      const a = live[i];
      for (let j = i + 1; j < live.length; j++) {
        const b = live[j];
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
        const d = Math.hypot(dx, dz), min = a.radius + b.radius;
        if (d < min && d > 1e-4) {
          const push = (min - d) / 2;
          const wa = a.boss ? 0 : 1, wb = b.boss ? 0 : 1;
          a.pos.x -= (dx / d) * push * wa; a.pos.z -= (dz / d) * push * wa;
          b.pos.x += (dx / d) * push * wb; b.pos.z += (dz / d) * push * wb;
        }
      }
      if (!p.dead && p.state !== 'evade' && p.state !== 'leap') {
        const dx = a.pos.x - p.pos.x, dz = a.pos.z - p.pos.z;
        const d = Math.hypot(dx, dz), min = a.radius + 0.5;
        if (d < min && d > 1e-4) {
          if (a.boss) { p.pos.x = a.pos.x - (dx / d) * min; p.pos.z = a.pos.z - (dz / d) * min; } else { a.pos.x = p.pos.x + (dx / d) * min; a.pos.z = p.pos.z + (dz / d) * min; }
        }
      }
    }

    for (let i = this.hazards.length - 1; i >= 0; i--) {
      const h = this.hazards[i];
      h.t += dt;
      const k = Math.min(1, h.t / h.delay);
      h.fill.scale.setScalar(Math.max(0.05, k) * h.r);
      h.fill.material.opacity = 0.12 + k * 0.3;
      h.group.position.y = g.world.heightAt(h.x, h.z) + 0.06;
      if (h.t >= h.delay) {
        if (!p.dead && Math.hypot(p.pos.x - h.x, p.pos.z - h.z) < h.r + 0.3) {
          if (p.takeDamage(h.dmg, g, h.level)) h.onHit?.();
        }
        g.events.emit('hazardBlast', { x: h.x, z: h.z, r: h.r, color: h.color });
        g.fx.burst(new THREE.Vector3(h.x, h.group.position.y + 0.3, h.z), h.color, 26, h.r * 2.5, { up: 4, life: 0.6 });
        g.fx.shake(0.12);
        this.scene.remove(h.group);
        this.hazards.splice(i, 1);
      }
    }

    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const b = this.projectiles[i];
      b.pos.x += b.vx * dt;
      b.pos.z += b.vz * dt;
      b.life -= dt;
      let gone = b.life <= 0 || g.world.colliders.pointBlocked(b.pos.x, b.pos.z);
      if (!gone && g.tether.blocksProjectile(b.pos, g)) gone = true;
      if (!gone && Math.hypot(b.pos.x - p.pos.x, b.pos.z - p.pos.z) < 0.7) {
        if (p.takeDamage(b.damage, g, b.level)) gone = true;
      }
      if (gone) { this.scene.remove(b.mesh); this.projectiles.splice(i, 1); }
    }

    for (let i = this.list.length - 1; i >= 0; i--) {
      const e = this.list[i];
      if (!e.alive && e.dying <= 0) {
        e.dispose(this.scene); // stays in camp.enemies (dead) so the camp knows it was cleared
        this.list.splice(i, 1);
      }
    }
  }

  updateEnemy(e, dt, g) {
    const p = g.player;
    const ground = g.world.heightAt(e.pos.x, e.pos.z);
    if (e.spawning > 0) {
      e.spawning -= dt;
      e.pos.y = ground - 2 * Math.max(0, e.spawning / SPAWN_TIME);
      return;
    }
    if (!e.alive) {
      e.dying -= dt;
      const k = Math.max(0, e.dying / 0.5);
      e.group.scale.set(e.scale * (1 + (1 - k) * 0.3), e.scale * k, e.scale * (1 + (1 - k) * 0.3));
      return;
    }
    const dist = Math.hypot(p.pos.x - e.pos.x, p.pos.z - e.pos.z);
    // Skip far-away enemies entirely (they're frozen until you come back).
    if (dist > 70) { e.group.visible = false; if (e.bar) e.bar.visible = false; return; }
    e.group.visible = true;

    e.stateTime += dt;
    e.tetherCd = Math.max(0, e.tetherCd - dt);
    e.slow = Math.max(0, e.slow - dt);
    e.vulnerable = Math.max(0, e.vulnerable - dt);
    e.cooldown -= dt;

    if (e.burn > 0) {
      e.burn -= dt;
      e.burnTick -= dt;
      if (Math.random() < 0.35) g.fx.burst(e.pos.clone().setY(e.pos.y + 1), 0xff8a3a, 1, 1, { up: 3, life: 0.4, gravity: -3 });
      if (e.burnTick <= 0) {
        e.burnTick = 0.5;
        this.damage(e, e.burnDps * 0.5, g, { color: '#ff9a4a', silent: true });
        if (!e.alive) return;
      }
    }

    // Aggro, leash
    const aggroRange = e.elite || e.named ? 13 : 11;
    if (!e.aggro && !p.dead && dist < aggroRange && !g.inSafeZone) this.alertPack(e);
    const homeDist = Math.hypot(e.pos.x - e.home.x, e.pos.z - e.home.z);
    if (e.aggro && (p.dead || g.inSafeZone || (homeDist > 34 && dist > 12)) && !e.boss) {
      e.aggro = false;
      e.hp = e.maxHp;
      e.setState('idle');
    }

    if (e.boss) e.think(dt, g, dist);
    else if (!e.aggro) this.idle(e, dt);
    else this.fight(e, dt, g, dist);

    // Elite affixes
    if (e.aggro && (e.elite || e.named)) {
      const affixes = e.named?.affixes ?? e.elite;
      e.affixTimer -= dt;
      if (e.affixTimer <= 0) {
        e.affixTimer = 4.5 + Math.random() * 2;
        if (affixes.includes('storm')) {
          for (let k = 0; k < 3; k++) this.hazard({ x: p.pos.x + (Math.random() - 0.5) * 5, z: p.pos.z + (Math.random() - 0.5) * 5, r: 1.8, delay: 1.1, dmg: e.dmg * 0.8, color: 0x8fd3ff, level: e.level });
        }
        if (affixes.includes('molten')) this.hazard({ x: e.pos.x, z: e.pos.z, r: 2.4, delay: 1.0, dmg: e.dmg * 0.7, color: 0xff6a1a, level: e.level });
      }
    }

    // Movement integration
    e.pos.x += (e.vel.x + e.knock.x) * dt;
    e.pos.z += (e.vel.z + e.knock.z) * dt;
    e.knock.multiplyScalar(Math.max(0, 1 - dt * 8));
    g.world.colliders.resolve(e.pos, e.radius, !!e.dungeon || g.inDungeon);
    e.pos.y = g.world.heightAt(e.pos.x, e.pos.z);

    // Visuals
    e.group.rotation.y = e.facing;
    e.flash = Math.max(0, e.flash - dt * 6);
    e.mat.emissive.setRGB(e.flash + (e.burn > 0 ? 0.25 : 0), e.flash * 0.9 + (e.burn > 0 ? 0.08 : 0), e.flash * 0.8 + (e.slow > 0 ? 0.3 : 0) + (e.vulnerable > 0 ? 0.15 : 0));
    if (!e.boss) {
      const wobble = e.state === 'windup' ? Math.sin(e.stateTime * 40) * 0.05 : 0;
      e.group.scale.set(e.scale * (1 + wobble), e.scale * (1 - wobble), e.scale * (1 + wobble));
      e.bar.visible = e.hp < e.maxHp || !!(e.elite || e.named);
      e.bar.position.set(e.pos.x, e.pos.y + 2.4 * e.scale + 0.2, e.pos.z);
      e.barFill.scale.x = Math.max(0.001, e.hp / e.maxHp);
      e.barFill.position.x = -0.53 * (1 - e.barFill.scale.x);
    }
    if (e.group.userData.orb) e.group.userData.orb.scale.setScalar(e.state === 'windup' ? 1.6 : 1);
  }

  idle(e, dt) {
    if (e.stateTime > 2.5 + (e.id % 5)) {
      e.stateTime = 0;
      e.wander.set(e.home.x + (Math.random() - 0.5) * 8, 0, e.home.z + (Math.random() - 0.5) * 8);
    }
    const dx = e.wander.x - e.pos.x, dz = e.wander.z - e.pos.z, d = Math.hypot(dx, dz);
    const want = d > 0.5 ? 1.2 : 0;
    e.vel.x += ((d > 0 ? dx / d : 0) * want - e.vel.x) * damp(4, dt);
    e.vel.z += ((d > 0 ? dz / d : 0) * want - e.vel.z) * damp(4, dt);
    if (want) e.facing += angleDelta(e.facing, Math.atan2(dx, dz)) * damp(4, dt);
    e.state = 'idle';
  }

  fight(e, dt, g, dist) {
    const p = g.player;
    const def = e.def;
    const dx = p.pos.x - e.pos.x, dz = p.pos.z - e.pos.z, d = dist || 1;
    const speed = def.speed * e.speedMult * (e.slow > 0 ? 0.45 : 1);
    const windup = def.windup * (e.speedMult > 1 ? 0.8 : 1);
    let wx = 0, wz = 0;
    if (e.state === 'idle') e.setState('chase');
    if (e.state !== 'windup') this.hideArc(e);

    if (def.ai === 'melee' || def.ai === 'brute') {
      const range = def.range * (def.ai === 'brute' ? 1 : e.scale);
      if (e.state === 'chase') {
        wx = (dx / d) * speed; wz = (dz / d) * speed;
        e.facing += angleDelta(e.facing, Math.atan2(dx, dz)) * damp(10, dt);
        if (d < range && !p.dead) {
          e.setState('windup');
          g.events.emit('enemyWindup', { enemy: e });
          if (def.ai === 'brute') this.hazard({ x: e.pos.x, z: e.pos.z, r: 3.2 * e.scale, delay: windup, dmg: e.dmg, color: 0xff3a2a, level: e.level, onHit: () => this.onEnemyHit(e, g) });
        }
      } else if (e.state === 'windup') {
        if (def.ai === 'melee') this.showArc(e, g, e.stateTime / windup, range + 0.4);
        if (e.stateTime >= windup) {
          if (def.ai === 'melee') {
            const off = Math.abs(angleDelta(e.facing, Math.atan2(dx, dz)));
            g.events.emit('enemyAttack', { enemy: e });
            if (d < range + 0.6 && off < 1.0 && p.takeDamage(e.dmg, g, e.level)) this.onEnemyHit(e, g);
            this.hideArc(e);
          }
          e.setState('recover');
        }
      } else if (e.state === 'recover' && e.stateTime > def.recover) e.setState('chase');
    } else {
      // ranged / caster
      e.facing += angleDelta(e.facing, Math.atan2(dx, dz)) * damp(10, dt);
      if (e.state === 'chase') {
        const keep = def.keep;
        const radial = d > keep + 1.5 ? 1 : d < keep - 2 ? -1 : 0;
        const strafe = Math.sin(g.time * 0.6 + e.id) > 0 ? 0.5 : -0.5;
        wx = ((dx / d) * radial - (dz / d) * strafe) * speed;
        wz = ((dz / d) * radial + (dx / d) * strafe) * speed;
        if (e.cooldown <= 0 && d < keep + 6 && !p.dead) {
          e.setState('windup');
          g.events.emit('enemyWindup', { enemy: e });
          if (def.ai === 'caster') {
            e.castAt = { x: p.pos.x + p.vel.x * 0.4, z: p.pos.z + p.vel.z * 0.4 };
          }
        }
      } else if (e.state === 'windup') {
        if (def.ai === 'ranged') this.showLine(e, g, e.stateTime / windup, Math.min(d, 15));
        if (e.stateTime >= windup) {
          if (def.ai === 'ranged') {
            this.fire(e.pos, e.facing, def.projSpeed, e.dmg, e.level);
            g.events.emit('enemyProjectile', { pos: e.pos, enemy: e });
            if (e.named) { this.fire(e.pos, e.facing + 0.25, def.projSpeed, e.dmg, e.level); this.fire(e.pos, e.facing - 0.25, def.projSpeed, e.dmg, e.level); }
            this.hideArc(e);
          } else {
            this.hazard({ x: e.castAt.x, z: e.castAt.z, r: 2.3, delay: 1.0, dmg: e.dmg, color: 0xb04dff, level: e.level, onHit: () => this.onEnemyHit(e, g) });
          }
          e.cooldown = def.cooldown * (0.8 + Math.random() * 0.4) * (e.speedMult > 1 ? 0.75 : 1);
          e.setState('recover');
        }
      } else if (e.state === 'recover' && e.stateTime > def.recover) e.setState('chase');
    }
    e.vel.x += (wx - e.vel.x) * damp(8, dt);
    e.vel.z += (wz - e.vel.z) * damp(8, dt);
  }

  onEnemyHit(e, g) {
    if (e.elite?.includes('vampiric') || e.named?.affixes.includes('vampiric')) {
      e.hp = Math.min(e.maxHp, e.hp + e.maxHp * 0.08);
      g.fx.burst(e.pos.clone().setY(e.pos.y + 1.2), 0xff3a5a, 10, 2, { up: 2, life: 0.5, gravity: -2 });
    }
  }

  // Telegraph meshes (one per enemy, created lazily).
  telegraph(e, kind) {
    if (!e.tele || e.tele.userData.kind !== kind) {
      if (e.tele) this.scene.remove(e.tele);
      const geo = kind === 'arc' ? new THREE.CircleGeometry(1, 28, -0.9, 1.8) : new THREE.PlaneGeometry(0.5, 1);
      e.tele = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xff2a2a, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
      e.tele.rotation.x = -Math.PI / 2;
      e.tele.userData.kind = kind;
      this.scene.add(e.tele);
      const dispose = e.dispose.bind(e);
      e.dispose = (scene) => { dispose(scene); scene.remove(e.tele); };
    }
    e.tele.visible = true;
    return e.tele;
  }

  showArc(e, g, k, length) {
    const t = this.telegraph(e, 'arc');
    t.material.opacity = 0.15 + k * 0.45;
    t.position.set(e.pos.x, e.pos.y + 0.06, e.pos.z);
    t.rotation.z = e.facing - Math.PI / 2;
    t.scale.setScalar(Math.max(0.1, k) * length);
  }

  showLine(e, g, k, length) {
    const t = this.telegraph(e, 'line');
    t.material.opacity = 0.15 + k * 0.45;
    t.scale.set(0.3 + k * 0.4, length, 1);
    t.position.set(e.pos.x + Math.sin(e.facing) * length / 2, e.pos.y + 0.06, e.pos.z + Math.cos(e.facing) * length / 2);
    t.rotation.z = e.facing;
  }

  hideArc(e) { if (e.tele) e.tele.visible = false; }
}

function pickAffixes(rng, n) {
  const pool = Object.keys(ELITE_AFFIXES);
  const out = [];
  while (out.length < n) {
    const a = rng.pick(pool);
    if (!out.includes(a)) out.push(a);
  }
  return out;
}
