import * as THREE from 'three';
import { F } from './atlas.js';
import { TAU, rr, smooth, clamp01 } from './shared.js';
import { angleDelta, damp } from '../core/util.js';
import { driveEnemy } from '../entities/enemyModels.js';

// Boss entrances. The first time the hero comes near a guardian (and again on
// every fresh run of its dungeon, since dungeons rebuild on entry) gameplay
// freezes for about three seconds while the camera pulls to the guardian, a
// title card appears, and the guardian makes its entrance: Neti stamps the
// floor and roars; the Drowned Voice rises out of the singing pool.
//
// The intro is advanced from g.simulate() (main.js), so it runs at the same
// pace under the real frame loop and under a test harness that steps the
// simulation by hand, and any input skips it. It never needs a render frame.

const NETI = { kind: 'neti', name: 'NETI', sub: 'Keeper of the First Gate', dur: 3.3, trigger: 22, dist: 15, height: 4.2, look: 3.0, dist2: 11, height2: 3.4, look2: 3.5 };
const VOICE = { kind: 'voice', name: 'The Drowned Voice', sub: 'Singer of the Cistern of Enki', dur: 3.8, trigger: 18, dist: 12, height: 3.4, look: 2.0, dist2: 9, height2: 2.6, look2: 2.4 };

const _v = new THREE.Vector3();

export class BossIntro {
  constructor(g, v) {
    this.g = g;
    this.v = v;
    this.active = false;
    this.e = null;
    this.cfg = null;
    this.t = 0;
    this.p0 = new THREE.Vector3(); this.l0 = new THREE.Vector3();
    this.p1 = new THREE.Vector3(); this.l1 = new THREE.Vector3();
    this.p2 = new THREE.Vector3(); this.l2 = new THREE.Vector3();
    this.shot = { pos: new THREE.Vector3(), look: new THREE.Vector3() };
    this.fn = () => this.frameShot();
    this.bars = null;
    this.stage = 0;
    this.roar = 0;
    this.skipped = false;
  }

  // Called once per g.simulate(realDt). Cheap when idle.
  tick(dt) {
    if (!this.active) {
      this.scan();
      if (!this.active) return;
    }
    this.advance(dt);
  }

  scan() {
    const g = this.g;
    if (!g.inDungeon || !g.instance || g.player.dead || !g.started) return;
    const list = g.enemies.list, p = g.player.pos;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e.introDone || !e.alive || !e.dungeon) continue;
      const neti = e.boss, voice = !neti && !!e.named && e.named.id === g.instance.guardian?.id;
      if (!neti && !voice) continue;
      if (neti && e.spawning > 0) continue;
      const cfg = neti ? NETI : VOICE;
      if (Math.hypot(e.pos.x - p.x, e.pos.z - p.z) < cfg.trigger) { this.begin(e, cfg); return; }
    }
  }

  begin(e, cfg) {
    const g = this.g, v = this.v;
    this.active = true; this.e = e; this.cfg = cfg; this.t = 0; this.stage = 0; this.roar = 0; this.skipped = false;
    e.introDone = true;
    const bx = e.pos.x, bz = e.pos.z, by = v.ground(bx, bz);
    e.introGround = by;
    const p = g.player.pos;
    let dx = p.x - bx, dz = p.z - bz;
    const dl = Math.hypot(dx, dz) || 1;
    dx /= dl; dz /= dl;
    // Camera: start where the gameplay camera is, swing to a low shot on the guardian, push in while orbiting a little, return.
    this.p0.copy(g.camera.position);
    this.l0.set(g.rig.target.x, g.rig.target.y + 0.6, g.rig.target.z);
    const a = 0.26, ca = Math.cos(a), sa = Math.sin(a);
    this.p1.set(bx + dx * cfg.dist, by + cfg.height, bz + dz * cfg.dist);
    this.l1.set(bx, by + cfg.look, bz);
    this.p2.set(bx + (dx * ca - dz * sa) * cfg.dist2, by + cfg.height2, bz + (dx * sa + dz * ca) * cfg.dist2);
    this.l2.set(bx, by + cfg.look2, bz);
    g.rig.setCinematic(this.fn);
    this.showBars(true);
    if (cfg.kind === 'voice') {
      e.group.userData.rig.setShadows(true);
      e.spawnTotal = 1; e.spawning = 1;
      e.group.visible = true;
    }
    g.events.emit('bossIntro', { stage: 'start', boss: e, kind: cfg.kind, name: cfg.name, pos: e.pos });
  }

  skip() {
    if (this.skipped) return;
    this.skipped = true;
    // Fast-forward to the closing pull-back so the camera eases home instead of cutting.
    this.t = Math.max(this.t, this.cfg.dur - 0.45);
  }

  advance(dt) {
    const g = this.g, v = this.v, e = this.e, cfg = this.cfg;
    if (!e.alive || !g.inDungeon || g.player.dead || (g.instance && !g.enemies.list.includes(e))) { this.end(true); return; }
    if (!this.skipped && this.t > 0.4) {
      const inp = g.input;
      let any = false;
      for (const k in inp.pressed) if (inp.pressed[k]) { any = true; break; }
      if (any || inp.move.mag > 0.5) this.skip();
    }
    this.t += dt;
    const t = this.t, bx = e.pos.x, bz = e.pos.z, gy = e.introGround;

    // The guardian turns to face the hero.
    const p = g.player.pos;
    const want = Math.atan2(p.x - bx, p.z - bz);
    e.facing += angleDelta(e.facing, want) * damp(4, dt);
    e.group.rotation.y = e.facing;

    if (cfg.kind === 'neti') this.playNeti(t, dt, bx, bz, gy);
    else this.playVoice(t, dt, bx, bz, gy);

    // Keep the guardian animating (the simulation is frozen), then layer the roar pose on top.
    driveEnemy(e, dt, g, 0);
    if (this.roar > 0.001) this.roarPose(e, this.roar);

    if (t >= cfg.dur) this.end(false);
  }

  roarPose(e, k) {
    const B = e.group.userData.rig?.b;
    if (!B) return;
    const r = B.spine?.rotation;
    if (r) r.x -= 0.4 * k;
    if (B.chest) B.chest.rotation.x -= 0.3 * k;
    if (B.head) B.head.rotation.x -= 0.5 * k;
    if (B.shL) { B.shL.rotation.z += 0.8 * k; B.shL.rotation.x -= 0.5 * k; }
    if (B.shR) { B.shR.rotation.z -= 0.8 * k; B.shR.rotation.x -= 0.5 * k; }
    if (B.elL) B.elL.rotation.x -= 0.4 * k;
    if (B.elR) B.elR.rotation.x -= 0.4 * k;
  }

  // ------------------------------------------------------------------ Neti
  playNeti(t, dt, bx, bz, gy) {
    const g = this.g, v = this.v;
    if (this.stage === 0 && t > 0.3) {
      this.stage = 1;
      // The stair cracks open around the gatekeeper.
      v.decal(bx, bz, 15, F.CRACK, 0xb48aff, 0.95, 1.6, true, 1.7);
      v.decal(bx, bz, 15, F.CRACK, 0x0c0a14, 0.9, 9, false);
      v.ringFlat(bx, 0.1, bz, 1, 14, 0.9, 0xb48aff, 0.9, 1.6);
      g.fx.rumble(0.5, 0.5, 700);
      g.fx.shake(0.35);
    }
    if (t > 0.3 && t < 2.5) {
      // Dust and loosened stone shaken from the ceiling and floor.
      if (Math.random() < dt * 22) {
        const a = Math.random() * TAU, r = rr(1.5, 6);
        v.puffs(bx + Math.cos(a) * r, gy + 0.2, bz + Math.sin(a) * r, 1, 0.3, 1.4, 1.1, 0xb0a08a, 1.0, 3.0, 1.4, 0.4);
      }
      if (Math.random() < dt * 9) {
        const a = Math.random() * TAU, r = rr(0.5, 7);
        v.motes(bx + Math.cos(a) * r, gy + 0.4, bz + Math.sin(a) * r, 2, 0.2, 1.4, 4, 0x9a8f80, 0x4a4238, 0.3, 0.8, 16, F.SHARD, 0.9);
      }
      g.fx.shake(0.012);
    }
    if (this.stage === 1 && t > 1.0) {
      this.stage = 2;
      g.hud.banner(this.cfg.name, 'boss', this.cfg.sub);
    }
    if (this.stage === 2 && t > 1.2) {
      this.stage = 3;
      this.roarBurst(bx, gy, bz, 0xb48aff);
      g.events.emit('bossIntro', { stage: 'roar', boss: this.e, kind: 'neti', name: this.cfg.name, pos: this.e.pos });
    }
    // Rear back, hold, settle.
    this.roar = smooth(clamp01((t - 1.0) / 0.3)) * (1 - smooth(clamp01((t - 2.1) / 0.8)));
  }

  roarBurst(bx, gy, bz, hex) {
    const g = this.g, v = this.v;
    g.fx.shake(0.75);
    g.fx.fovPunch(30);
    g.fx.rumble(0.9, 0.7, 500);
    g.renderer.pulse(0xc9b0ff, 0.28);
    v.combat.waveT[2] = -9;
    v.combat.shock(bx, gy + 2.5, bz, 0.05, 24, 1.0, 2);
    v.ringFlat(bx, 0.12, bz, 2, 24, 1.0, hex, 1, 1.7);
    v.ringFlat(bx, 0.14, bz, 1, 16, 0.7, 0xffffff, 0.8, 1.9);
    v.pillar(bx, gy, bz, 0x9a6bff, 0xe0d0ff, 2.2, 14, 1.3, 0.8);
    v.wisps(bx, gy, bz, 18, 3.5, 0xd9b0ff, 0x6a2bd8, 1.6, 1.6);
    v.puffs(bx, gy + 0.3, bz, 24, 1.0, 8, 1.2, 0xb0a08a, 1.2, 3.6, 1.3, 0.45);
    v.flashLight(bx, gy + 3, bz, 0xb48aff, 45, 0.6);
  }

  // ------------------------------------------------------------ Drowned Voice
  playVoice(t, dt, bx, bz, gy) {
    const g = this.g, v = this.v, e = this.e;
    const k = smooth(clamp01((t - 0.1) / 1.7));
    const u = e.group.userData.mat.userData.u;
    e.pos.y = gy - 3.2 * (1 - k) + 0.1;
    e.spawning = Math.max(0.0001, 1 - k);
    u.uDissolve.value = 1 - smooth(clamp01((t - 0.15) / 1.5));
    u.uBase.value = gy - 3.4;
    if (this.stage === 0 && t > 0.05) {
      this.stage = 1;
      g.fx.rumble(0.4, 0.5, 600);
      v.flashLight(bx, gy + 1.5, bz, 0x5fe0ff, 30, 1.2);
      v.ringFlat(bx, 0.2, bz, 0.5, 9, 0.9, 0x7fe8ff, 0.9, 1.6, F.WAVE, 2);
    }
    if (t > 0.1 && t < 1.9 && Math.random() < dt * 40) {
      // Cyan spray thrown up and out of the pool.
      const n = 2;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * TAU, r = rr(0.2, 2.2);
        v.motes(bx + Math.cos(a) * r, gy + 0.2, bz + Math.sin(a) * r, 1, 0.1, 1.6, rr(5, 9), 0xe8ffff, 0x2aa8d8, 0.34, 1.1, 12, F.DOT, 1.7);
      }
      v.puffs(bx + rr(-1.5, 1.5), gy + 0.3, bz + rr(-1.5, 1.5), 1, 0.3, 2.2, 2, 0xcff6ff, 0.9, 2.6, 1.1, 0.4);
    }
    if (this.stage === 1 && t > 0.7) {
      this.stage = 2;
      v.ringFlat(bx, 0.2, bz, 1, 14, 1.0, 0x5fe0ff, 0.9, 1.6, F.WAVE, 2);
      v.pillar(bx, gy, bz, 0x4fd8ff, 0xe8ffff, 1.6, 10, 1.4, 0.7);
      v.wisps(bx, gy, bz, 14, 2.4, 0xc8f8ff, 0x2a90d0, 1.5, 1.6);
    }
    if (this.stage === 2 && t > 1.2) {
      this.stage = 3;
      g.hud.banner(this.cfg.name, 'boss', this.cfg.sub);
    }
    if (this.stage === 3 && t > 1.75) {
      this.stage = 4;
      this.roarBurst(bx, gy, bz, 0x5fe0ff);
      g.events.emit('bossIntro', { stage: 'roar', boss: e, kind: 'voice', name: this.cfg.name, pos: e.pos });
    }
    this.roar = smooth(clamp01((t - 1.65) / 0.3)) * (1 - smooth(clamp01((t - 2.6) / 0.8))) * 0.9;
  }

  // ------------------------------------------------------------------ camera
  frameShot() {
    const t = this.t, cfg = this.cfg, S = this.shot;
    const tail = 0.8, mid = cfg.dur - tail;
    if (t < 0.9) {
      const k = smooth(t / 0.9);
      S.pos.lerpVectors(this.p0, this.p1, k); S.look.lerpVectors(this.l0, this.l1, k);
    } else if (t < mid) {
      const k = smooth((t - 0.9) / (mid - 0.9));
      S.pos.lerpVectors(this.p1, this.p2, k); S.look.lerpVectors(this.l1, this.l2, k);
      S.pos.add(this.g.fx.shakeOffset(_v));
    } else {
      const k = smooth(Math.min(1, (t - mid) / tail));
      S.pos.lerpVectors(this.p2, this.p0, k); S.look.lerpVectors(this.l2, this.l0, k);
    }
    return S;
  }

  end(abort) {
    const g = this.g, e = this.e, cfg = this.cfg;
    this.active = false;
    this.roar = 0;
    g.rig.setCinematic(null);
    this.showBars(false);
    if (e) {
      if (cfg?.kind === 'voice') {
        const u = e.group.userData.mat.userData.u;
        u.uDissolve.value = 0;
        e.pos.y = e.introGround ?? e.pos.y;
        e.spawning = 0.0001;
      }
      e.group.rotation.y = e.facing;
      if (!abort && cfg.kind === 'voice') g.enemies.alertPack(e); // the fight starts the moment the song ends
      if (!abort) g.events.emit('bossIntro', { stage: 'end', boss: e, kind: cfg.kind, name: cfg.name, pos: e.pos });
    }
    this.e = null;
  }

  showBars(on) {
    if (!this.bars) {
      const mk = (side) => {
        const d = document.createElement('div');
        d.style.cssText = `position:fixed;left:0;right:0;${side}:0;height:0;background:var(--bg,#120c10);z-index:30;pointer-events:none;transition:height .55s cubic-bezier(.2,.7,.2,1);border-${side === 'top' ? 'bottom' : 'top'}:1px solid var(--edge-soft,rgba(214,167,64,.28))`;
        document.body.appendChild(d);
        return d;
      };
      this.bars = [mk('top'), mk('bottom')];
    }
    for (const b of this.bars) b.style.height = on ? '10.5vh' : '0';
  }
}
