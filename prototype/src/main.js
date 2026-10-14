import { installSystem, webglAvailable, showNoWebGL } from './ui/system.js';
import * as THREE from 'three';
import { Renderer } from './core/render.js';
import { Settings } from './core/settings.js';
import { Events } from './core/events.js';
import { Input } from './core/input.js';
import { Fx } from './core/fx.js';
import { CameraRig } from './core/camera.js';
import { buildWorld } from './world/world.js';
import { INSTANCES, instanceAt } from './world/instances.js';
import { TOWN, AQRABU, WAYPOINTS } from './world/layout.js';
import { Player } from './entities/player.js';
import { Tether } from './entities/tether.js';
import { Abilities } from './entities/abilities.js';
import { EnemyManager } from './entities/enemies.js';
import { Loot } from './game/loot.js';
import { Interactions } from './game/interact.js';
import { QuestLog } from './game/quests.js';
import { generateItem, itemScore } from './game/items.js';
import { loadSave, writeSave, clearSave, encodeBytes, decodeBytes } from './game/save.js';
import { Hud } from './ui/hud.js';
import { UI } from './ui/ui.js';
import { Fog, FOG_RES } from './ui/mapdraw.js';
import { Story, START } from './game/story.js';
import { Tutorial } from './game/tutorial.js';
import { Audio as GameAudio } from './audio/audio.js';
import { Vfx } from './fx/vfx.js';
import { Reveal } from './game/reveal.js'; // region reveal hook (1/4)

export const VERSION = '0.3.0-alpha';

// ?low or ?quality=medium override the saved graphics preset (slow machines, automated tests).
const settings = new Settings();
const events = new Events();
const canvas = document.getElementById('game');
// Friendly full-screen message instead of a crash when WebGL 2 is missing.
if (!webglAvailable()) { showNoWebGL(); throw new Error('WebGL 2 is unavailable'); }
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
    inDungeon: false, instance: null, inSafeZone: true, combatNearby: false, interactTarget: null, suppressInput: false,
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
      document.getElementById('pause').hidden = true;
      g.timers.length = 0;
      g.interactions.reset();
      for (const c of enemies.camps) if (c.state !== 'dormant') enemies.despawnCamp(c);
      enemies.clearDungeon();
      enemies.clearStray();
      loot.clearAll();
      abilities.reset();
      g.started = true;
      g.tutorial.start();
      if (!save) {
        // New hero: cold open over the flyover at dawn, then the caravan ambush.
        if (!world.tod.locked) world.tod.set('dawn');
        hud.show(false);
        g.started = false;
        ui.playIntro(() => {
          rig.setCinematic(null);
          g.started = true;
          hud.show(true);
          g.story.begin();
          tether.reset(g);
          g.save();
        });
        return;
      }
      rig.setCinematic(null);
      hud.show(true);
      const wp = world.waypoints.find((w) => w.id === player.lastWaypoint) ?? world.waypoints[0];
      if (g.flags.introDone) g.teleport(wp.x, wp.z + 3); else g.teleport(START.x, START.z);
      g.story.resume();
      tether.reset(g);
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
      g.instance = instanceAt(z);
      g.inDungeon = !!g.instance;
      g.inSafeZone = world.regionAt(x, z) === 'town';
      world.colliders.resolve(player.pos, 0.5, g.inDungeon);
      player.pos.y = world.heightAt(player.pos.x, player.pos.z);
      player.vel.set(0, 0, 0);
      if (wasDungeon && !g.inDungeon) { enemies.clearDungeon(); g.interactions.removeExitPortal(); }
      rig.snapTo(player.pos);
      tether.reset(g);
      enemies.updateCamps(g);
    },

    enterDungeon(id = 'ganzir') {
      const inst = INSTANCES[id];
      g.teleport(inst.spots.entry.x, inst.spots.entry.z);
      enemies.populateDungeon(g, inst);
      g.interactions.removeExitPortal();
      g.interactions.spawnBoss(inst);
      if (inst.enterEvent) g.quests.notify({ type: 'enter', id: inst.enterEvent });
      hud.banner(inst.name, 'region', inst.banner);
    },

    leaveDungeon() {
      const back = (g.instance ?? INSTANCES.ganzir).returnTo;
      enemies.clearDungeon();
      g.interactions.removeExitPortal();
      g.teleport(back.x, back.z);
    },

    startTownPortal() {
      if (g.inSafeZone) { hud.notify('You are already in town', 'warn'); return; }
      if (g.inDungeon && enemies.list.some((e) => e.boss && e.aggro && e.alive)) { hud.notify('Neti\'s seal blocks the portal', 'warn'); return; }
      abilities.channel = { t: 0 };
    },

    openTownPortal() {
      const from = player.pos.clone();
      const inst = g.instance;
      if (inst) enemies.clearDungeon();
      g.interactions.createTownPortal(inst ? new THREE.Vector3(inst.returnTo.x, 0, inst.returnTo.z) : from);
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
      if (g.flags.introDone) g.teleport(wp.x, wp.z + 3); else g.teleport(START.x, START.z);
    },

    onEnemyKilled(e) {
      player.gainXp(e.xp, g);
      loot.dropFor(e, g);
      const region = e.camp?.region ?? world.regionAt(e.pos.x, e.pos.z);
      g.quests.notify({ type: 'kill', region, enemy: e.type, named: e.named?.id, boss: e.boss ? 'neti' : undefined });
      g.interactions.onKill(e);
      if (e.boss) {
        hud.banner('Neti has fallen', 'boss', 'The First Gate is open');
        g.interactions.spawnExitPortal();
        g.save();
      } else if (e.dungeon && e.named && g.instance?.guardian?.id === e.named.id) {
        hud.banner(g.instance.slainBanner[0], 'boss', g.instance.slainBanner[1]);
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

    // Where the quest wants you; inside a dungeon, anything outside it points at the way out.
    questMarker() {
      const m = g.questTarget();
      if (!m || !g.instance || instanceAt(m.z) === g.instance) return m;
      const portal = g.interactions.exitPortal?.position;
      return portal ? { x: portal.x, z: portal.z } : { x: g.instance.spots.entry.x, z: g.instance.spots.entry.z + 3 };
    },

    questTarget() {
      const q = g.quests;
      if (q.done) return null;
      if (q.pending) { const n = world.npcs.find((x) => x.id === q.pending.giver); return { x: n.x, z: n.z }; }
      const o = q.active.objective;
      if (o.type === 'kill' && !g.inDungeon) {
        // Point at the nearest camp that still holds the monsters you need.
        let best = null, bd = Infinity;
        for (const c of enemies.camps) {
          if (c.region !== o.region || c.state === 'cleared') continue;
          if (o.enemy && !c.members.includes(o.enemy)) continue;
          const d = Math.hypot(c.x - player.pos.x, c.z - player.pos.z);
          if (d < bd) { bd = d; best = c; }
        }
        if (best) return { x: best.x, z: best.z };
      }
      const m = q.active.marker;
      if (g.questMarkers?.[m]) return g.questMarkers[m];
      if (m === 'ev-ritual') return { x: world.ritual.x, z: world.ritual.z };
      if (m.startsWith('wp-')) { const w = WAYPOINTS.find((x) => x.id === m); return { x: w.x, z: w.z }; }
      if (m === 'named-aqrabu') return { x: AQRABU.x, z: AQRABU.z };
      if (m === 'boss-neti' && g.instance?.id === 'ganzir') return INSTANCES.ganzir.spots.boss;
      if (m === 'cistern-entrance') return g.instance?.id === 'cistern' ? INSTANCES.cistern.spots.boss : INSTANCES.cistern.entrance;
      return INSTANCES.ganzir.entrance;
    },
  };
  g.interactions = new Interactions(g);
  g.vfx = new Vfx(g);
  const ui = new UI(g);
  g.ui = ui;
  // Time of day: ?time= wins for this visit, else the saved setting.
  const applyTime = () => world.tod.lock(settings.timeOverride ?? settings.get('timeOfDay'));
  applyTime();
  settings.onChange((k) => { if (k === 'timeOfDay') applyTime(); });
  g.story = new Story(g);
  g.tutorial = new Tutorial(g);
  g.reveal = new Reveal(g); // region reveal hook (2/4)
  g.audio = new GameAudio(g);
  installSystem(g); // pause on blur, pad-disconnect prompt, UI scale + colour-blind hooks
  scene.userData.living?.bind(g); // living world (thunder events, fx) talks to the game through g
  window.__game = g; // handy for debugging in the console and for automated smoke tests
  window.__itemScore = itemScore;

  function bindQuestEvents() {
    g.quests.onChange((kind, q) => {
      g.events.emit('questUpdate', { kind, quest: q });
      if (kind === 'accepted') hud.banner(`New quest: ${q.title}`, 'quest', q.objective.text);
      if (kind === 'completed') {
        hud.banner(`Quest complete: ${q.title}`, 'quest', `+${q.reward.xp} XP · +${q.reward.gold} gold`);
        player.gold += q.reward.gold;
        player.gainXp(q.reward.xp, g);
        if (q.reward.item) loot.dropItem(generateItem({ ilvl: player.level, rarity: q.reward.item.rarity }), player.pos, g);
        g.save();
      }
    });
  }

  // Title screen: a slow flyover from the cracked First Gate south to Eridu.
  player.init(null);
  g.teleport(TOWN.x, TOWN.z + 4);
  tether.reset(g);
  const path = new THREE.CatmullRomCurve3([[0, -150], [-40, -70], [-70, 0], [-20, 50], [30, 100], [8, 168]].map(([x, z]) => new THREE.Vector3(x, 0, z)));
  rig.setCinematic((t) => {
    const k = 0.5 - Math.cos((t / 90) * Math.PI) * 0.5; // ease back and forth over 90 s
    const p = path.getPointAt(Math.min(0.999, k));
    const ahead = path.getPointAt(Math.min(1, k + 0.04));
    const h = world.heightAt(p.x, p.z);
    const look = new THREE.Vector3(ahead.x, world.heightAt(ahead.x, ahead.z), ahead.z - 6);
    // The flyover opens on the storm brewing over the First Gate, then swings south toward Eridu.
    const w = 1 - Math.min(1, Math.max(0, (t - 3) / 12)) ** 2 * (3 - 2 * Math.min(1, Math.max(0, (t - 3) / 12)));
    look.lerp(new THREE.Vector3(0, 46, -204), w);
    return { pos: new THREE.Vector3(p.x, h + 34 + Math.sin(t * 0.2) * 4, p.z + 26), look };
  });
  document.getElementById('loading').remove();
  ui.showTitle(!!loadSave());

  let fogTimer = 0, saveTimer = 0;
  // One gameplay tick. Hit-stop freezes gameplay for a moment while effects keep running.
  g.simulate = (realDt) => {
    g.bossIntro.tick(realDt); // boss entrances freeze gameplay but advance on this clock (src/fx/bossIntro.js)
    const dt = fx.hitstop > 0 || g.bossIntro.active ? 0 : realDt * fx.timeScale; // timeScale < 1 during kill slow-mo
    g.time += dt;
    const region = world.regionAt(player.pos.x, player.pos.z);
    g.inSafeZone = region === 'town';
    g.combatNearby = enemies.list.some((e) => e.alive && e.spawning <= 0 && (e.aggro || e.boss) && e.pos.distanceToSquared(player.pos) < 64);
    if (input.pressed.zoom || input.pressed.zoomWheel) rig.cycleZoom();
    if (input.pressed.portal) g.startTownPortal();
    if (dt > 0) {
      g.story.update(dt);
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
    g.tutorial.update(realDt);
    fogTimer -= realDt;
    if (fogTimer <= 0 && !g.inDungeon) { fogTimer = 0.25; g.fog.reveal(player.pos.x, player.pos.z, 30); }
    saveTimer += realDt;
    if (saveTimer > 20 && !player.dead) { saveTimer = 0; g.save(); }
  };

  let last = performance.now();
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
    g.audio.update(realDt);

    // g.simDriven: an external harness (e2e bot) calls g.simulate itself.
    if (g.started && !ui.open && !g.simDriven && !g.revealing) g.simulate(realDt); // (3/4) paused during a region reveal
    fx.update(g.started && !ui.open ? realDt : 0);
    g.vfx.update(g.started && !ui.open ? realDt : 0);
    world.update(realDt, performance.now() / 1000, player.pos, renderer);
    g.reveal.update(realDt); // region reveal hook (4/4): after world.update, before the camera
    rig.update(realDt, player.pos, player.vel, fx);
    loot.updateLabels(g, camera, g.highlightedLoot);
    if (g.started) hud.update(realDt, g);
    // Cinematics (boss entrances, region reveals) clear the HUD except the title banner.
    document.body.classList.toggle('cinematic', !!(g.bossIntro?.active || g.revealing));
    const lifeFrac = player.life / player.stats.maxLife;
    renderer.render(realDt, { hurt: g.started && !player.dead && lifeFrac < 0.35 ? (0.35 - lifeFrac) * 1.6 * (0.75 + Math.sin(performance.now() / 180) * 0.25) : 0 });
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
