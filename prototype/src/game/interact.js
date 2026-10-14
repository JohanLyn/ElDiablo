import * as THREE from 'three';
import { Neti } from '../entities/boss.js';
import { Enemy } from '../entities/enemies.js';
import { INSTANCES } from '../world/instances.js';
import { TOWN, REGIONS, PYRES } from '../world/layout.js';
import { buildPyres, PYRE_LIT_RADIUS } from '../world/pyres.js';
import { monsterLevelFor } from './stats.js';
import { generateItem } from './items.js';

// The Wailing Pyres (world event, Ashen Approach): light three pyres, ~3 s of standing beside each,
// while ash-wraiths rise from the ground. Same shape as the Ritual below.
const PYRE_TIME = 90, PYRE_LIGHT_TIME = 3, PYRE_COOLDOWN = 240, PYRE_NEAR = 40, PYRE_ASH = 0x9a8fa8;

const RANGE = 2.6;

// Everything the hero can use with A / E: NPCs, loot, waypoints, shrines,
// chests, the dungeon gate and town portals. Also runs the ritual world event.
export class Interactions {
  constructor(g) {
    this.g = g;
    this.portal = null; // { mesh, returnTo }
    this.exitPortal = null;
    this.ritual = { state: 'idle', time: 0, kills: 0, goal: 20, spawnTimer: 0, cooldown: 0, enemies: new Set() };
    this.pyres = { state: 'idle', time: 0, kills: 0, wave: 0, spawnTimer: 0, cooldown: 0, progress: [0, 0, 0], lit: [false, false, false], enemies: new Set(), told: false };
    this.pyreWorld = buildPyres(g);
    this.exitGeo = new THREE.TorusGeometry(1.4, 0.35, 8, 24);
    this.townGeo = new THREE.TorusGeometry(1.2, 0.3, 8, 24);
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
    const PY = this.pyres;
    if (!g.instance && PY.state === 'idle' && PY.cooldown <= 0) {
      for (const sp of this.pyreWorld.spots) list.push({ x: sp.x, z: sp.z, r: 3.4, label: 'Kindle the Wailing Pyres', use: () => this.startPyres() });
    }
    if (!g.instance) {
      for (const inst of Object.values(INSTANCES)) list.push({ x: inst.entrance.x, z: inst.entrance.z, r: 4, label: `Enter the ${inst.name.replace(/^The /, '')}`, use: () => g.enterDungeon(inst.id) });
    } else {
      const e = g.instance.spots.entry;
      list.push({ x: e.x, z: e.z + 3, r: 3, label: 'Climb back to the surface', use: () => g.leaveDungeon() });
    }
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
      if (Math.hypot(p.pos.x - w.x, p.pos.z - w.z) >= 7) continue;
      p.lastWaypoint = w.id;
      // Re-reported on every visit (a no-op unless it is the active objective), so a
      // waypoint found before its quest still completes it later.
      g.quests.notify({ type: 'discover', id: w.id });
      if (!w.discovered) {
        w.discovered = true;
        g.hud.banner(`Waypoint discovered: ${w.name}`, 'waypoint');
        g.events.emit('waypoint', { id: w.id });
        g.save();
      }
    }
    for (const s of g.world.shrines) s.cooldown = Math.max(0, s.cooldown - dt);
    this.updateRitual(dt);
    this.updatePyres(dt);
    if (this.portal) this.portal.mesh.rotation.y += dt;
    if (this.exitPortal) this.exitPortal.rotation.y += dt;
  }

  pickUp(L) {
    const g = this.g;
    if (!g.player.addItem(L.item)) { g.hud.notify('Your inventory is full', 'warn'); return; }
    // A guaranteed first-clear Legendary only counts once it is in the bag (ground loot isn't saved).
    if (L.item.firstClearFlag) { g.flags[L.item.firstClearFlag] = true; delete L.item.firstClearFlag; g.save(); }
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
    if (this.exitPortal || !this.g.instance) return;
    const spot = this.g.instance.spots.exit;
    const m = new THREE.Mesh(this.exitGeo, this.portalMat);
    m.position.set(spot.x, 1.6, spot.z);
    this.g.scene.add(m);
    this.exitPortal = m;
  }

  // Forget everything from a previous run (new game / continue mid-session).
  reset() {
    this.removeTownPortal();
    this.removeExitPortal();
    this.cleanupEventEnemies(true);
    Object.assign(this.ritual, { state: 'idle', time: 0, kills: 0, spawnTimer: 0, cooldown: 0 });
    Object.assign(this.pyres, { state: 'idle', time: 0, kills: 0, wave: 0, spawnTimer: 0, cooldown: 0, progress: [0, 0, 0], lit: [false, false, false] });
    for (const s of this.g.world.shrines) s.cooldown = 0;
  }

  removeExitPortal() {
    if (this.exitPortal) { this.g.scene.remove(this.exitPortal); this.exitPortal = null; }
  }

  // ---- town portal -------------------------------------------------------------------------
  createTownPortal(returnTo) {
    this.removeTownPortal();
    const m = new THREE.Mesh(this.townGeo, this.portalMat);
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

  aliveEventEnemies(set = this.ritual.enemies) {
    let n = 0;
    for (const e of set) if (e.alive) n++;
    return n;
  }

  onKill(e) {
    if (e.eventMob && this.ritual.state === 'active') this.ritual.kills++;
    if (e.pyreMob && this.pyres.state === 'active') this.pyres.kills++;
  }

  cleanupEventEnemies(removeAlive) {
    for (const set of [this.ritual.enemies, this.pyres.enemies]) {
      for (const e of set) {
        if (removeAlive && e.alive) {
          e.dispose(this.g.scene);
          const i = this.g.enemies.list.indexOf(e);
          if (i >= 0) this.g.enemies.list.splice(i, 1);
        }
      }
      set.clear();
    }
  }

  // ---- world event: The Wailing Pyres ------------------------------------------------------------
  startPyres() {
    const g = this.g, P = this.pyres;
    if (P.state !== 'idle' || P.cooldown > 0 || g.player.dead) return;
    Object.assign(P, { state: 'active', time: PYRE_TIME, kills: 0, wave: 0, spawnTimer: 4, progress: [0, 0, 0], lit: [false, false, false] });
    P.enemies.clear();
    g.hud.banner('Event: The Wailing Pyres', 'event', 'Light all three pyres before the ash takes you');
    g.events.emit('pyresStart', { pos: this.pyreWorld.center });
    g.fx.rumble(0.3, 0.4, 300);
  }

  updatePyres(dt) {
    const g = this.g, P = this.pyres, W = this.pyreWorld, p = g.player;
    P.cooldown = Math.max(0, P.cooldown - dt);
    const d = Math.hypot(p.pos.x - PYRES.x, p.pos.z - PYRES.z);
    W.update(g.time);

    // What each pyre shows when no event is running: cold, or (once completed) banked as a landmark.
    const banked = g.flags.pyresDone ? 0.45 : 0;
    const settle = (i, target) => W.setLit(i, W.lit[i] + Math.max(-dt * 1.5, Math.min(dt * 1.2, target - W.lit[i])));

    if (P.state === 'idle') {
      const lingering = P.cooldown > 0 && P.lit.every(Boolean); // just completed: blazing until the cooldown ends
      for (let i = 0; i < 3; i++) { settle(i, lingering ? 1 : banked); W.setRing(i, 0, g.flags.pyresDone || P.cooldown > 0 ? 0 : d < 22 ? 0.35 : 0); }
      // Optional tracker line while the event is up for grabs and the hero is close.
      if (!g.instance && P.cooldown <= 0 && d < PYRE_NEAR && !p.dead && this.ritual.state !== 'active') {
        g.hud.setEvent({ name: 'Event nearby', text: PYRES.name, hint: true });
        if (!P.told) { P.told = true; g.hud.notify(`Event nearby: ${PYRES.name}`, 'event'); }
      }
      if (d > PYRE_NEAR + 20) P.told = false;
      return;
    }

    // ---- active
    P.time -= dt;
    P.spawnTimer -= dt;
    for (let i = 0; i < 3; i++) {
      const sp = W.spots[i];
      if (P.lit[i]) { settle(i, 1); W.setRing(i, 1, 0.35); continue; }
      settle(i, 0);
      const near = !p.dead && Math.hypot(p.pos.x - sp.x, p.pos.z - sp.z) < PYRE_LIT_RADIUS;
      P.progress[i] = Math.max(0, Math.min(1, P.progress[i] + (near ? dt / PYRE_LIGHT_TIME : -dt * 0.5)));
      W.setRing(i, P.progress[i], 0.55 + Math.sin(g.time * 6) * 0.15);
      if (near && Math.random() < dt * 14) g.vfx?.motes(sp.x, sp.y + 0.4, sp.z, 1, 0.5, 0.6, 3.5, 0xdff6ff, 0x4a7ad8, 0.2, 0.8, -1);
      if (P.progress[i] >= 1) {
        P.lit[i] = true;
        g.hud.notify(`Pyre lit (${P.lit.filter(Boolean).length}/3)`, 'quest');
        g.events.emit('pyreLit', { index: i, pos: sp });
        g.fx.burst(new THREE.Vector3(sp.x, sp.y + 1.2, sp.z), 0x7fd0ff, 40, 5, { up: 6, life: 1 });
        g.renderer.shockwave(new THREE.Vector3(sp.x, sp.y + 1, sp.z), 0.018, 7, 0.5);
        g.fx.shake(0.12);
      }
    }
    // Ash-wraiths and utukku climb out of the ashen ground around the plateau.
    const lit = P.lit.filter(Boolean).length;
    if (P.spawnTimer <= 0 && lit < 3) {
      P.spawnTimer = 9 - lit * 1.5;
      P.wave++;
      this.spawnPyreWave(3 + lit + (P.wave > 2 ? 1 : 0));
    }
    g.hud.setEvent({ name: PYRES.name, text: `Light the pyres: ${lit}/3`, time: P.time, total: PYRE_TIME });

    if (lit >= 3) this.finishPyres();
    else if (P.time <= 0 || p.dead || d > PYRE_NEAR + 10) {
      P.state = 'idle';
      P.cooldown = 45;
      g.hud.banner('Event failed', 'warn', 'The pyres gutter out');
      g.hud.setEvent(null);
      P.lit = [false, false, false];
      this.cleanupEventEnemies(true);
    }
  }

  spawnPyreWave(n) {
    const g = this.g, P = this.pyres, level = monsterLevelFor(REGIONS.ashen.level, g.player.level);
    if (this.aliveEventEnemies(P.enemies) >= 10) return;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, r = 12 + Math.random() * 4;
      const x = PYRES.x + Math.cos(a) * r, z = PYRES.z + Math.sin(a) * r;
      const wraith = Math.random() < 0.72;
      const e = new Enemy(wraith ? 'utukku' : 'gallu', { level, x, z, tint: wraith ? PYRE_ASH : null }, g.scene);
      if (wraith) e.name = 'Ash-Wraith';
      e.aggro = true;
      e.home.set(PYRES.x, 0, PYRES.z);
      e.pyreMob = true;
      g.enemies.add(e);
      P.enemies.add(e);
      g.fx.burst(new THREE.Vector3(x, g.world.heightAt(x, z) + 0.3, z), 0x9a8fa8, 6, 2.5, { up: 2, life: 0.6 });
    }
  }

  finishPyres() {
    const g = this.g, P = this.pyres, p = g.player, c = this.pyreWorld.center;
    P.state = 'idle';
    P.cooldown = PYRE_COOLDOWN;
    P.lit = [true, true, true];
    g.flags.pyresDone = true;
    g.hud.setEvent(null);
    g.hud.banner('Event complete!', 'event', 'The Wailing Pyres burn');
    g.quests.notify({ type: 'event', id: PYRES.id });
    const ilvl = monsterLevelFor(REGIONS.ashen.level, p.level);
    const pos = new THREE.Vector3(c.x, c.y, c.z);
    g.loot.dropItem(generateItem({ ilvl, rarity: 'rare' }), pos, g);
    for (let i = 0; i < 4; i++) g.loot.dropGold(Math.round((8 + Math.random() * 6) * ilvl), pos, g);
    if (Math.random() < 0.6) g.loot.dropOrb(pos, g);
    p.gainXp(90 + ilvl * 25, g);
    g.renderer.pulse(0x9fd8ff, 0.25);
    for (const e of P.enemies) if (e.alive) { e.aggro = false; e.pyreMob = false; } // stragglers lose heart
    P.enemies.clear();
    // Hook for the ghost-currency feature (Night of the Gidim): the pyres' fire draws the dead.
    g.events.emit('pyresComplete', { pos });
    g.save();
  }

  // Each instance ends in a guardian: Neti in the Ganzir Stair, a named champion elsewhere.
  spawnBoss(inst = INSTANCES.ganzir) {
    const g = this.g;
    // Guardians sit a little above the hero; Neti only one level, so the first gate is a test, not a wall.
    const level = monsterLevelFor(REGIONS[inst.region].level, g.player.level) + (inst.guardian ? 2 : 1);
    const at = inst.spots.boss;
    let boss;
    if (inst.guardian) {
      boss = new Enemy(inst.guardian.type, { level, named: inst.guardian, x: at.x, z: at.z }, g.scene);
      // Hidden under the pool until the hero approaches: src/fx/bossIntro.js raises it with a title card.
      boss.spawning = boss.spawnTotal = 1e5;
      boss.group.userData.rig.setShadows(false);
    } else {
      boss = new Neti(level, at.x, at.z, g.scene);
    }
    boss.dungeon = true;
    g.enemies.add(boss);
    return boss;
  }
}
