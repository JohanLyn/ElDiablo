// Generative adaptive score. A look-ahead scheduler (setInterval ~25 ms, notes placed
// ~120 ms ahead on the AudioContext clock) plays per-region profiles built from modal
// scales: a drone + wind bed, choir pads, Karplus-Strong lyre, a reed lead, bells and
// frame drums. A combat layer (drums + ostinato) and a boss layer (driving drums, horns,
// choir) crossfade in on top. Pure decisions live in theory.js.
import { SCALES, scaleNote, openVoicing, midiToHz, MelodyGen, mulberry32, clamp, lerp } from './theory.js';
import { choir, reed, horn, drum, lyre } from './instruments.js';

const STEPS = 16;

// Each profile: key, scale, tempo, chord roots (scale degrees), instrument settings and layer levels.
export const PROFILES = {
  title: {
    env: 'title', root: 50, scale: 'phrygianDominant', bpm: 60, prog: [0, 0, 3, 4, 0, 1, 3, 0], combatMult: 1,
    drone: { interval: 7, cutoff: 420, g: 1 }, wind: { f: 600, q: 0.7, g: 0.5 },
    lyre: { mode: 'phrase', prob: 0.55, oct: 1, bright: 0.45, damp: 0.9975 }, reed: { prob: 0.4, oct: 1, long: true },
    pad: { every: 2, vowel: 'ah' }, bell: { prob: 0.15, oct: 2 }, drum: null,
    levels: { drone: 0.8, wind: 0.5, pad: 0.8, lyre: 0.9, reed: 0.7, bell: 0.5, drum: 0 },
  },
  town: {
    env: 'town', root: 55, scale: 'phrygianDominant', bpm: 84, prog: [0, 0, 3, 0, 5, 3, 4, 0], combatMult: 1.25,
    drone: { interval: 7, cutoff: 600, g: 0.7 }, wind: { f: 900, q: 0.5, g: 0.15 },
    lyre: { mode: 'arp', prob: 0.9, oct: 1, bright: 0.55, damp: 0.996, phraseChance: 0.3 }, reed: { prob: 0.18, oct: 1, long: false },
    pad: { every: 4, vowel: 'oh' }, bell: { prob: 0.1, oct: 2 }, drum: { pat: 'D.t...t.D...t...', vel: 0.3, prob: 1 },
    levels: { drone: 0.5, wind: 0.2, pad: 0.5, lyre: 1, reed: 0.6, bell: 0.4, drum: 1 },
  },
  sunfields: {
    env: 'sunfields', root: 57, scale: 'dorian', bpm: 72, prog: [0, 3, 0, 4, 0, 5, 3, 0], combatMult: 1.4,
    drone: { interval: 7, cutoff: 700, g: 0.8 }, wind: { f: 1500, q: 0.4, g: 0.5 },
    lyre: { mode: 'arp', prob: 0.55, oct: 1, bright: 0.6, damp: 0.9965, phraseChance: 0.4 }, reed: { prob: 0.55, oct: 1, long: true },
    pad: { every: 4, vowel: 'ah' }, bell: { prob: 0.15, oct: 2 }, drum: null,
    levels: { drone: 0.6, wind: 0.6, pad: 0.7, lyre: 0.9, reed: 1, bell: 0.4, drum: 0 },
  },
  marsh: {
    env: 'marsh', root: 52, scale: 'phrygian', bpm: 52, prog: [0, 0, 1, 0, 3, 1, 0, 0], combatMult: 2,
    drone: { interval: 7, cutoff: 300, g: 1 }, wind: { f: 550, q: 0.5, g: 0.8 },
    lyre: { mode: 'sparse', prob: 0.35, oct: 1, bright: 0.4, damp: 0.9975 }, reed: { prob: 0.3, oct: 0, long: true },
    pad: { every: 4, vowel: 'oo' }, bell: { prob: 0.55, oct: 2 }, drum: null,
    levels: { drone: 0.8, wind: 0.9, pad: 0.8, lyre: 0.8, reed: 0.9, bell: 0.7, drum: 0 },
  },
  ruins: {
    env: 'ruins', root: 45, scale: 'doubleHarmonic', bpm: 60, prog: [0, 0, 1, 0, 4, 0, 1, 0], combatMult: 2,
    drone: { interval: 7, cutoff: 360, g: 0.9 }, wind: { f: 2300, q: 0.8, g: 0.45 },
    lyre: { mode: 'sparse', prob: 0.45, oct: 2, bright: 0.7, damp: 0.997 }, reed: { prob: 0.35, oct: 1, long: true },
    pad: { every: 6, vowel: 'oh' }, bell: { prob: 0.1, oct: 2 }, drum: { pat: 'D...............', vel: 0.34, prob: 0.5 },
    levels: { drone: 0.7, wind: 0.8, pad: 0.6, lyre: 0.9, reed: 0.95, bell: 0.4, drum: 1 },
  },
  ashen: {
    env: 'ashen', root: 41, scale: 'hungarianMinor', bpm: 48, prog: [0, 0, 1, 0, 3, 0, 4, 0], combatMult: 2,
    drone: { interval: 6, cutoff: 260, g: 1.2 }, wind: { f: 240, q: 1.2, g: 0.9 },
    lyre: { mode: 'sparse', prob: 0.2, oct: 1, bright: 0.35, damp: 0.998 }, reed: { prob: 0.12, oct: 0, long: true },
    pad: { every: 4, vowel: 'oh' }, bell: { prob: 0.25, oct: 0 }, drum: { pat: 'T.....t.........', vel: 0.32, prob: 0.6 },
    levels: { drone: 1, wind: 0.9, pad: 0.9, lyre: 0.7, reed: 0.7, bell: 0.7, drum: 1 },
  },
  dungeon: {
    env: 'dungeon', root: 38, scale: 'phrygianDominant', bpm: 44, prog: [0, 0, 1, 0, 3, 0, 1, 0], combatMult: 2,
    drone: { interval: 7, cutoff: 220, g: 1.2 }, wind: { f: 130, q: 0.7, g: 1 },
    lyre: { mode: 'sparse', prob: 0.25, oct: 1, bright: 0.3, damp: 0.9985 }, reed: { prob: 0.1, oct: 0, long: true },
    pad: { every: 2, vowel: 'oh' }, bell: { prob: 0.4, oct: 1 }, drum: { pat: 'T...............', vel: 0.5, prob: 0.5 },
    levels: { drone: 1, wind: 1, pad: 1, lyre: 0.7, reed: 0.6, bell: 0.9, drum: 1 },
  },
  boss: {
    env: 'boss', root: 38, scale: 'doubleHarmonic', bpm: 112, prog: [0, 0, 1, 0, 4, 3, 1, 0], combatMult: 1,
    drone: { interval: 6, cutoff: 450, g: 1.3 }, wind: { f: 200, q: 0.7, g: 0.6 },
    lyre: null, reed: { prob: 0.3, oct: 1, long: false }, pad: { every: 2, vowel: 'ah' }, bell: { prob: 0.2, oct: 1 }, drum: null,
    levels: { drone: 1, wind: 0.5, pad: 0.4, lyre: 0, reed: 0.6, bell: 0.4, drum: 0 },
  },
};

// Layer base gains (dB trims relative to each other) and reverb sends
const LAYERS = {
  drone: { send: 0.25, trim: 0.4 },
  wind: { send: 0.2, trim: 3 },
  pad: { send: 0.55, trim: 5 },
  lyre: { send: 0.35, trim: 6 },
  reed: { send: 0.45, trim: 5 },
  bell: { send: 0.65, trim: 5 },
  drum: { send: 0.25, trim: 4 },
  combat: { send: 0.15, trim: 1.3 },
  boss: { send: 0.28, trim: 1.6 },
};

const COMBAT_PAT = 'D..t..t.D..t.t..';
const BOSS_PAT = 'T.kt.kD.T.kDt.kt';
const COMBAT_OSTINATO = [0, -1, 0, -1, 1, -1, 0, -1, 0, -1, 4, -1, 1, -1, 0, 3]; // scale degrees, -1 = rest
const BOSS_OSTINATO = [0, 0, -1, 0, 1, 0, -1, 0, 0, 0, -1, 4, 1, -1, 3, 1];

export class Music {
  constructor(eng, synth, seed = 20260901) {
    this.eng = eng;
    this.S = synth;
    this.ctx = eng.ctx;
    this.rnd = mulberry32(seed);
    this.melody = new MelodyGen(this.rnd);
    this.lyreGen = new MelodyGen(this.rnd, { low: -2, high: 8 });
    this.profileId = null;
    this.pendingId = 'title';
    this.step = 0; // step within the bar
    this.abs = 0; // absolute step counter
    this.bar = 0;
    this.events = [];
    this.reedRest = 1;
    this.nextTime = 0;
    this.combat = 0; // smoothed 0..1
    this.boss = 0;
    this.target = { combat: 0, boss: 0 };
    this.duckDb = 0;
    this.lowpass = 20000;
    this.stingerT = 0;
    this.timer = null;
    this.running = false;
    this.hidden = false;
    this.levelsDirty = true;
    this.stats = { notes: 0, ticks: 0, resyncs: 0 };
    this.buildLayers();
    this.buildBeds();
  }

  buildLayers() {
    const c = this.ctx, e = this.eng;
    this.layers = {};
    for (const [name, def] of Object.entries(LAYERS)) {
      const input = c.createGain();
      input.gain.value = 0;
      const send = c.createGain();
      send.gain.value = def.send;
      input.connect(e.musicBus);
      input.connect(send);
      send.connect(e.musicSend);
      this.layers[name] = { in: input, def };
    }
  }

  // Persistent drone and wind/ambience beds.
  buildBeds() {
    const c = this.ctx;
    const t = c.currentTime;
    const root = midiToHz(PROFILES.title.root);
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 400;
    lp.Q.value = 1.2;
    const dg = c.createGain();
    dg.gain.value = 0.5;
    lp.connect(dg);
    dg.connect(this.layers.drone.in);
    const mk = (type, f, g, dest) => { const o = c.createOscillator(); o.type = type; o.frequency.value = f; const x = c.createGain(); x.gain.value = g; o.connect(x); x.connect(dest); o.start(t); return o; };
    this.drone = {
      lp,
      sub: mk('sine', root / 2, 0.7, dg),
      saw: mk('sawtooth', root, 0.2, lp),
      saw2: mk('sawtooth', root * 1.004, 0.2, lp),
      fifth: mk('sawtooth', root * 1.5, 0.12, lp),
      gain: dg,
    };
    const lfo = c.createOscillator();
    lfo.frequency.value = 0.045;
    const lfoG = c.createGain();
    lfoG.gain.value = 110;
    lfo.connect(lfoG);
    lfoG.connect(lp.frequency);
    lfo.start(t);
    // wind: looped pink noise -> band-pass with slow movement
    const src = c.createBufferSource();
    src.buffer = this.eng.noise.pink;
    src.loop = true;
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 800;
    bp.Q.value = 0.6;
    const wg = c.createGain();
    wg.gain.value = 0.5;
    const l2 = c.createOscillator();
    l2.frequency.value = 0.07;
    const l2g = c.createGain();
    l2g.gain.value = 250;
    l2.connect(l2g);
    l2g.connect(bp.frequency);
    const l3 = c.createOscillator();
    l3.frequency.value = 0.11;
    const l3g = c.createGain();
    l3g.gain.value = 0.25;
    l3.connect(l3g);
    l3g.connect(wg.gain);
    src.connect(bp);
    bp.connect(wg);
    wg.connect(this.layers.wind.in);
    src.start(t);
    l2.start(t);
    l3.start(t);
    this.wind = { bp, gain: wg };
  }

  // ---- control --------------------------------------------------------------------------------
  start() {
    if (this.running) return;
    this.running = true;
    this.nextTime = this.ctx.currentTime + 0.1;
    this.timer = setInterval(() => this.tick(), 25);
  }

  stop() { this.running = false; clearInterval(this.timer); }

  // targets: {profile, combat 0..1, boss 0..1, duckDb, lowpass}
  setTargets(t) {
    if (t.profile && t.profile !== this.pendingId) { this.pendingId = t.profile; this.levelsDirty = true; this.applyProfileBeds(PROFILES[t.profile]); }
    this.target.combat = t.combat;
    this.target.boss = t.boss;
    this.duckDb = t.duckDb;
    this.lowpass = t.lowpass;
  }

  // Jump straight to a state (offline rendering / tests)
  snap(t) {
    this.setTargets(t);
    this.combat = this.target.combat;
    this.boss = this.target.boss;
    this.profileId = this.pendingId;
    this.applyProfileBeds(PROFILES[this.profileId], true);
    this.applyLevels(true);
  }

  stinger() { this.stingerT = 3; }

  // Retune the drone and wind to the (new) profile. Glides, never jumps.
  applyProfileBeds(P, immediate = false) {
    const t = this.ctx.currentTime;
    const tc = immediate ? 0.001 : 1.6;
    const root = midiToHz(P.root);
    const D = this.drone;
    D.sub.frequency.setTargetAtTime(root / 2, t, tc);
    D.saw.frequency.setTargetAtTime(root, t, tc);
    D.saw2.frequency.setTargetAtTime(root * 1.004, t, tc);
    D.fifth.frequency.setTargetAtTime(root * 2 ** (P.drone.interval / 12), t, tc);
    D.lp.frequency.setTargetAtTime(P.drone.cutoff, t, tc);
    D.gain.gain.setTargetAtTime(0.5 * P.drone.g, t, tc);
    this.wind.bp.frequency.setTargetAtTime(P.wind.f, t, tc);
    this.wind.bp.Q.setTargetAtTime(P.wind.q, t, tc);
    this.wind.gain.gain.setTargetAtTime(0.5 * P.wind.g, t, tc);
    this.eng.setEnvironment(P.env);
  }

  applyLevels(immediate = false) {
    const P = PROFILES[this.profileId ?? this.pendingId];
    const t = this.ctx.currentTime;
    const tc = immediate ? 0.001 : 0.5;
    const calm = 1 - 0.85 * this.combat * (this.boss > 0.5 ? 1 : 1);
    const set = (name, v) => this.layers[name].in.gain.setTargetAtTime(v * LAYERS[name].trim, t, tc);
    set('drone', P.levels.drone * (1 + 0.35 * this.combat));
    set('wind', P.levels.wind * (1 - 0.4 * this.combat));
    for (const n of ['pad', 'lyre', 'reed', 'bell', 'drum']) set(n, P.levels[n] * (n === 'pad' ? 1 - 0.4 * this.combat : calm));
    set('combat', this.combat * (1 - this.boss));
    set('boss', this.boss);
  }

  update(dt) {
    // Smooth combat/boss envelopes: rise ~1.2 s, fall ~3 s
    const rise = 1 - Math.exp(-dt / 0.55), fall = 1 - Math.exp(-dt / 1.6);
    const c0 = this.combat, b0 = this.boss;
    this.combat += (this.target.combat - this.combat) * (this.target.combat > this.combat ? rise : fall);
    this.boss += (this.target.boss - this.boss) * (this.target.boss > this.boss ? rise : fall);
    if (Math.abs(this.combat - c0) > 0.002 || Math.abs(this.boss - b0) > 0.002 || this.levelsDirty) { this.applyLevels(); this.levelsDirty = false; }
    this.stingerT = Math.max(0, this.stingerT - dt);
    const stingDb = this.stingerT > 0 ? -4 * Math.min(1, this.stingerT / 0.6) : 0;
    this.eng.setMusicDuck(this.duckDb + stingDb, this.lowpass, 0.3);
  }

  // ---- scheduler -----------------------------------------------------------------------------------
  lookahead() { return this.hidden ? 1.2 : 0.12; }

  stepDur() {
    const P = PROFILES[this.profileId ?? this.pendingId];
    const mult = lerp(1, P.combatMult, this.combat);
    return 60 / (P.bpm * mult) / 4;
  }

  tick(now = this.ctx.currentTime, lookahead = this.lookahead()) {
    if (!this.running && !this.manual) return;
    this.stats.ticks++;
    if (this.nextTime < now - 0.1) { this.nextTime = now + 0.02; this.stats.resyncs++; }
    const horizon = now + lookahead;
    let guard = 0;
    while (this.nextTime < horizon && guard++ < 64) {
      this.scheduleStep(this.nextTime);
      this.nextTime += this.stepDur();
      this.abs++;
      this.step++;
      if (this.step >= STEPS) { this.step = 0; this.bar++; }
    }
  }

  scheduleStep(t) {
    // Profile change takes effect on the next beat (resets the bar so new-key material starts clean).
    if (this.pendingId !== this.profileId && (this.step % 4 === 0 || !this.profileId)) {
      this.profileId = this.pendingId;
      this.step = 0;
      this.bar = 0;
      this.events = this.events.filter((e) => e.at <= this.abs); // drop not-yet-played notes of the old key
      this.reedRest = 1;
      this.levelsDirty = true;
    }
    const P = PROFILES[this.profileId];
    const sd = this.stepDur();
    if (this.step === 0) this.composeBar(P, t, sd);
    // play queued melodic events
    if (this.events.length) {
      const rest = [];
      for (const ev of this.events) {
        if (ev.at <= this.abs) this.playEvent(P, ev, t, sd); else rest.push(ev);
      }
      this.events = rest;
    }
    if (P.drum && this.drumOn) this.exploreDrum(P, t);
    if (this.boss > 0.05) this.bossStep(P, t, sd);
    else if (this.combat > 0.08) this.combatStep(P, t, sd);
  }

  // ---- composition ----------------------------------------------------------------------------------
  composeBar(P, t, sd) {
    const r = this.rnd;
    const sc = SCALES[P.scale];
    const deg = P.prog[this.bar % P.prog.length];
    const at = (s) => this.abs + s;
    const calm = this.combat < 0.5;
    // pad: slow choir chords
    if (P.pad && this.bar % P.pad.every === 0 && (calm || this.boss > 0.5)) {
      this.events.push({ at: at(0), kind: 'pad', midis: openVoicing(P.root + (P.pad.oct ?? 0), sc, deg), dur: P.pad.every * STEPS * sd * 0.9 });
    }
    // exploration drum bar decision
    this.drumOn = P.drum ? r() < (P.drum.prob ?? 1) : false;
    if (this.boss > 0.5) {
      // boss: horn hits and choir stabs every other bar
      if (this.bar % 2 === 0) {
        const hd = P.prog[(this.bar / 2) % P.prog.length];
        this.events.push({ at: at(0), kind: 'horn', midi: scaleNote(P.root + 12, sc, hd), dur: sd * 6 });
        this.events.push({ at: at(0), kind: 'horn', midi: scaleNote(P.root, sc, hd), dur: sd * 7 });
      }
      if (this.bar % 4 === 2) this.events.push({ at: at(8), kind: 'horn', midi: scaleNote(P.root + 12, sc, deg + 1), dur: sd * 3 });
      if (r() < P.reed.prob && this.reedRest <= 0 && this.bar % 2 === 1) this.queuePhrase(P, 'reed', sc, 1, at(0));
      this.reedRest--;
      return;
    }
    if (!calm) return; // keep melodic layers out of the way of combat
    // lyre
    if (P.lyre && r() < P.lyre.prob) {
      const base = P.root + 12 * P.lyre.oct;
      let mode = P.lyre.mode;
      if (mode === 'arp' && r() < (P.lyre.phraseChance ?? 0)) mode = 'phrase';
      if (mode === 'arp') {
        const pattern = [0, 2, 4, 7, 4, 2, 5, 2];
        const dir = r() < 0.5 ? 1 : -1;
        for (let i = 0; i < 8; i++) {
          if (r() < 0.2) continue;
          const k = dir > 0 ? i : 7 - i;
          this.events.push({ at: at(i * 2), kind: 'lyre', midi: scaleNote(base, sc, deg + pattern[k]), vel: 0.55 + r() * 0.35 + (i % 4 === 0 ? 0.2 : 0), dur: 2 });
        }
      } else if (mode === 'phrase') {
        let pos = 0;
        for (const n of this.lyreGen.phrase(1, { ending: true })) {
          this.events.push({ at: at(pos), kind: 'lyre', midi: scaleNote(base, sc, n.deg), vel: 0.6 + r() * 0.3, dur: n.len });
          pos += n.len;
        }
      } else {
        const n = 1 + Math.floor(r() * 3);
        for (let i = 0; i < n; i++) {
          this.events.push({ at: at(Math.floor(r() * 7) * 2), kind: 'lyre', midi: scaleNote(base, sc, deg + [0, 1, 2, 4, 5, 7][Math.floor(r() * 6)]), vel: 0.5 + r() * 0.4, dur: 4 });
        }
      }
    }
    // reed lead: phrases separated by silence
    if (P.reed && this.reedRest <= 0 && r() < P.reed.prob) {
      this.queuePhrase(P, 'reed', sc, P.reed.long ? 2 : 1, at(r() < 0.5 ? 0 : 4));
      this.reedRest = 1 + Math.floor(r() * 3);
    } else this.reedRest--;
    // bells / drips
    if (P.bell && r() < P.bell.prob) {
      const bd = [0, 1, 4, 7, 2][Math.floor(r() * 5)];
      this.events.push({ at: at(Math.floor(r() * 14)), kind: 'bell', midi: scaleNote(P.root + 12 * P.bell.oct, sc, bd), vel: 0.4 + r() * 0.5 });
      if (r() < 0.35) this.events.push({ at: at(Math.floor(r() * 14) + 2), kind: 'bell', midi: scaleNote(P.root + 12 * P.bell.oct, sc, bd + 4), vel: 0.3 + r() * 0.3 });
    }
  }

  queuePhrase(P, kind, sc, bars, startAbs) {
    const r = this.rnd;
    const phrase = this.melody.phrase(bars, { ending: true, long: P.reed.long });
    let pos = 0;
    const base = P.root + 12 * (P.reed.oct ?? 1);
    for (const n of phrase) {
      const ev = { at: startAbs + pos, kind, midi: scaleNote(base, sc, n.deg), dur: n.len, vel: 0.75 + r() * 0.25 };
      if (r() < 0.3 && n.len >= 3) ev.from = scaleNote(base, sc, n.deg - 1);
      this.events.push(ev);
      pos += n.len;
    }
  }

  playEvent(P, ev, t, sd) {
    const S = this.S;
    S.begin(t, 1, 1);
    this.stats.notes++;
    switch (ev.kind) {
      case 'pad': choir(S, this.layers.pad.in, { midis: ev.midis, dur: Math.max(1, ev.dur * 0.55), a: Math.min(2.5, ev.dur * 0.3), r: Math.min(3, ev.dur * 0.4), vowel: P.pad.vowel, g: 0.1 }); break;
      case 'lyre': lyre(S, this.layers.lyre.in, { midi: ev.midi, g: 0.2 * (ev.vel ?? 1), bright: P.lyre?.bright ?? 0.5, damp: P.lyre?.damp ?? 0.996, dur: 2.6 }); break;
      case 'reed': reed(S, this.layers.reed.in, { midi: ev.midi, dur: Math.max(0.2, ev.dur * sd * 0.92), g: 0.075 * (ev.vel ?? 1), from: ev.from ?? null }); break;
      case 'bell': S.bell(this.layers.bell.in, { f: midiToHz(ev.midi), g: 0.09 * (ev.vel ?? 1), dur: 2.8, vary: false }); break;
      case 'horn': horn(S, this.layers[this.boss > 0.5 ? 'boss' : 'combat'].in, { midi: ev.midi, dur: ev.dur, g: 0.17, open: 1500, a: 0.1, r: 0.5 }); break;
      default:
    }
  }

  exploreDrum(P, t) {
    const ch = P.drum.pat[this.step];
    if (ch && ch !== '.') this.hit(this.layers.drum.in, ch, P.drum.vel, t);
  }

  hit(dest, ch, vel, t) {
    const S = this.S;
    S.begin(t, 1, 1);
    const kind = { D: 'doum', t: 'tek', k: 'ka', s: 'slap', T: 'tom', x: 'shake' }[ch];
    if (kind) drum(S, dest, { kind, vel: vel * (kind === 'tom' ? 0.65 : 1) * (0.88 + this.rnd() * 0.24) });
  }

  combatStep(P, t, sd) {
    const lvl = this.combat;
    const dest = this.layers.combat.in;
    const s = this.step;
    const sc = SCALES[P.scale];
    const ch = COMBAT_PAT[s];
    if (ch !== '.') this.hit(dest, ch, ch === 'D' ? 0.95 : 0.65, t);
    if (lvl > 0.5) {
      if (s === 0 || s === 8) this.hit(dest, 'T', 0.85, t);
      if (s % 2 === 1 && this.rnd() < 0.55) this.hit(dest, 'k', 0.3, t);
    }
    if (lvl > 0.8) {
      this.hit(dest, 'x', 0.7, t);
      if (s === 10 || s === 14) this.hit(dest, 'T', 0.5, t);
    }
    if (lvl > 0.3 && s % 2 === 0) {
      const d = COMBAT_OSTINATO[s];
      if (d >= 0) {
        this.S.begin(t, 1, 1);
        lyre(this.S, dest, { midi: scaleNote(P.root - 12 + (P.root > 48 ? 0 : 12), sc, d), g: 0.3, bright: 0.45, dur: 1.2, damp: 0.994 });
      }
    }
    if (s === 0 && this.bar % 2 === 0 && lvl > 0.6) {
      this.S.begin(t, 1, 1);
      horn(this.S, dest, { midi: scaleNote(P.root, sc, 0), dur: sd * 6, g: 0.1, open: 900, a: 0.12, r: 0.5 });
    }
  }

  bossStep(P, t, sd) {
    const dest = this.layers.boss.in;
    const s = this.step;
    const sc = SCALES[P.scale];
    const ch = BOSS_PAT[s];
    if (ch !== '.') this.hit(dest, ch, ch === 'T' ? 1 : ch === 'D' ? 0.9 : 0.6, t);
    if (s % 2 === 1 && this.rnd() < 0.5) this.hit(dest, 'k', 0.28, t);
    if (this.bar % 4 === 3 && s >= 8 && s % 2 === 0) this.hit(dest, 'T', 0.5 + (s - 8) * 0.06, t); // fill
    if (s % 2 === 0) {
      const d = BOSS_OSTINATO[s];
      if (d >= 0) { this.S.begin(t, 1, 1); lyre(this.S, dest, { midi: scaleNote(P.root, sc, d), g: 0.34, bright: 0.5, dur: 1, damp: 0.993 }); }
    }
    if (s === 0) this.hit(dest, 'x', 0.5, t);
  }
}
