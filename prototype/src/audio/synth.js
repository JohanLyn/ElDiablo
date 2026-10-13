// Small synthesis toolkit shared by the SFX library and the music score.
// Every method schedules nodes at (S.t0 + o.t) and lets them clean themselves up
// (sources are stopped, the voice output is disconnected by Engine.pump()).
import { karplusStrong, midiToHz } from './theory.js';

const FLOOR = 0.0001;

export class Synth {
  constructor(eng) {
    this.eng = eng;
    this.ctx = eng.ctx;
    this.t0 = 0;
    this.pv = 1; // pitch variation multiplier for the sound being built
    this.fv = 1; // filter variation multiplier
    this.pluckCache = new Map();
    this.nodeBudget = 0;
  }

  begin(t0 = this.ctx.currentTime, pv = 1, fv = 1) { this.t0 = t0; this.pv = pv; this.fv = fv; }

  // Amplitude envelope on an AudioParam: attack a, optional decay d down to sus, hold h, release r.
  env(param, t, peak, { a = 0.004, d = 0, sus = 1, h = 0, r = 0.2 } = {}) {
    peak = Math.max(peak, FLOOR * 2);
    param.setValueAtTime(FLOOR, t);
    param.linearRampToValueAtTime(peak, t + a);
    let tt = t + a;
    let level = peak;
    if (d > 0) {
      level = Math.max(peak * sus, FLOOR * 2);
      param.exponentialRampToValueAtTime(level, tt + d);
      tt += d;
    }
    if (h > 0) { param.setValueAtTime(level, tt + h); tt += h; }
    param.exponentialRampToValueAtTime(FLOOR, tt + r);
    return tt + r;
  }

  filterChain(src, filters, t, dur) {
    let node = src;
    const made = [];
    for (const f of filters ?? []) {
      if (!f) continue;
      const b = this.ctx.createBiquadFilter();
      b.type = f.type ?? 'lowpass';
      const f0 = Math.max(20, Math.min(20000, f.f * this.fv));
      b.frequency.setValueAtTime(f0, t);
      if (f.f2) b.frequency.exponentialRampToValueAtTime(Math.max(20, Math.min(20000, f.f2 * this.fv)), t + (f.tf ?? dur));
      b.Q.value = f.q ?? 0.7;
      if (f.gain !== undefined) b.gain.value = f.gain;
      node.connect(b);
      node = b;
      made.push(b);
    }
    return node;
  }

  // Oscillator voice. o: {t, f, f2, tf, type, g, a, d, sus, h, r, det, filt:[{type,f,f2,q}], vib:{rate,depth,delay}, vary}
  tone(dest, o) {
    const c = this.ctx;
    const t = this.t0 + (o.t ?? 0);
    const a = o.a ?? 0.004, h = o.h ?? 0, r = o.r ?? 0.2, d = o.d ?? 0;
    const total = a + d + h + r;
    const osc = c.createOscillator();
    osc.type = o.type ?? 'sine';
    const pv = o.vary === false ? 1 : this.pv;
    osc.frequency.setValueAtTime(Math.max(10, o.f * pv), t);
    if (o.f2) osc.frequency.exponentialRampToValueAtTime(Math.max(10, o.f2 * pv), t + (o.tf ?? total));
    if (o.det) osc.detune.value = o.det;
    if (o.vib) {
      const lfo = c.createOscillator();
      lfo.frequency.value = o.vib.rate ?? 5;
      const lg = c.createGain();
      lg.gain.setValueAtTime(0, t);
      lg.gain.linearRampToValueAtTime(o.vib.depth ?? 10, t + (o.vib.delay ?? 0.3));
      lfo.connect(lg);
      lg.connect(osc.detune);
      lfo.start(t);
      lfo.stop(t + total + 0.05);
    }
    const g = c.createGain();
    this.env(g.gain, t, o.g ?? 0.3, { a, d, sus: o.sus, h, r });
    const tail = this.filterChain(osc, o.filt, t, total);
    tail.connect(g);
    g.connect(dest);
    osc.start(t);
    osc.stop(t + total + 0.05);
    return g;
  }

  // Filtered noise burst. o: {t, dur, color, g, a, r, filt:[...], am:{rate,depth}, pan}
  noise(dest, o) {
    const c = this.ctx;
    const t = this.t0 + (o.t ?? 0);
    const a = o.a ?? 0.004, h = o.h ?? 0, r = o.r ?? Math.max(0.02, (o.dur ?? 0.1) - a);
    const d = o.d ?? 0;
    const total = a + d + h + r;
    const src = c.createBufferSource();
    src.buffer = this.eng.noise[o.color ?? 'white'];
    const off = Math.random() * Math.max(0.01, this.eng.noiseDur - total - 0.05);
    const g = c.createGain();
    this.env(g.gain, t, o.g ?? 0.3, { a, d, sus: o.sus, h, r });
    const tail = this.filterChain(src, o.filt, t, total);
    if (o.am) {
      const am = c.createGain();
      am.gain.value = 1 - (o.am.depth ?? 0.5) * 0.5;
      const lfo = c.createOscillator();
      lfo.type = o.am.type ?? 'sine';
      lfo.frequency.value = o.am.rate ?? 20;
      const lg = c.createGain();
      lg.gain.value = (o.am.depth ?? 0.5) * 0.5;
      lfo.connect(lg);
      lg.connect(am.gain);
      tail.connect(am);
      am.connect(g);
      lfo.start(t);
      lfo.stop(t + total + 0.05);
    } else tail.connect(g);
    g.connect(dest);
    src.start(t, off);
    src.stop(t + total + 0.05);
    return g;
  }

  // Short filtered click (transient): a few ms of noise
  click(dest, o = {}) {
    return this.noise(dest, { t: o.t, dur: o.dur ?? 0.012, a: 0.0008, r: o.dur ?? 0.012, g: o.g ?? 0.4, filt: [{ type: o.type ?? 'bandpass', f: o.f ?? 3000, q: o.q ?? 1 }] });
  }

  // Bell / glass: inharmonic partials with shorter decay for the upper ones.
  bell(dest, o) {
    const ratios = o.ratios ?? [1, 2.0, 2.76, 5.4, 8.93];
    const amps = o.amps ?? [1, 0.55, 0.4, 0.2, 0.1];
    const dur = o.dur ?? 1.2;
    for (let i = 0; i < ratios.length; i++) {
      const f = o.f * ratios[i];
      if (f > 15000) continue;
      this.tone(dest, { t: o.t, f, type: 'sine', g: (o.g ?? 0.2) * amps[i], a: o.a ?? 0.002, r: dur / (1 + i * 0.7), vary: o.vary });
    }
  }

  // Karplus-Strong pluck, rendered once and cached per (midi, timbre).
  pluck(dest, o) {
    const c = this.ctx;
    const t = this.t0 + (o.t ?? 0);
    const key = `${o.midi.toFixed(2)}|${o.bright ?? 0.5}|${o.damp ?? 0.996}|${o.dur ?? 2}`;
    let buf = this.pluckCache.get(key);
    if (!buf) {
      const data = karplusStrong(c.sampleRate, midiToHz(o.midi), o.dur ?? 2, { brightness: o.bright ?? 0.5, damping: o.damp ?? 0.996, pluckPos: o.pos ?? 0.28 });
      buf = c.createBuffer(1, data.length, c.sampleRate);
      buf.copyToChannel(data, 0);
      this.pluckCache.set(key, buf);
      if (this.pluckCache.size > 64) this.pluckCache.delete(this.pluckCache.keys().next().value);
    }
    const src = c.createBufferSource();
    src.buffer = buf;
    if (o.det) src.detune.value = o.det;
    const g = c.createGain();
    g.gain.value = o.g ?? 0.3;
    const tail = this.filterChain(src, o.filt, t, o.dur ?? 2);
    tail.connect(g);
    g.connect(dest);
    src.start(t);
    return g;
  }
}
