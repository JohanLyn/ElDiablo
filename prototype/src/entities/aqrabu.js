import * as THREE from 'three';
import { F } from '../fx/atlas.js';

// Aqrabu the Venomed, the champion of the Dune Ruins (quest 3). The camp and the stat
// block live in enemies.js; this file is his one set-piece move.
//
// Phase 2, at half health: he sinks into the sand and cannot be hurt (~2 s). A ground
// tremor rushes toward the hero (dust plume trail), then locks onto the hero's last
// position and a venom ring marks the spot (the ordinary enemy hazard, 0.95 s of warning).
// He erupts from the middle of it, calls two Girtablullu out of the dunes and fights
// on, quicker.
export const AQRABU_BURROW = { sink: 0.45, track: 1.15, total: 2.1, rise: 0.4, ring: 4.4, color: 0x9aff3a, speed: 11 };

const VENOM = 0x9aff3a;
const SAND = 0xcdb487;
const _p = new THREE.Vector3();

export function initAqrabu(e) {
  e.aqrabu = { phase: 1, b: null, sink: 0 };
}

// Per-frame logic before the enemy decides what to do. Returns true while he is
// underground (the caller skips movement and attacks).
export function updateAqrabu(e, dt, g, mgr) {
  const A = e.aqrabu;
  if (!A.b && A.phase === 2 && e.hp > e.maxHp * 0.5 + 1) { A.phase = 1; e.speedMult /= 1.12; } // leashed and healed: the trick is available again
  if (!A.b) {
    if (A.phase === 1 && e.aggro && e.hp > 0 && e.hp <= e.maxHp * 0.5 && !g.player.dead) beginBurrow(e, g, A);
    else return false;
  }
  const B = A.b, C = AQRABU_BURROW;
  B.t += dt;
  const p = g.player.pos;
  e.vel.set(0, 0, 0);
  e.knock.set(0, 0, 0);
  mgr.hideArc(e);

  if (B.t < C.total) {
    A.sink = Math.min(1, B.t / C.sink);
    // The tremor: a point racing under the sand toward the hero, then toward the locked spot.
    if (B.t >= C.sink) {
      let tx, tz, speed;
      if (B.t < C.track) { tx = p.x; tz = p.z; speed = C.speed; } else {
        if (!B.locked) lockOn(e, g, B, mgr);
        tx = B.x; tz = B.z;
        speed = Math.max(C.speed, Math.hypot(tx - B.px, tz - B.pz) / Math.max(0.05, C.total - B.t));
      }
      const dx = tx - B.px, dz = tz - B.pz, d = Math.hypot(dx, dz);
      const step = Math.min(d, speed * dt);
      if (d > 1e-3) { B.px += (dx / d) * step; B.pz += (dz / d) * step; }
      tremor(g, B, dt);
    }
    // The model stays where it sank; it is invisible by now.
    return true;
  }

  // Erupt under the hero's last position.
  if (!B.erupted) {
    B.erupted = true;
    erupt(e, g, B, mgr);
  }
  // Rising out of the ground; still untouchable for the first beat.
  const k = Math.min(1, (B.t - C.total) / C.rise);
  A.sink = 1 - k;
  if (k >= 0.6) e.untouchable = false;
  if (k >= 1) {
    A.b = null; A.sink = 0;
    e.untouchable = false;
    e.setState('chase');
    e.cooldown = 0.6;
    return false;
  }
  return true;
}

function beginBurrow(e, g, A) {
  A.phase = 2;
  e.speedMult *= 1.12; // fights on, quicker
  A.b = { t: 0, px: e.pos.x, pz: e.pos.z, x: e.pos.x, z: e.pos.z, locked: false, erupted: false, puff: 0 };
  e.untouchable = true;
  e.setState('idle');
  g.events.emit('aqrabuBurrow', { enemy: e, pos: e.pos });
  g.hud.notify('Aqrabu burrows into the sand!', 'warn');
  const v = g.vfx, gy = v.ground(e.pos.x, e.pos.z);
  v.puffs(e.pos.x, gy + 0.3, e.pos.z, 22, 1.6, 4, 2.5, SAND, 1.2, 3.6, 1.2, 0.6);
  v.ringFlat(e.pos.x, 0.12, e.pos.z, 0.6, 9, 0.6, 0xe8d4a0, 0.9, 1.4);
  v.motes(e.pos.x, gy + 0.3, e.pos.z, 14, 1.2, 3, 5, 0xe8d4a0, 0x8a6a3a, 0.3, 0.8, 12, F.SHARD);
  g.fx.shake(0.3);
  g.fx.rumble(0.5, 0.5, 400);
  _p.set(e.pos.x, gy + 0.5, e.pos.z);
  g.renderer.shockwave(_p, 0.02, 9, 0.5);
}

// Freeze the spot the hero stands on now and mark it with the venom ring.
function lockOn(e, g, B, mgr) {
  const p = g.player.pos, C = AQRABU_BURROW;
  B.locked = true;
  B.x = p.x; B.z = p.z;
  mgr.hazard({ x: B.x, z: B.z, r: C.ring, delay: C.total - C.track, dmg: e.dmg * 1.1, color: C.color, level: e.level, onHit: () => mgr.onEnemyHit(e, g) });
  g.events.emit('aqrabuTelegraph', { x: B.x, z: B.z, r: C.ring });
  g.fx.rumble(0.25, 0.4, 300);
}

function tremor(g, B, dt) {
  B.puff -= dt;
  if (B.puff > 0) return;
  B.puff = 0.055;
  const v = g.vfx, gy = v.ground(B.px, B.pz);
  v.puffs(B.px, gy + 0.2, B.pz, 3, 0.5, 1.6, 1.4, SAND, 0.7, 1.9, 0.9, 0.55);
  v.motes(B.px, gy + 0.2, B.pz, 2, 0.4, 1.2, 2.5, 0xe8d4a0, 0x8a6a3a, 0.2, 0.55, 12, F.SHARD);
  v.decal(B.px, B.pz, 1.8, F.CRACK, 0x1a1208, 0.6, 1.1, false);
  g.fx.shake(0.012);
}

function erupt(e, g, B, mgr) {
  const C = AQRABU_BURROW;
  // Surface beside the ring's centre if a pillar stands there.
  e.pos.x = B.x; e.pos.z = B.z;
  g.world.colliders.resolve(e.pos, e.radius + 0.4, false);
  e.pos.y = g.world.heightAt(e.pos.x, e.pos.z);
  e.facing = Math.atan2(g.player.pos.x - e.pos.x, g.player.pos.z - e.pos.z);
  const v = g.vfx, gy = v.ground(e.pos.x, e.pos.z);
  v.ringFlat(e.pos.x, 0.12, e.pos.z, 1, C.ring * 2.6, 0.7, VENOM, 1, 1.7);
  v.pillar(e.pos.x, gy, e.pos.z, 0x8fe030, 0xeaffb0, 1.6, 9, 0.7, 0.7);
  v.puffs(e.pos.x, gy + 0.3, e.pos.z, 26, 2.2, 6, 3, SAND, 1.4, 4, 1.2, 0.6);
  v.motes(e.pos.x, gy + 0.3, e.pos.z, 20, 1.8, 5, 8, 0xeaffb0, 0x58a020, 0.3, 0.9, 10, F.DOT);
  v.flashLight(e.pos.x, gy + 2, e.pos.z, 0x9aff3a, 30, 0.4);
  g.fx.shake(0.55);
  g.fx.fovPunch?.(22);
  g.fx.rumble(0.8, 0.6, 450);
  _p.set(e.pos.x, gy + 0.8, e.pos.z);
  g.renderer.shockwave(_p, 0.03, 12, 0.6);
  g.events.emit('aqrabuEmerge', { enemy: e, pos: e.pos });
  g.hud.notify('Aqrabu erupts, calling his brood!', 'warn');
  // Two Girtablullu claw out of the dunes either side of him.
  for (let i = 0; i < 2; i++) {
    const a = e.facing + Math.PI / 2 + i * Math.PI + (Math.random() - 0.5) * 0.6;
    mgr.spawnAdd(e.camp, 'scorpion', e.pos.x + Math.sin(a) * 4.2, e.pos.z + Math.cos(a) * 4.2, e.level - 1, g);
  }
}

// After the enemy's own transform update: sink under / rise out of the sand (reuses the spawn dissolve).
export function drawAqrabu(e, g) {
  const A = e.aqrabu;
  if (A.sink <= 0) {
    if (A.drawn) { A.drawn = false; e.group.userData.mat.userData.u.uDissolve.value = 0; if (e.group.userData.aura) e.group.userData.aura.holder.visible = true; }
    return;
  }
  A.drawn = true;
  const ground = g.world.heightAt(e.pos.x, e.pos.z);
  const u = e.group.userData.mat.userData.u;
  e.pos.y = ground - 1.3 * A.sink;
  u.uDissolve.value = Math.min(1, A.sink * 1.05);
  u.uBase.value = ground - 0.2;
  if (e.bar) e.bar.visible = false;
  if (e.group.userData.outline) e.group.userData.outline.visible = false;
  if (e.group.userData.aura) e.group.userData.aura.holder.visible = A.sink < 0.3;
}
