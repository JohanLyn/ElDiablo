import * as THREE from 'three';
import { Enemy } from '../entities/enemies.js';
import { Neti } from '../entities/boss.js';
import { DUNGEON_SPOTS } from '../world/dungeon.js';
import { DUNGEON_ENTRANCE, TOWN, REGIONS } from '../world/layout.js';
import { monsterLevelFor } from './stats.js';

const RANGE = 2.6;

// Everything the hero can use with A / E: NPCs, loot, waypoints, shrines,
// chests, the dungeon gate and town portals. Also runs the ritual world event.
export class Interactions {
  constructor(g) {
    this.g = g;
    this.portal = null; // { mesh, returnTo }
    this.exitPortal = null;
    this.ritual = { state: 'idle', time: 0, kills: 0, goal: 20, spawnTimer: 0, cooldown: 0, enemies: new Set() };
    this.portalMat = new THREE.MeshBasicMaterial({ color: 0x5d95ff, transparent: true, opacity: 0.7, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false });
  }

  candidates() {
    const g = this.g;
    const list = [];
    const L = g.loot.nearestItem(g.player.pos, RANGE);
    if (L) list.push({ x: L.pos.x, z: L.pos.z, label: `Pick up ${L.item.name}`, priority: 2, use: () => this.pickUp(L) });
    for (const n of g.world.npcs) list.push({ x: n.x, z: n.z, label: `Talk to ${n.name.split(',')[0]}`, use: () => g.ui.talk(n) });
    for (const w of g.world.waypoints) list.push({ x: w.x, z: w.z, r: 3.2, label: `Use waypoint: ${w.name}`, use: () => g.ui.openMap(true) });
    for (const s of g.world.shrines) if (s.cooldown <= 0) list.push({ x: s.x, z: s.z, label: `Pray at ${s.def.name}`, use: () => this.useShrine(s) });
    for (const c of g.world.chests) if (!c.opened) list.push({ x: c.x, z: c.z, label: c.tier >= 3 ? 'Open gilded chest' : 'Open chest', use: () => this.openChest(c) });
    if (!g.inDungeon) list.push({ x: DUNGEON_ENTRANCE.x, z: DUNGEON_ENTRANCE.z, r: 4, label: 'Enter the Ganzir Stair', use: () => g.enterDungeon() });
    if (g.inDungeon) list.push({ x: DUNGEON_SPOTS.entry.x, z: DUNGEON_SPOTS.entry.z + 3, r: 3, label: 'Climb back to the surface', use: () => g.leaveDungeon() });
    if (this.exitPortal) list.push({ x: this.exitPortal.position.x, z: this.exitPortal.position.z, r: 2.5, label: 'Leave through the portal', use: () => g.leaveDungeon() });
    if (this.portal) list.push({ x: this.portal.mesh.position.x, z: this.portal.mesh.position.z, r: 2.5, label: 'Return through the Town Portal', use: () => this.returnThroughPortal() });
    return list;
  }

  update(dt) {
    const g = this.g;
    const p = g.player;
    let best = null, bestScore = Infinity;
    if (!p.dead && p.state !== 'leap') {
      for (const c of this.candidates()) {
        const d = Math.hypot(p.pos.x - c.x, p.pos.z - c.z);
        if (d > (c.r ?? RANGE)) continue;
        const score = d - (c.priority ?? 0);
        if (score < bestScore) { bestScore = score; best = c; }
      }
    }
    g.interactTarget = best;
    g.highlightedLoot = best?.label.startsWith('Pick up') ? g.loot.nearestItem(p.pos, RANGE) : null;

    if (!g.uiOpen && best) {
      const viaA = g.input.pressed.skill1 && !g.combatNearby;
      if (g.input.pressed.interact || viaA) best.use();
    }

    // Discover waypoints by walking near them.
    for (const w of g.world.waypoints) {
      if (!w.discovered && Math.hypot(p.pos.x - w.x, p.pos.z - w.z) < 7) {
        w.discovered = true;
        g.hud.banner(`Waypoint discovered: ${w.name}`, 'waypoint');
        g.events.emit('waypoint', { id: w.id });
        g.quests.notify({ type: 'discover', id: w.id });
        g.save();
      }
      if (Math.hypot(p.pos.x - w.x, p.pos.z - w.z) < 7) p.lastWaypoint = w.id;
    }
    for (const s of g.world.shrines) s.cooldown = Math.max(0, s.cooldown - dt);
    this.updateRitual(dt);
    if (this.portal) this.portal.mesh.rotation.y += dt;
    if (this.exitPortal) this.exitPortal.rotation.y += dt;
  }

  pickUp(L) {
    const g = this.g;
    if (!g.player.addItem(L.item)) { g.hud.notify('Your inventory is full', 'warn'); return; }
    g.loot.remove(L);
    g.events.emit('pickup', { kind: 'item', rarity: L.item.rarity, item: L.item });
    g.hud.feed(L.item.name, `r-${L.item.rarity}`);
    g.fx.rumble(0.1, 0.2, 40);
  }

  useShrine(s) {
    const g = this.g;
    s.cooldown = 120;
    g.player.addBuff(`shrine-${s.kind}`, s.def.buff, s.def.stats, 45);
    g.hud.banner(s.def.buff, 'shrine');
    g.events.emit('shrine', { kind: s.kind, pos: s.model.position });
    g.fx.burst(g.player.pos.clone().setY(g.player.pos.y + 1), s.def.color, 40, 5, { up: 5, life: 1 });
  }

  openChest(c) {
    const g = this.g;
    c.opened = true;
    c.model.userData.lid.rotation.x = -1.9;
    const ilvl = monsterLevelFor(REGIONS[g.world.regionAt(c.x, c.z)].level, g.player.level);
    g.loot.dropChest(c.tier, c.model.position, g, ilvl);
    g.events.emit('chestOpen', { pos: c.model.position, tier: c.tier });
    g.fx.burst(c.model.position.clone().setY(c.model.position.y + 1), 0xffd060, 30, 4, { up: 4, life: 0.8 });
    g.save();
  }

  // ---- dungeon portal after Neti ----------------------------------------------------
  spawnExitPortal() {
    if (this.exitPortal) return;
    const m = new THREE.Mesh(new THREE.TorusGeometry(1.4, 0.35, 8, 24), this.portalMat);
    m.position.set(DUNGEON_SPOTS.exit.x, 1.6, DUNGEON_SPOTS.exit.z);
    this.g.scene.add(m);
    this.exitPortal = m;
  }

  removeExitPortal() {
    if (this.exitPortal) { this.g.scene.remove(this.exitPortal); this.exitPortal = null; }
  }

  // ---- town portal -------------------------------------------------------------------------
  createTownPortal(returnTo) {
    this.removeTownPortal();
    const m = new THREE.Mesh(new THREE.TorusGeometry(1.2, 0.3, 8, 24), this.portalMat);
    m.position.set(TOWN.x + 2, 1.5, TOWN.z - 4);
    this.g.scene.add(m);
    this.portal = { mesh: m, returnTo: returnTo.clone() };
    this.g.events.emit('portal', {});
  }

  removeTownPortal() {
    if (this.portal) { this.g.scene.remove(this.portal.mesh); this.portal = null; }
  }

  returnThroughPortal() {
    if (!this.portal) return;
    const to = this.portal.returnTo;
    this.removeTownPortal();
    this.g.teleport(to.x, to.z);
  }

  // ---- world event: Ritual of the Gallu --------------------------------------------------------
  updateRitual(dt) {
    const g = this.g;
    const R = this.ritual;
    const W = g.world.ritual;
    const p = g.player;
    const inside = Math.hypot(p.pos.x - W.x, p.pos.z - W.z) < W.r;
    R.cooldown = Math.max(0, R.cooldown - dt);
    W.ringMat.opacity = R.state === 'active' ? 0.5 + Math.sin(g.time * 6) * 0.2 : R.cooldown > 0 ? 0 : 0.18;

    if (R.state === 'idle' && inside && R.cooldown <= 0 && !p.dead) {
      R.state = 'active';
      R.time = 50;
      R.kills = 0;
      R.spawnTimer = 0;
      R.enemies.clear();
      g.hud.banner('Event: Ritual of the Gallu', 'event');
    }
    if (R.state !== 'active') { g.hud.setEvent(null); return; }

    R.time -= dt;
    R.spawnTimer -= dt;
    const outside = Math.hypot(p.pos.x - W.x, p.pos.z - W.z) > W.r + 22;
    if (R.spawnTimer <= 0 && R.kills + this.aliveEventEnemies() < R.goal) {
      R.spawnTimer = 5;
      const level = monsterLevelFor(REGIONS.sunfields.level, p.level);
      for (let i = 0; i < 5; i++) {
        const a = Math.random() * Math.PI * 2;
        const e = new Enemy(Math.random() < 0.7 ? 'gallu' : 'utukku', { level, x: W.x + Math.cos(a) * (W.r + 2), z: W.z + Math.sin(a) * (W.r + 2) }, g.scene);
        e.aggro = true;
        e.home.set(W.x, 0, W.z);
        e.eventMob = true;
        g.enemies.add(e);
        R.enemies.add(e);
      }
    }
    g.hud.setEvent({ name: W.name, text: `Slay the ritual's servants: ${R.kills}/${R.goal}`, time: R.time });

    if (R.kills >= R.goal) {
      R.state = 'idle';
      R.cooldown = 180;
      g.hud.banner('Event complete!', 'event');
      g.quests.notify({ type: 'event', id: 'ev-ritual' });
      const ilvl = monsterLevelFor(REGIONS.sunfields.level, p.level);
      g.loot.dropChest(3, new THREE.Vector3(W.x, g.world.heightAt(W.x, W.z), W.z), g, ilvl);
      p.gainXp(60 + ilvl * 20, g);
      this.cleanupEventEnemies(false);
    } else if (R.time <= 0 || p.dead || outside) {
      R.state = 'idle';
      R.cooldown = 45;
      g.hud.banner('Event failed', 'warn');
      this.cleanupEventEnemies(true);
    }
  }

  aliveEventEnemies() {
    let n = 0;
    for (const e of this.ritual.enemies) if (e.alive) n++;
    return n;
  }

  onKill(e) {
    if (e.eventMob && this.ritual.state === 'active') this.ritual.kills++;
  }

  cleanupEventEnemies(removeAlive) {
    for (const e of this.ritual.enemies) {
      if (removeAlive && e.alive) {
        e.dispose(this.g.scene);
        const i = this.g.enemies.list.indexOf(e);
        if (i >= 0) this.g.enemies.list.splice(i, 1);
      }
    }
    this.ritual.enemies.clear();
  }

  spawnBoss() {
    const g = this.g;
    const level = monsterLevelFor(REGIONS.dungeon.level, g.player.level) + 2;
    const boss = new Neti(level, DUNGEON_SPOTS.boss.x, DUNGEON_SPOTS.boss.z, g.scene);
    boss.dungeon = true;
    g.enemies.add(boss);
    return boss;
  }
}
