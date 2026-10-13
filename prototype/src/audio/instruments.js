// Synthesised "instruments" used by both the score and some SFX: choir, reed pipe,
// frame drum, brass horn, lyre. They are plain functions over Synth (no state).
import { midiToHz } from './theory.js';

export const VOWELS = {
  ah: [[700, 5, 1], [1080, 7, 0.55], [2650, 9, 0.2]],
  oh: [[450, 5, 1], [800, 7, 0.5], [2830, 9, 0.12]],
  oo: [[325, 5, 1], [700, 7, 0.4], [2530, 9, 0.08]],
  eh: [[530, 5, 1], [1840, 8, 0.4], [2480, 9, 0.15]],
};

// Low choir: detuned saws -> formant bank. midis: array of MIDI notes. A slow swell, long release.
export function choir(S, dest, { t = 0, midis, dur = 4, a = 1.2, r = 2.2, vowel = 'ah', g = 0.12, vib = 5.2, breath = 0.012 }) {
  const c = S.ctx;
  const start = S.t0 + t;
  const total = a + dur + r;
  const sum = c.createGain();
  sum.gain.value = 1 / Math.max(1, midis.length * 1.6);
  const lfo = c.createOscillator();
  lfo.frequency.value = vib + Math.random() * 0.6;
  const lfoG = c.createGain();
  lfoG.gain.setValueAtTime(0, start);
  lfoG.gain.linearRampToValueAtTime(7, start + a + 0.5);
  lfo.connect(lfoG);
  lfo.start(start);
  lfo.stop(start + total + 0.1);
  for (const m of midis) {
    for (const det of [-11, 0, 10]) {
      const o = c.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = midiToHz(m);
      o.detune.value = det + (Math.random() - 0.5) * 4;
      lfoG.connect(o.detune);
      o.connect(sum);
      o.start(start);
      o.stop(start + total + 0.1);
    }
  }
  const out = c.createGain();
  S.env(out.gain, start, g, { a, h: dur, r });
  for (const [f, q, amp] of VOWELS[vowel] ?? VOWELS.ah) {
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = f * S.fv;
    bp.Q.value = q;
    const ga = c.createGain();
    ga.gain.value = amp * 2.6;
    sum.connect(bp);
    bp.connect(ga);
    ga.connect(out);
  }
  out.connect(dest);
  if (breath > 0) S.noise(dest, { t, dur: total, a, h: dur, r, g: breath * g / 0.12, filt: [{ type: 'bandpass', f: 2600, q: 1.1 }] });
}

// Nasal double-reed / shawm-like lead. opts.from = MIDI note to scoop up from (ornament).
export function reed(S, dest, { t = 0, midi, dur = 1, g = 0.1, from = null, vib = true, a = 0.07 }) {
  const c = S.ctx;
  const start = S.t0 + t;
  const r = Math.min(0.5, 0.18 + dur * 0.15);
  const total = a + dur + r;
  const sum = c.createGain();
  sum.gain.value = 0.5;
  const f1 = midiToHz(from ?? midi), f2 = midiToHz(midi);
  const lfo = c.createOscillator();
  lfo.frequency.value = 5.1 + Math.random() * 0.5;
  const lfoG = c.createGain();
  lfoG.gain.setValueAtTime(0, start);
  lfoG.gain.linearRampToValueAtTime(vib ? 16 : 0, start + 0.45);
  lfo.connect(lfoG);
  lfo.start(start);
  lfo.stop(start + total + 0.1);
  for (const [det, type, amp] of [[-6, 'sawtooth', 1], [7, 'sawtooth', 0.8], [0, 'square', 0.3]]) {
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f1, start);
    if (from != null) o.frequency.exponentialRampToValueAtTime(f2, start + 0.09);
    o.detune.value = det;
    lfoG.connect(o.detune);
    const og = c.createGain();
    og.gain.value = amp;
    o.connect(og);
    og.connect(sum);
    o.start(start);
    o.stop(start + total + 0.1);
  }
  const out = c.createGain();
  S.env(out.gain, start, g, { a, d: 0.15, sus: 0.8, h: Math.max(0, dur - 0.15), r });
  for (const [f, q, amp] of [[880, 2.5, 1], [2200, 3.5, 0.7], [3400, 3, 0.25]]) {
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = Math.max(f * S.fv, midiToHz(midi) * 1.5);
    bp.Q.value = q;
    const ga = c.createGain();
    ga.gain.value = amp * 2.2;
    sum.connect(bp);
    bp.connect(ga);
    ga.connect(out);
  }
  out.connect(dest);
  S.noise(dest, { t, dur: total, a, h: dur, r, g: g * 0.12, filt: [{ type: 'bandpass', f: 3200, q: 1.2 }] });
}

// Low brass/horn. Used for Neti and boss hits.
export function horn(S, dest, { t = 0, midi, dur = 1.5, g = 0.2, a = 0.16, r = 0.7, open = 1400, bend = 0 }) {
  const c = S.ctx;
  const start = S.t0 + t;
  const total = a + dur + r;
  const sum = c.createGain();
  sum.gain.value = 0.4;
  for (const [det, type, oct, amp] of [[-9, 'sawtooth', 0, 1], [8, 'sawtooth', 0, 1], [0, 'square', -12, 0.7]]) {
    const o = c.createOscillator();
    o.type = type;
    const f = midiToHz(midi + oct);
    o.frequency.setValueAtTime(f, start);
    if (bend) o.frequency.exponentialRampToValueAtTime(f * 2 ** (bend / 12), start + total);
    o.detune.value = det;
    const og = c.createGain();
    og.gain.value = amp;
    o.connect(og);
    og.connect(sum);
    o.start(start);
    o.stop(start + total + 0.1);
  }
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = 2.2;
  lp.frequency.setValueAtTime(open * 0.18, start);
  lp.frequency.exponentialRampToValueAtTime(open * S.fv, start + a + 0.12);
  lp.frequency.exponentialRampToValueAtTime(open * 0.3, start + total);
  const out = c.createGain();
  S.env(out.gain, start, g, { a, d: 0.25, sus: 0.75, h: Math.max(0, dur - 0.25), r });
  sum.connect(lp);
  lp.connect(out);
  out.connect(dest);
}

// Percussion. kind: doum (low), tek (high rim), ka (ghost), slap, tom (big taiko-like drum), shake (sistrum)
export function drum(S, dest, { t = 0, kind = 'doum', vel = 1, tone = 1 }) {
  const v = Math.max(0.05, vel);
  switch (kind) {
    case 'doum':
      S.tone(dest, { t, f: 165 * tone, f2: 78 * tone, tf: 0.1, type: 'sine', g: 0.8 * v, a: 0.002, r: 0.38, vary: false });
      S.tone(dest, { t, f: 110 * tone, f2: 70 * tone, tf: 0.14, type: 'triangle', g: 0.35 * v, a: 0.002, r: 0.22, vary: false });
      S.noise(dest, { t, dur: 0.05, g: 0.28 * v, filt: [{ type: 'lowpass', f: 1100, q: 0.7 }] });
      break;
    case 'tek':
      S.noise(dest, { t, dur: 0.07, g: 0.34 * v, a: 0.001, filt: [{ type: 'bandpass', f: 3400 * tone, q: 1.6 }] });
      S.tone(dest, { t, f: 520 * tone, f2: 330 * tone, tf: 0.04, type: 'sine', g: 0.2 * v, a: 0.001, r: 0.08, vary: false });
      break;
    case 'ka':
      S.noise(dest, { t, dur: 0.05, g: 0.22 * v, a: 0.001, filt: [{ type: 'bandpass', f: 2300 * tone, q: 1.2 }] });
      S.tone(dest, { t, f: 300 * tone, f2: 220 * tone, tf: 0.03, type: 'sine', g: 0.12 * v, a: 0.001, r: 0.06, vary: false });
      break;
    case 'slap':
      S.noise(dest, { t, dur: 0.1, g: 0.4 * v, a: 0.001, filt: [{ type: 'bandpass', f: 1700 * tone, q: 0.9 }] });
      S.tone(dest, { t, f: 260 * tone, f2: 150 * tone, tf: 0.06, type: 'triangle', g: 0.3 * v, a: 0.001, r: 0.16, vary: false });
      break;
    case 'tom':
      S.tone(dest, { t, f: 118 * tone, f2: 42 * tone, tf: 0.2, type: 'sine', g: 1.0 * v, a: 0.002, r: 0.75, vary: false });
      S.tone(dest, { t, f: 180 * tone, f2: 84 * tone, tf: 0.1, type: 'triangle', g: 0.3 * v, a: 0.002, r: 0.3, vary: false });
      S.noise(dest, { t, dur: 0.09, g: 0.4 * v, filt: [{ type: 'lowpass', f: 700, q: 0.7 }] });
      break;
    case 'shake':
      S.noise(dest, { t, dur: 0.06, g: 0.1 * v, a: 0.008, filt: [{ type: 'highpass', f: 6500, q: 0.7 }] });
      break;
    default:
  }
}

// Lyre / harp pluck with a gentle body.
export function lyre(S, dest, { t = 0, midi, g = 0.25, bright = 0.5, dur = 2.2, damp = 0.996 }) {
  S.pluck(dest, { t, midi, g, bright, dur, damp, filt: [{ type: 'lowpass', f: 5200, q: 0.5 }] });
}
