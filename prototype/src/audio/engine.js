// Web Audio plumbing: context, buses, compressor/limiter, convolution reverbs,
// shared noise buffers, per-voice spatial output. Works with a real AudioContext
// or an OfflineAudioContext (used by the measurement harness).
import { generateImpulse, spatialize, volumeCurve, clamp, mulberry32 } from './theory.js';

// Reverb environments: how much of each bus is sent to the open-air / stone-hall convolver.
export const ENVIRONMENTS = {
  title: { sfx: [0.14, 0.12], music: [0.2, 0.35] },
  town: { sfx: [0.12, 0], music: [0.16, 0.12] },
  sunfields: { sfx: [0.18, 0], music: [0.26, 0.2] },
  marsh: { sfx: [0.28, 0.06], music: [0.28, 0.34] },
  ruins: { sfx: [0.22, 0.04], music: [0.2, 0.3] },
  ashen: { sfx: [0.26, 0.1], music: [0.2, 0.36] },
  dungeon: { sfx: [0.02, 0.5], music: [0.08, 0.58] },
  boss: { sfx: [0.02, 0.55], music: [0.08, 0.5] },
};

export class Engine {
  constructor(ctx) {
    this.ctx = ctx;
    this.listener = { x: 0, z: 0, rx: 1, rz: 0 };
    this.cleanups = []; // {at, nodes}
    this.volumes = { master: 0.8, music: 0.6, sfx: 0.8 };
    this.build();
  }

  build() {
    const c = this.ctx;
    const gain = (v = 1) => { const n = c.createGain(); n.gain.value = v; return n; };
    this.gain = gain;

    // Output chain: buses -> gentle glue compressor -> brick-wall limiter -> user master volume.
    this.mix = gain(1);
    this.comp = c.createDynamicsCompressor();
    this.comp.threshold.value = -14;
    this.comp.knee.value = 12;
    this.comp.ratio.value = 3;
    this.comp.attack.value = 0.006;
    this.comp.release.value = 0.22;
    this.limiter = c.createDynamicsCompressor();
    this.limiter.threshold.value = -3;
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.001;
    this.limiter.release.value = 0.09;
    this.masterOut = gain(volumeCurve(this.volumes.master));
    this.mix.connect(this.comp).connect(this.limiter).connect(this.masterOut).connect(c.destination);

    // Buses
    this.sfxBus = gain(volumeCurve(this.volumes.sfx));
    this.uiBus = gain(volumeCurve(this.volumes.sfx));
    this.musicDuck = gain(1); // stingers / menus duck the music through this
    this.musicBus = gain(volumeCurve(this.volumes.music) * MUSIC_TRIM);
    this.musicLP = c.createBiquadFilter();
    this.musicLP.type = 'lowpass';
    this.musicLP.frequency.value = 20000;
    this.musicLP.Q.value = 0.5;
    this.sfxBus.connect(this.mix);
    this.uiBus.connect(this.mix);
    this.musicBus.connect(this.musicDuck).connect(this.musicLP).connect(this.mix);

    // Reverb: one open-air and one stone-hall convolver shared by everything.
    const rate = c.sampleRate;
    this.convOpen = this.makeConvolver(generateImpulse(rate, { seconds: 1.5, decayDb: 55, preDelay: 0.01, damp: 0.8, early: 5, seed: 3 }));
    this.convHall = this.makeConvolver(generateImpulse(rate, { seconds: 3.8, decayDb: 60, preDelay: 0.03, damp: 0.9, early: 8, seed: 11 }));
    this.revOpenIn = gain(1);
    this.revHallIn = gain(1);
    const revOut = gain(1);
    this.revOpenIn.connect(this.convOpen).connect(revOut);
    this.revHallIn.connect(this.convHall).connect(revOut);
    revOut.connect(this.mix);
    // Send buses (dry signal taps) with per-environment amounts into each convolver
    this.sfxSend = gain(volumeCurve(this.volumes.sfx));
    this.musicSend = gain(volumeCurve(this.volumes.music) * MUSIC_TRIM);
    this.sfxToOpen = gain(0.18); this.sfxToHall = gain(0);
    this.musicToOpen = gain(0.26); this.musicToHall = gain(0.2);
    this.sfxSend.connect(this.sfxToOpen).connect(this.revOpenIn);
    this.sfxSend.connect(this.sfxToHall).connect(this.revHallIn);
    // The music's reverb send passes the same duck as its dry path, so menus duck the tails too.
    this.musicSendDuck = gain(1);
    this.musicSend.connect(this.musicSendDuck);
    this.musicSendDuck.connect(this.musicToOpen).connect(this.revOpenIn);
    this.musicSendDuck.connect(this.musicToHall).connect(this.revHallIn);

    this.makeNoise();
  }

  makeConvolver([l, r]) {
    const c = this.ctx;
    const buf = c.createBuffer(2, l.length, c.sampleRate);
    buf.copyToChannel(l, 0);
    buf.copyToChannel(r, 1);
    const conv = c.createConvolver();
    conv.buffer = buf;
    return conv;
  }

  // 4 s of white / pink / brown noise, generated once and re-used everywhere (random start offsets).
  makeNoise() {
    const c = this.ctx;
    const len = Math.floor(c.sampleRate * 4);
    const rnd = mulberry32(1234);
    const mk = (fn) => { const b = c.createBuffer(1, len, c.sampleRate); fn(b.getChannelData(0)); return b; };
    this.noise = {
      white: mk((d) => { for (let i = 0; i < len; i++) d[i] = rnd() * 2 - 1; }),
      pink: mk((d) => {
        let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
        for (let i = 0; i < len; i++) {
          const w = rnd() * 2 - 1;
          b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
          b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
          d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
        }
      }),
      brown: mk((d) => { let last = 0; for (let i = 0; i < len; i++) { last = (last + 0.02 * (rnd() * 2 - 1)) / 1.02; d[i] = last * 3.5; } }),
    };
    this.noiseDur = 4;
  }

  get now() { return this.ctx.currentTime; }

  // ---- volumes / environment ----------------------------------------------------------------
  setVolumes({ master, music, sfx }) {
    const t = this.now;
    if (master !== undefined) this.volumes.master = master;
    if (music !== undefined) this.volumes.music = music;
    if (sfx !== undefined) this.volumes.sfx = sfx;
    const m = volumeCurve(this.volumes.master), mu = volumeCurve(this.volumes.music), s = volumeCurve(this.volumes.sfx);
    this.masterOut.gain.setTargetAtTime(m, t, 0.05);
    this.sfxBus.gain.setTargetAtTime(s, t, 0.05);
    this.sfxSend.gain.setTargetAtTime(s, t, 0.05);
    this.uiBus.gain.setTargetAtTime(s, t, 0.05);
    this.musicBus.gain.setTargetAtTime(mu * MUSIC_TRIM, t, 0.05);
    this.musicSend.gain.setTargetAtTime(mu * MUSIC_TRIM, t, 0.05);
  }

  setEnvironment(name) {
    const e = ENVIRONMENTS[name] ?? ENVIRONMENTS.sunfields;
    const t = this.now;
    this.sfxToOpen.gain.setTargetAtTime(e.sfx[0], t, 0.8);
    this.sfxToHall.gain.setTargetAtTime(e.sfx[1], t, 0.8);
    this.musicToOpen.gain.setTargetAtTime(e.music[0], t, 1.2);
    this.musicToHall.gain.setTargetAtTime(e.music[1], t, 1.2);
  }

  // Duck / muffle the music (menus, death, stingers). `db` <= 0, `lowpass` in Hz.
  setMusicDuck(db, lowpass, tc = 0.25) {
    const t = this.now;
    this.musicDuck.gain.setTargetAtTime(10 ** (db / 20), t, tc);
    this.musicSendDuck.gain.setTargetAtTime(10 ** (db / 20), t, tc);
    this.musicLP.frequency.setTargetAtTime(clamp(lowpass, 200, 20000), t, tc);
  }

  // ---- spatial voice output -------------------------------------------------------------------
  setListener(x, z, rx, rz) {
    const L = this.listener;
    L.x = x; L.z = z;
    const n = Math.hypot(rx, rz) || 1;
    L.rx = rx / n; L.rz = rz / n;
  }

  // Creates the output chain for one sound. Returns null when it is out of earshot.
  // pos: {x,z} (or null for non-positional). bus: 'sfx' | 'ui'. send: reverb amount 0..1.
  voice({ pos = null, bus = 'sfx', send = 0.3, gain = 1 } = {}) {
    const c = this.ctx;
    const L = this.listener;
    let sp = { audible: true, dist: 0, gain: 1, pan: 0, lp: 20000 };
    if (pos) sp = spatialize(pos.x - L.x, pos.z - L.z, L.rx, L.rz);
    if (!sp.audible) return null;
    const input = c.createGain();
    input.gain.value = gain * sp.gain;
    let tail = input;
    const nodes = [input];
    if (sp.dist > 9) {
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = sp.lp;
      tail.connect(lp);
      tail = lp;
      nodes.push(lp);
    }
    if (c.createStereoPanner && Math.abs(sp.pan) > 0.02) {
      const p = c.createStereoPanner();
      p.pan.value = sp.pan;
      tail.connect(p);
      tail = p;
      nodes.push(p);
    }
    tail.connect(bus === 'ui' ? this.uiBus : this.sfxBus);
    if (send > 0.001 && bus !== 'ui') {
      const s = c.createGain();
      s.gain.value = send * (1 + sp.dist / 20);
      tail.connect(s);
      s.connect(this.sfxSend);
      nodes.push(s);
    }
    return { input, nodes, dist: sp.dist, pan: sp.pan, t0: this.now };
  }

  // Disconnect a voice's nodes after `dur` seconds (processed from pump()).
  retire(voice, dur) {
    if (voice) this.cleanups.push({ at: this.now + dur + 0.25, nodes: voice.nodes });
  }

  // Fade a voice out quickly (voice stealing) and retire it soon.
  killVoice(voice) {
    if (!voice) return;
    try { voice.input.gain.cancelScheduledValues(this.now); voice.input.gain.setTargetAtTime(0, this.now, 0.015); } catch { /* ignore */ }
    this.cleanups.push({ at: this.now + 0.15, nodes: voice.nodes });
  }

  pump() {
    if (!this.cleanups.length) return;
    const t = this.now;
    let w = 0;
    for (let i = 0; i < this.cleanups.length; i++) {
      const c = this.cleanups[i];
      if (c.at <= t) { for (const n of c.nodes) { try { n.disconnect(); } catch { /* already gone */ } } } else this.cleanups[w++] = c;
    }
    this.cleanups.length = w;
  }
}

// Trim so that, at default settings, the music sits 10-14 dB below the effects (calibrated with the measurement harness).
export const MUSIC_TRIM = 0.66;
