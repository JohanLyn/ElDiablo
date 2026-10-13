import * as THREE from 'three';
import { Renderer } from './core/render.js';
import { Settings } from './core/settings.js';
import { Events } from './core/events.js';
import { Input } from './core/input.js';
import { Fx } from './core/fx.js';
import { CameraRig } from './core/camera.js';
import { buildWorld } from './world/world.js';
import { DUNGEON_SPOTS } from './world/dungeon.js';
import { DUNGEON_Z } from './world/terrain.js';
import { DUNGEON_ENTRANCE, TOWN, AQRABU, WAYPOINTS } from './world/layout.js';
import { Player } from './entities/player.js';
import { Tether } from './entities/tether.js';
import { Abilities } from './entities/abilities.js';
import { EnemyManager } from './entities/enemies.js';
import { Loot } from './game/loot.js';
import { Interactions } from './game/interact.js';
import { QuestLog } from './game/quests.js';
import { generateItem } from './game/items.js';
import { loadSave, writeSave, clearSave, encodeBytes, decodeBytes } from './game/save.js';
import { Hud } from './ui/hud.js';
import { UI } from './ui/ui.js';
import { Fog, FOG_RES } from './ui/mapdraw.js';
import { Vfx } from './fx/vfx.js';

export const VERSION = '0.3.0-alpha';

// ?low or ?quality=medium override the saved graphics preset (slow machines, automated tests).
const settings = new Settings();
const events = new Events();
const canvas = document.getElementById('game');
const renderer = new Renderer(canvas, settings);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, 1, 0.5, 400);

// Let the loading screen paint before the (synchronous) world build.
requestAnimationFrame(() => setTimeout(boot, 30));

function boot() {
  const input = new Input(canvas, camera);
  const world = buildWorld(scene, settings);
  renderer.attach(scene, camera);
  const fx = new Fx(scene, camera, input, document.getElementById('numbers'));
  fx.settings = settings;
  input.settings = settings;
  const player = new Player(scene);
  const tether = new Tether(scene);
  const abilities = new Abilities(scene);
  const enemies = new EnemyManager(scene);
  const loot = new Loot(scene, document.getElementById('labels'));
  const hud = new Hud();
  const rig = new CameraRig(camera, world.occluders);

  // Shared game context handed to every system.
  const g = {
    scene, camera, input, fx, world, player, tether, abilities, enemies, loot, hud, rig,
    renderer, settings, events, version: VERSION,
    quests: new QuestLog(), fog: new Fog(),
    time: 0, timers: [], flags: {}, started: false,
    inDungeon: false, inSafeZone: true, combatNearby: false, interactTarget: null, suppressInput: false,
    get uiOpen() { return ui.open; },

    start(fresh) {
      const save = fresh ? null : loadSave();
      if (fresh) clearSave();
      player.init(save?.player);
      g.quests = new QuestLog(save?.quests);
      bindQuestEvents();
      g.flags = save?.flags ?? {};
      g.fog = new Fog();
      if (save?.fog) g.fog.load(decodeBytes(save.fog, FOG_RES * FOG_RES));
      const found = new Set(save?.waypoints ?? ['wp-town']);
      for (const w of world.waypoints) w.discovered = found.has(w.id);
      const opened = new Set(save?.chests ?? []);
      for (const c of world.chests) { c.opened = opened.has(c.id); c.model.userData.lid.rotation.x = c.opened ? -1.9 : 0; }
      for (const c of enemies.camps) if (c.state !== 'dormant') enemies.despawnCamp(c);
      enemies.clearDungeon();
      loot.clearAll();
      abilities.reset();
      g.started = true;
      hud.show(true);
      const wp = world.waypoints.find((w) => w.id === player.lastWaypoint) ?? world.waypoints[0];
      g.teleport(wp.x, wp.z + 3);
      tether.reset(g);
      if (!save) hud.banner('Eridu Outpost', 'region', 'Speak with Ninsun, High Priestess');
      g.save();
    },

    newGame() { g.start(true); },

    save() {
      if (!g.started) return;
      writeSave({
        player: player.serialize(), quests: g.quests.toJSON(), flags: g.flags,
        waypoints: world.waypoints.filter((w) => w.discovered).map((w) => w.id),
        chests: world.chests.filter((c) => c.opened).map((c) => c.id),
        fog: encodeBytes(g.fog.cells),
      });
    },

    teleport(x, z) {
      const wasDungeon = g.inDungeon;
      player.pos.set(x, 0, z);
      g.inDungeon = z < DUNGEON_Z;
      g.inSafeZone = world.regionAt(x, z) === 'town';
      world.colliders.resolve(player.pos, 0.5, g.inDungeon);
      player.pos.y = world.heightAt(player.pos.x, player.pos.z);
      player.vel.set(0, 0, 0);
      if (wasDungeon && !g.inDungeon) { enemies.clearDungeon(); g.interactions.removeExitPortal(); }
      rig.snapTo(player.pos);
      tether.reset(g);
      enemies.updateCamps(g);
    },

    enterDungeon() {
      g.teleport(DUNGEON_SPOTS.entry.x, DUNGEON_SPOTS.entry.z);
      enemies.populateDungeon(g);
      g.interactions.removeExitPortal();
      g.interactions.spawnBoss();
      g.quests.notify({ type: 'enter', id: 'dungeon' });
      hud.banner('The Ganzir Stair', 'region', 'Dungeon · resets each time you enter');
    },

    leaveDungeon() {
      enemies.clearDungeon();
      g.interactions.removeExitPortal();
      g.teleport(DUNGEON_ENTRANCE.x, DUNGEON_ENTRANCE.z + 7);
    },

    startTownPortal() {
      if (g.inSafeZone) { hud.notify('You are already in town', 'warn'); return; }
      if (g.inDungeon && enemies.list.some((e) => e.boss && e.aggro && e.alive)) { hud.notify('Neti\'s seal blocks the portal', 'warn'); return; }
      abilities.channel = { t: 0 };
    },

    openTownPortal() {
      const from = player.pos.clone();
      const leavingDungeon = g.inDungeon;
      if (leavingDungeon) enemies.clearDungeon();
      g.interactions.createTownPortal(leavingDungeon ? new THREE.Vector3(DUNGEON_ENTRANCE.x, 0, DUNGEON_ENTRANCE.z + 7) : from);
      g.teleport(TOWN.x + 2, TOWN.z - 1);
      hud.banner('Eridu Outpost', 'region', 'Your portal will carry you back');
    },

    respawn() {
      player.resetCombatState();
      player.life = player.stats.maxLife;
      player.anima = player.stats.maxAnima * 0.5;
      player.potions = player.maxPotions;
      abilities.reset();
      if (g.inDungeon) g.leaveDungeon();
      const wp = world.waypoints.find((w) => w.id === player.lastWaypoint) ?? world.waypoints[0];
      g.teleport(wp.x, wp.z + 3);
    },

    onEnemyKilled(e) {
      player.gainXp(e.xp, g);
      loot.dropFor(e, g);
      const region = e.camp?.region ?? world.regionAt(e.pos.x, e.pos.z);
      g.quests.notify({ type: 'kill', region, named: e.named?.id, boss: e.boss ? 'neti' : undefined });
      g.interactions.onKill(e);
      if (e.boss) {
        hud.banner('Neti has fallen', 'boss', 'The First Gate is open');
        g.interactions.spawnExitPortal();
        g.save();
      }
    },

    onLevelUp(level) {
      hud.banner(`Level ${level}`, 'level', 'Skill point gained · open Skills (K / Start)');
      g.events.emit('levelUp', { level });
      renderer.pulse(0xf3d68a, 0.25);
      fx.burst(player.pos.clone().setY(player.pos.y + 1), 0xf3d68a, 60, 6, { up: 6, life: 1.2, gravity: -1 });
      fx.rumble(0.4, 0.6, 200);
      g.save();
    },

    onPlayerDeath() {
      g.timers.push({ t: 1.4, fn: () => ui.showDeath() });
    },

    questMarker() {
      const q = g.quests;
      if (q.done) return null;
      if (!q.accepted) { const n = world.npcs.find((x) => x.id === 'ninsun'); return { x: n.x, z: n.z }; }
      const m = q.active.marker;
      if (m.startsWith('wp-')) { const w = WAYPOINTS.find((x) => x.id === m); return { x: w.x, z: w.z }; }
      if (m === 'named-aqrabu') return { x: AQRABU.x, z: AQRABU.z };
      if (m === 'boss-neti' && g.inDungeon) return DUNGEON_SPOTS.boss;
      return { x: DUNGEON_ENTRANCE.x, z: DUNGEON_ENTRANCE.z };
    },
  };
  g.interactions = new Interactions(g);
  g.vfx = new Vfx(g);
  const ui = new UI(g);
  g.ui = ui;
  window.__game = g; // handy for debugging in the console and for automated smoke tests

  function bindQuestEvents() {
    g.quests.onChange((kind, q) => {
      g.events.emit('questUpdate', { kind, quest: q });
      if (kind === 'accepted' && g.quests.index > 0) hud.banner(`New quest: ${q.title}`, 'quest', q.objective.text);
      if (kind === 'completed') {
        hud.banner(`Quest complete: ${q.title}`, 'quest', `+${q.reward.xp} XP · +${q.reward.gold} gold`);
        player.gold += q.reward.gold;
        player.gainXp(q.reward.xp, g);
        if (q.reward.item) loot.dropItem(generateItem({ ilvl: player.level, rarity: q.reward.item.rarity }), player.pos, g);
        g.save();
      }
    });
  }

  // Title screen: the camera rests over Eridu Outpost.
  player.init(null);
  g.teleport(TOWN.x, TOWN.z + 4);
  tether.reset(g);
  document.getElementById('loading').remove();
  ui.showTitle(!!loadSave());

  let last = performance.now();
  let fogTimer = 0, saveTimer = 0;
  function frame(now) {
    const realDt = Math.min(Math.max(0, now - last) / 1000, 1 / 20);
    last = now;
    input.update(realDt, player.pos);
    document.body.dataset.device = input.device;
    if (g.suppressInput) {
      // Swallow the button press that closed a menu so it doesn't also attack.
      for (const k of Object.keys(input.pressed)) input.pressed[k] = false;
      input.nav = { x: 0, y: 0 };
      g.suppressInput = false;
    }
    ui.update(realDt);

    if (g.started && !ui.open) {
      const dt = fx.hitstop > 0 ? 0 : realDt;
      g.time += dt;
      const region = world.regionAt(player.pos.x, player.pos.z);
      g.inSafeZone = region === 'town';
      g.combatNearby = enemies.list.some((e) => e.alive && e.spawning <= 0 && (e.aggro || e.boss) && e.pos.distanceToSquared(player.pos) < 64);
      if (input.pressed.zoom || input.pressed.zoomWheel) rig.cycleZoom();
      if (input.pressed.portal) g.startTownPortal();
      if (dt > 0) {
        player.update(dt, g);
        abilities.update(dt, g);
        tether.update(dt, g);
        enemies.update(dt, g);
        loot.update(dt, g);
        g.interactions.update(dt);
        for (let i = g.timers.length - 1; i >= 0; i--) {
          const t = g.timers[i];
          t.t -= dt;
          if (t.t <= 0) { g.timers.splice(i, 1); t.fn(); }
        }
      }
      fogTimer -= realDt;
      if (fogTimer <= 0 && !g.inDungeon) { fogTimer = 0.25; g.fog.reveal(player.pos.x, player.pos.z, 30); }
      saveTimer += realDt;
      if (saveTimer > 20 && !player.dead) { saveTimer = 0; g.save(); }
    }
    fx.update(g.started && !ui.open ? realDt : 0);
    g.vfx.update(g.started && !ui.open ? realDt : 0);
    world.update(realDt, performance.now() / 1000, player.pos);
    rig.update(realDt, player.pos, player.vel, fx);
    loot.updateLabels(g, camera, g.highlightedLoot);
    if (g.started) hud.update(realDt, g);
    const lifeFrac = player.life / player.stats.maxLife;
    renderer.render(realDt, { hurt: g.started && !player.dead && lifeFrac < 0.35 ? (0.35 - lifeFrac) * 1.6 * (0.75 + Math.sin(performance.now() / 180) * 0.25) : 0 });
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
