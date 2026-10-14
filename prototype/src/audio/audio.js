// GameAudio: wires gameplay events to synthesised sounds, runs the adaptive score,
// and owns the AudioContext (created on the first user gesture). Everything is
// generated at runtime with the Web Audio API; there are no audio files.
import { Engine } from './engine.js';
import { Synth } from './synth.js';
import { SFX } from './sfx.js';
import { Music, PROFILES } from './music.js';
import { TetherHum } from './hum.js';
import { VoiceLimiter, hazardKind, musicTargets, combatIntensity, heartRate, MENU_MODES, clamp } from './theory.js';

// Max simultaneous voices per sound type (oldest is stolen first)
export const VOICE_LIMITS = {
  swing: 3, hit: 6, crit: 3, evade: 2, potion: 1, footstep: 4, hurt: 2, heart: 2, death: 1, javelin: 2, javelinHit: 3,
  tether: 4, snap: 2, lightning: 3, stormCast: 1, leap: 2, boom: 2, aegis: 1, pyre: 1, pyrePulse: 2, ui: 3,
  windup: 4, attack: 4, projectile: 3, hazard: 4, boss: 1, coin: 4, loot: 3, pickup: 3, stinger: 2, die: 4, chest: 2, portal: 1,
  gidimRise: 2, gidimDeath: 3, gidimRecoil: 2, // Night of the Gidim
};

// Sound types dropped first when many voices are already playing
const LOW_PRIORITY = new Set(['footstep', 'tether', 'coin', 'pickup', 'pyrePulse', 'projectile']);

const HIT_SOUND = { gallu: 'hitDemon', utukku: 'hitGhost', lilitu: 'hitFlesh', scorpion: 'hitChitin', asag: 'hitStone', neti: 'hitBoss' };
const SURFACE = { town: 'stone', sunfields: 'dirt', marsh: 'mud', ruins: 'sand', ashen: 'dust', dungeon: 'stone' };

export class Audio {
  constructor(g) {
    this.g = g;
    this.ctx = null;
    this.eng = null;
    this.synth = null;
    this.music = null;
    this.hum = null;
    this.limiter = new VoiceLimiter(VOICE_LIMITS, 4, 32);
    this.unlocked = false;
    this.failed = false;
    this.lastHit = new WeakMap();
    this.prevUiMode = null;
    this.prevBossAggro = false;
    this.nextBeat = 0;
    this.startedAt = -10;
    this.wasStarted = false;
    this.time = 0;
    this.counts = {};
    this.errors = 0;
    this.bind();
    const unlock = () => this.unlock();
    // iOS only unlocks audio from inside touchend / click, so listen for those too
    for (const ev of ['keydown', 'mousedown', 'pointerdown', 'touchstart', 'touchend', 'click']) window.addEventListener(ev, unlock, { passive: true });
    g.settings.onChange(() => this.applyVolumes());
    document.addEventListener('visibilitychange', () => this.onVisibility());
  }

  // ---- context ---------------------------------------------------------------------------------
  unlock() {
    if (this.failed) return;
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) { this.failed = true; return; }
        this.ctx = new AC({ latencyHint: 'interactive' });
        this.init();
      }
      if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
      this.unlocked = true;
    } catch (err) {
      this.failed = true;
      console.warn('[audio] disabled:', err?.message ?? err);
    }
  }

  init() {
    this.eng = new Engine(this.ctx);
    this.synth = new Synth(this.eng);
    this.music = new Music(this.eng, this.synth);
    this.hum = new TetherHum(this.eng);
    this.applyVolumes();
    this.music.snap({ profile: 'title', combat: 0, boss: 0, duckDb: 0, lowpass: 20000 });
    this.music.start();
  }

  get live() { return !!this.eng && this.ctx.state === 'running'; }

  applyVolumes() {
    if (!this.eng) return;
    const s = this.g.settings;
    this.eng.setVolumes({ master: s.get('master'), music: s.get('music'), sfx: s.get('sfx') });
  }

  onVisibility() {
    if (!this.ctx) return;
    const hidden = document.hidden;
    if (this.music) this.music.hidden = hidden;
    try { if (hidden) this.ctx.suspend(); else if (this.unlocked) this.ctx.resume(); } catch { /* ignore */ }
  }

  // ---- playing sounds -----------------------------------------------------------------------------
  play(name, o = {}) {
    if (!this.live) return null;
    const def = SFX[name];
    if (!def) return null;
    try {
      const eng = this.eng, S = this.synth;
      const now = eng.now;
      // Under heavy load drop the least important chatter first (steps, tether ticks, pickups...).
      if (LOW_PRIORITY.has(def.type) && this.limiter.voices.length >= 20) return null;
      this.counts[name] = (this.counts[name] ?? 0) + 1;
      const vs = this.limiter.acquire(def.type, now, def.dur, def.gap);
      if (!vs) return null;
      const v = eng.voice({ pos: o.pos ?? null, bus: def.bus ?? 'sfx', send: (def.send ?? 0.2) * (o.send ?? 1), gain: (def.gain ?? 1) * (o.gain ?? 1) });
      if (!v) { vs.end = 0; return null; } // out of earshot: free the slot immediately
      vs.kill = () => eng.killVoice(v);
      eng.retire(v, def.dur);
      const pv = 1 + (Math.random() * 2 - 1) * (def.vary ?? 0.07);
      const fv = 1 + (Math.random() * 2 - 1) * 0.18;
      S.begin(now + 0.004, pv, fv);
      def.fn(S, v.input, o);
      return v;
    } catch (err) {
      if (this.errors++ < 5) console.warn(`[audio] ${name} failed:`, err?.message ?? err);
      return null;
    }
  }

  // ---- event wiring ----------------------------------------------------------------------------------
  bind() {
    const ev = this.g.events;
    const on = (name, fn) => ev.on(name, (p) => { try { fn(p ?? {}); } catch (err) { if (this.errors++ < 5) console.warn(`[audio] handler ${name}:`, err?.message ?? err); } });
    const g = this.g;

    // hero
    on('strikeSwing', (p) => this.play(`swing${clamp((p.combo ?? 0) + 1, 1, 3)}`, { pos: p.pos }));
    on('hit', (p) => {
      const e = p.enemy;
      if (!e) return;
      const now = performance.now() / 1000;
      if (now - (this.lastHit.get(e) ?? -1) < 0.08) return; // damage-over-time ticks and tether spam
      this.lastHit.set(e, now);
      const frac = e.maxHp ? p.amount / e.maxHp : 0.1;
      const vel = clamp(0.6 + frac * 3, 0.55, 1.15) * (frac < 0.03 ? 0.65 : 1);
      this.play(e.boss ? 'hitBoss' : (HIT_SOUND[e.type] ?? 'hitFlesh'), { pos: p.pos ?? e.pos, vel });
      if (p.crit) this.play('crit', { pos: p.pos ?? e.pos, vel });
    });
    on('evade', (p) => this.play('evade', { pos: p.pos }));
    on('potion', () => this.play('potion'));
    on('footstep', (p) => {
      const who = p.who;
      const mine = who === undefined || who === 'player' || who === g.player;
      const region = g.inDungeon ? 'dungeon' : g.world.regionAt(p.pos?.x ?? g.player.pos.x, p.pos?.z ?? g.player.pos.z);
      this.play('footstep', { pos: mine ? null : p.pos, heavy: !!p.heavy, surface: SURFACE[region] ?? 'dirt', gain: mine ? 0.55 : 1 });
    });
    on('playerHurt', (p) => this.play('hurt', { vel: clamp((p.amount / g.player.stats.maxLife) * 4 + 0.55, 0.55, 1.2) }));
    on('playerDeath', () => this.play('playerDeath'));

    // skills
    on('skillCast', (p) => { if (p.id === 'pyre') this.play('pyreCast'); else if (p.id === 'storm') this.play('stormCast'); });
    on('javelinThrow', (p) => this.play('javelinThrow', { pos: p.pos }));
    on('javelinHit', (p) => this.play('javelinHit', { pos: p.pos }));
    on('tetherHit', (p) => this.play(`tetherHit_${p.aspect ?? 'lapis'}`, { pos: p.pos }));
    on('aspectChange', (p) => this.play('aspectChange', { aspect: p.aspect }));
    on('snap', (p) => this.play('snap', { pos: p.a ?? g.player.pos, aspect: p.aspect }));
    on('lightning', (p) => this.play('lightning', { pos: p.pos }));
    on('leapStart', (p) => this.play('leapStart', { pos: p.pos }));
    on('leapLand', (p) => this.play('leapLand', { pos: p.pos }));
    on('aegis', () => this.play('aegis'));
    on('pyrePulse', (p) => this.play('pyrePulse', { pos: p.pos }));

    // enemies
    on('enemyWindup', (p) => { const e = p.enemy; if (e) this.play('windup', { pos: e.pos, etype: e.type }); });
    on('enemyAttack', (p) => { const e = p.enemy; if (e) this.play('attack', { pos: e.pos, etype: e.type }); });
    on('enemyProjectile', (p) => this.play('projectile', { pos: p.pos }));
    on('hazardBlast', (p) => this.play(`blast_${hazardKind(p.color ?? 0xff2a2a)}`, { pos: { x: p.x, z: p.z } }));
    on('kill', (p) => {
      const e = p.enemy;
      if (!e || e.gidim) return; // gidim break with their own sound (gidimDeath)
      const name = `die_${e.type}`;
      this.play(SFX[name] ? name : 'die_gallu', { pos: p.pos ?? e.pos, elite: !!e.elite });
    });
    // Night of the Gidim
    on('gidimRise', (p) => this.play('gidimRise', { pos: p.pos }));
    on('gidimDeath', (p) => this.play('gidimDeath', { pos: p.pos }));
    on('gidimRecoil', (p) => this.play('gidimRecoil', { pos: p.pos }));
    on('bossPhase', () => { this.play('netiPhase'); this.music?.stinger(); });
    // Boss entrance (src/fx/bossIntro.js): the roar lands with the camera push; the aggro roar is skipped afterwards.
    on('bossIntro', (p) => { if (p.stage === 'roar') { this.play(p.kind === 'neti' ? 'netiRoar' : 'netiPhase', { pos: p.pos }); this.music?.stinger(); } });

    // loot and progression
    on('lootDrop', (p) => {
      const r = p.item?.rarity ?? 'common';
      this.play({ legendary: 'lootLegendary', rare: 'lootRare', magic: 'lootMagic' }[r] ?? 'lootCommon', { pos: p.pos });
      if (r === 'legendary') this.music?.stinger();
    });
    on('pickup', (p) => {
      if (p.kind === 'gold') {
        const a = p.amount ?? 5;
        this.play('coin', { pos: p.pos, n: clamp(1 + Math.floor(Math.log2(1 + a / 12)), 1, 4), pitch: clamp(1.15 - Math.log10(1 + a) * 0.12, 0.8, 1.15) });
      } else if (p.kind === 'item') this.play('pickup', { rarity: p.rarity });
      else this.play('orb', { pos: p.pos });
    });
    on('levelUp', () => { this.play('levelUp'); this.music?.stinger(); });
    on('questUpdate', (p) => {
      if (p.kind === 'completed') { this.play('questComplete'); this.music?.stinger(); } else if (p.kind === 'accepted') this.play('questAccept');
      else if (p.kind === 'progress') this.play('questProgress');
    });
    on('regionEnter', (p) => {
      if (!g.started || this.time - this.startedAt < 3) return;
      const P = PROFILES[p.id];
      if (P) this.play('region', { midi: P.root + 12 });
    });
    on('waypoint', () => this.play('waypoint'));
    on('shrine', (p) => this.play('shrine', { skind: p.kind }));
    on('chestOpen', (p) => this.play('chestOpen', { pos: p.pos }));
    on('portal', () => this.play('portal'));

    // UI
    on('uiOpen', () => this.play('uiOpen'));
    on('uiMove', () => this.play('uiMove'));
    on('uiConfirm', () => this.play('uiConfirm'));
    on('uiBack', () => this.play('uiBack'));
    on('denied', () => this.play('denied'));
  }

  // ---- per-frame --------------------------------------------------------------------------------------
  update() {
    const g = this.g;
    // Audio runs on real elapsed time: the game clamps its own dt at 50 ms, which would make
    // fades and the heartbeat crawl on a slow machine.
    const nowMs = performance.now();
    const dt = Math.min(0.25, Math.max(0, (nowMs - (this.lastMs ?? nowMs)) / 1000));
    this.lastMs = nowMs;
    this.time += dt;
    // Unlock on a gamepad press too (keyboard/mouse are handled by DOM listeners).
    if (!this.unlocked || (this.ctx && this.ctx.state !== 'running' && !document.hidden)) {
      const p = g.input?.pressed;
      if (p && g.input.device === 'pad') for (const k in p) if (p[k]) { this.unlock(); break; }
    }
    if (!this.live) return;
    try { this.frame(dt); } catch (err) { if (this.errors++ < 5) console.warn('[audio] frame:', err?.message ?? err); }
  }

  frame(dt) {
    const g = this.g, eng = this.eng;
    const pl = g.player;
    // listener = the hero; "right" comes from the camera orientation
    const m = g.camera.matrixWorld.elements;
    eng.setListener(pl.pos.x, pl.pos.z, m[0], m[2]);
    eng.pump();

    if (g.started && !this.wasStarted) this.startedAt = this.time;
    this.wasStarted = g.started;

    // music state
    let bossAggro = false, engaged = 0, elite = false;
    if (g.started) {
      for (const e of g.enemies.list) {
        if (!e.alive) continue;
        if (e.boss && e.aggro) bossAggro = true;
        if ((e.aggro || e.boss) && e.spawning <= 0) {
          const dx = e.pos.x - pl.pos.x, dz = e.pos.z - pl.pos.z;
          if (dx * dx + dz * dz < 196) { engaged++; if (e.elite || e.named) elite = true; }
        }
      }
    }
    const uiMode = g.ui?.mode ?? null;
    const t = musicTargets({
      started: g.started, region: g.world.regionAt(pl.pos.x, pl.pos.z), inDungeon: g.inDungeon, bossAggro, combatNearby: g.combatNearby,
      intensity: combatIntensity(engaged, elite), uiMode, dead: pl.dead,
    });
    this.music.setTargets(t);
    this.music.update(dt);

    // boss notices you: roar on the aggro edge
    if (bossAggro && !this.prevBossAggro) {
      const boss = g.enemies.list.find((e) => e.boss && e.alive);
      if (!boss?.introDone) { this.play('netiRoar', { pos: boss?.pos }); this.music.stinger(); }
    }
    this.prevBossAggro = bossAggro;

    // menu closed -> reverse page whoosh
    if (this.prevUiMode && MENU_MODES.has(this.prevUiMode) && uiMode === null) this.play('uiOpen', { close: true });
    this.prevUiMode = uiMode;

    // tether hum
    const th = g.tether;
    let drive = 0;
    if (g.started && !pl.dead && !uiMode && th.mode !== 'rest' && Math.hypot(th.B.x - th.A.x, th.B.z - th.A.z) > 1.2) {
      drive = th.mode === 'auto' ? 0.45 : 0.3 + 0.7 * clamp(th.sweep, 0, 1);
    }
    this.hum.update(dt, drive, th.sweep, g.tether.aspect(g).id);

    // low-life heartbeat
    const frac = pl.life / pl.stats.maxLife;
    if (g.started && !pl.dead && !uiMode && frac < 0.3) {
      this.nextBeat -= dt;
      if (this.nextBeat <= 0) {
        this.play('heartbeat', { vel: 0.55 + (0.3 - frac) / 0.3 * 0.5 });
        this.nextBeat = 1 / heartRate(frac);
      }
    } else this.nextBeat = 0.2;
  }

  // Debug / measurement
  stats() {
    return { voices: this.limiter.voices.length, pendingCleanups: this.eng?.cleanups.length, stolen: this.limiter.stolen, rejected: this.limiter.rejected, musicNotes: this.music?.stats.notes ?? 0, state: this.ctx?.state, counts: this.counts };
  }
}

export { Audio as GameAudio };
