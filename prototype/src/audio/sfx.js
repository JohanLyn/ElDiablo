// SFX library: every sound is a recipe `(S, d, o)` that builds nodes with the Synth
// toolkit into destination `d`. `o` carries per-play parameters (vel, crit, kind...).
// Table entries: { type (voice-limit group), max (simultaneous), gap (min seconds between
// starts), dur (seconds the voice lives), send (reverb), gain, bus, vary (pitch jitter), fn }.
import { choir, horn, drum } from './instruments.js';
import { midiToHz } from './theory.js';

const R = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// ---- reusable fragments --------------------------------------------------------------------
function thump(S, d, { t = 0, f = 140, f2 = 48, g = 0.8, r = 0.22 } = {}) {
  S.tone(d, { t, f, f2, tf: r * 0.6, type: 'sine', g, a: 0.002, r });
  // upper harmonic so the punch is still audible on laptop speakers that cannot reproduce the sub
  S.tone(d, { t, f: f * 2.1, f2: f2 * 2.6, tf: r * 0.4, type: 'triangle', g: g * 0.4, a: 0.002, r: r * 0.55 });
}
function whoosh(S, d, { t = 0, dur = 0.2, f = 600, f2 = 2800, q = 0.9, g = 0.3, peak = 0.35 } = {}) {
  S.noise(d, { t, dur, a: dur * peak, r: dur * (1 - peak), g, filt: [{ type: 'bandpass', f, f2, tf: dur, q }] });
}
function coin(S, d, { t = 0, g = 0.2, pitch = 1 } = {}) {
  const f = R(2300, 3200) * pitch;
  S.tone(d, { t, f, type: 'sine', g, a: 0.001, r: 0.16, vary: false });
  S.tone(d, { t: t + 0.012, f: f * 1.505, type: 'sine', g: g * 0.8, a: 0.001, r: 0.22, vary: false });
  S.tone(d, { t, f: f * 2.74, type: 'sine', g: g * 0.25, a: 0.001, r: 0.06, vary: false });
  S.click(d, { t, g: g * 0.8, f: 5000 });
}
function sparkle(S, d, { t = 0, n = 5, base = 1760, span = 12, g = 0.06, gap = 0.05, r = 0.4 } = {}) {
  for (let i = 0; i < n; i++) S.tone(d, { t: t + i * gap + Math.random() * 0.012, f: base * 2 ** ((Math.floor(Math.random() * span)) / 12), type: 'sine', g, a: 0.002, r, vary: false });
}
// Chord of bells (MIDI list) with optional arpeggio spacing
function bells(S, d, midis, { t = 0, gap = 0.09, g = 0.14, dur = 1.4 } = {}) {
  midis.forEach((m, i) => S.bell(d, { t: t + i * gap, f: midiToHz(m), g, dur, vary: false }));
}

// ---- hit flavours ---------------------------------------------------------------------------
function hitFlesh(S, d, o) {
  const v = o.vel ?? 1;
  thump(S, d, { f: R(130, 165), f2: 46, g: 0.85 * v, r: 0.2 });
  S.noise(d, { dur: 0.07, a: 0.001, g: 0.5 * v, filt: [{ type: 'bandpass', f: 1900, f2: 600, tf: 0.06, q: 0.8 }] }); // crunch
  S.noise(d, { t: 0.01, dur: 0.16, a: 0.004, g: 0.32 * v, color: 'pink', filt: [{ type: 'lowpass', f: 1000, f2: 280, tf: 0.15 }] }); // wet
  S.tone(d, { f: 230, f2: 110, tf: 0.09, type: 'triangle', g: 0.25 * v, a: 0.001, r: 0.1 });
  if (o.kind === 'demon') S.tone(d, { f: 95, f2: 60, type: 'sawtooth', g: 0.18 * v, a: 0.003, r: 0.17, filt: [{ type: 'lowpass', f: 420, q: 1 }] });
}
function hitStone(S, d, o) {
  const v = o.vel ?? 1;
  thump(S, d, { f: 105, f2: 38, g: 0.9 * v, r: 0.28 });
  S.noise(d, { dur: 0.05, a: 0.001, g: 0.55 * v, filt: [{ type: 'highpass', f: 2600, q: 0.7 }] }); // crack
  S.tone(d, { f: R(320, 420), f2: 140, tf: 0.1, type: 'square', g: 0.14 * v, a: 0.001, r: 0.12, filt: [{ type: 'lowpass', f: 900 }] }); // tock
  for (let i = 0; i < 3; i++) S.click(d, { t: 0.03 + Math.random() * 0.14, g: 0.3 * v, f: R(1800, 4200), q: 2 }); // pebbles
  S.noise(d, { t: 0.02, dur: 0.22, g: 0.25 * v, color: 'brown', filt: [{ type: 'lowpass', f: 380 }] });
}
function hitGhost(S, d, o) {
  const v = o.vel ?? 1;
  thump(S, d, { f: 120, f2: 70, g: 0.4 * v, r: 0.1 });
  S.noise(d, { dur: 0.3, a: 0.02, g: 0.3 * v, filt: [{ type: 'bandpass', f: 2600, f2: 1100, tf: 0.3, q: 2.2 }] });
  for (const f of [880, 1318]) S.tone(d, { f, f2: f * 0.82, tf: 0.35, type: 'sine', g: 0.14 * v, a: 0.01, r: 0.34, det: R(-15, 15), vib: { rate: 9, depth: 25, delay: 0.02 } });
}
function hitChitin(S, d, o) {
  const v = o.vel ?? 1;
  thump(S, d, { f: 150, f2: 60, g: 0.6 * v, r: 0.14 });
  S.noise(d, { dur: 0.04, a: 0.001, g: 0.6 * v, filt: [{ type: 'bandpass', f: 4200, q: 1.4 }] });
  S.noise(d, { t: 0.035, dur: 0.04, a: 0.001, g: 0.4 * v, filt: [{ type: 'bandpass', f: 2800, q: 1.4 }] });
  S.tone(d, { f: 1300, f2: 420, tf: 0.05, type: 'square', g: 0.1 * v, a: 0.001, r: 0.07, filt: [{ type: 'lowpass', f: 3000 }] });
}
function hitBoss(S, d, o) {
  const v = o.vel ?? 1;
  hitStone(S, d, { vel: v * 0.9 });
  S.bell(d, { f: 392, g: 0.07 * v, dur: 0.8, vary: false }); // gilded armour ring
}
function critRing(S, d, v = 1) {
  S.bell(d, { f: R(1150, 1300), g: 0.2 * v, dur: 0.9, ratios: [1, 2.32, 3.9, 5.7], amps: [1, 0.6, 0.35, 0.2], vary: false });
  S.noise(d, { dur: 0.05, a: 0.001, g: 0.35 * v, filt: [{ type: 'highpass', f: 5000 }] });
  S.tone(d, { f: 62, f2: 34, tf: 0.2, type: 'sine', g: 0.9 * v, a: 0.002, r: 0.38 });
}

// ---- enemy tells ---------------------------------------------------------------------------------
const WINDUPS = {
  gallu(S, d) { // guttural growl: rough low saw with 40 Hz amplitude chop
    S.tone(d, { f: 78, f2: 58, tf: 0.5, type: 'sawtooth', g: 0.3, a: 0.06, h: 0.3, r: 0.2, filt: [{ type: 'lowpass', f: 380, f2: 700, tf: 0.4, q: 3 }], vib: { rate: 38, depth: 80, delay: 0 } });
    S.noise(d, { dur: 0.55, a: 0.1, g: 0.2, color: 'pink', filt: [{ type: 'bandpass', f: 500, f2: 800, tf: 0.5, q: 1.5 }], am: { rate: 32, depth: 0.7 } });
  },
  utukku(S, d) { // thin ghostly moan
    for (const [f, dt] of [[392, -8], [411, 9]]) S.tone(d, { f, f2: f * 1.12, tf: 0.3, type: 'sine', g: 0.14, a: 0.1, r: 0.25, det: dt, vib: { rate: 6.5, depth: 30, delay: 0.05 } });
    S.noise(d, { dur: 0.35, a: 0.1, g: 0.1, filt: [{ type: 'bandpass', f: 1800, f2: 2600, tf: 0.3, q: 3 }] });
  },
  lilitu(S, d) { // whisper that tips into a shriek
    S.noise(d, { dur: 0.6, a: 0.25, r: 0.3, g: 0.22, filt: [{ type: 'bandpass', f: 2400, f2: 5200, tf: 0.55, q: 2.5 }] });
    S.tone(d, { f: 1100, f2: 2300, tf: 0.55, type: 'sawtooth', g: 0.07, a: 0.3, r: 0.25, filt: [{ type: 'bandpass', f: 2000, q: 3 }], vib: { rate: 11, depth: 45, delay: 0.1 } });
    S.tone(d, { f: 1121, f2: 2350, tf: 0.55, type: 'sine', g: 0.08, a: 0.3, r: 0.25, vib: { rate: 8, depth: 30, delay: 0.1 } });
  },
  scorpion(S, d) { // bow creak: stuttering pitch sweep
    S.tone(d, { f: 150, f2: 340, tf: 0.5, type: 'sawtooth', g: 0.14, a: 0.04, r: 0.2, filt: [{ type: 'bandpass', f: 700, f2: 1500, tf: 0.5, q: 4 }], vib: { rate: 24, depth: 60, delay: 0 } });
    S.noise(d, { dur: 0.5, a: 0.05, g: 0.1, filt: [{ type: 'bandpass', f: 1400, q: 5 }], am: { rate: 17, depth: 0.8, type: 'square' } });
  },
  asag(S, d) { // grinding rock
    S.noise(d, { dur: 0.95, a: 0.25, r: 0.3, g: 0.6, color: 'brown', filt: [{ type: 'lowpass', f: 260, f2: 420, tf: 0.9, q: 2 }], am: { rate: 14, depth: 0.8 } });
    S.noise(d, { dur: 0.9, a: 0.2, r: 0.3, g: 0.14, filt: [{ type: 'bandpass', f: 900, f2: 450, tf: 0.9, q: 5 }], am: { rate: 21, depth: 0.9, type: 'square' } });
    S.tone(d, { f: 46, f2: 38, type: 'square', g: 0.18, a: 0.4, r: 0.4, filt: [{ type: 'lowpass', f: 140 }] });
  },
  neti(S, d) { // inhaled horn
    horn(S, d, { midi: 29, dur: 0.5, a: 0.45, r: 0.3, g: 0.34, open: 900 });
    S.noise(d, { dur: 0.9, a: 0.5, g: 0.18, color: 'brown', filt: [{ type: 'lowpass', f: 200, f2: 500, tf: 0.8 }] });
  },
};

const ATTACKS = {
  gallu(S, d) { whoosh(S, d, { dur: 0.16, f: 1000, f2: 3200, g: 0.42 }); S.tone(d, { f: 110, f2: 60, type: 'sawtooth', g: 0.2, a: 0.004, r: 0.14, filt: [{ type: 'lowpass', f: 450 }] }); },
  utukku(S, d) { whoosh(S, d, { dur: 0.12, f: 2200, f2: 4800, g: 0.22 }); S.tone(d, { f: 1000, f2: 600, type: 'sine', g: 0.08, a: 0.004, r: 0.14 }); },
  lilitu(S, d) { S.tone(d, { f: 1800, f2: 600, tf: 0.2, type: 'sawtooth', g: 0.14, a: 0.003, r: 0.22, filt: [{ type: 'bandpass', f: 1600, q: 2.5 }] }); whoosh(S, d, { dur: 0.2, f: 2500, f2: 800, g: 0.2 }); },
  scorpion(S, d) { S.tone(d, { f: 220, f2: 110, tf: 0.05, type: 'triangle', g: 0.5, a: 0.001, r: 0.1 }); S.click(d, { g: 0.5, f: 1800, q: 1.2, dur: 0.02 }); },
  asag(S, d) { whoosh(S, d, { dur: 0.4, f: 250, f2: 700, g: 0.55, peak: 0.6 }); thump(S, d, { t: 0.2, f: 70, f2: 35, g: 0.45, r: 0.3 }); },
  neti(S, d) { whoosh(S, d, { dur: 0.5, f: 220, f2: 900, g: 0.7, peak: 0.55 }); thump(S, d, { t: 0.2, f: 60, f2: 30, g: 0.7, r: 0.4 }); },
};

const DEATHS = {
  gallu(S, d, o) {
    S.tone(d, { f: 130, f2: 38, tf: 0.55, type: 'sawtooth', g: 0.38, a: 0.01, r: 0.6, filt: [{ type: 'lowpass', f: 700, f2: 150, tf: 0.55, q: 2 }], vib: { rate: 30, depth: 60, delay: 0 } });
    S.noise(d, { dur: 0.35, a: 0.003, g: 0.4, color: 'pink', filt: [{ type: 'lowpass', f: 1400, f2: 250, tf: 0.3 }] });
    thump(S, d, { t: 0.08, f: 90, f2: 36, g: 0.5, r: 0.3 });
  },
  utukku(S, d) {
    S.tone(d, { f: 780, f2: 220, tf: 0.7, type: 'sine', g: 0.2, a: 0.02, r: 0.7, vib: { rate: 8, depth: 40, delay: 0 } });
    S.tone(d, { f: 1180, f2: 330, tf: 0.7, type: 'sine', g: 0.1, a: 0.02, r: 0.7, det: 14, vib: { rate: 7, depth: 40, delay: 0 } });
    S.noise(d, { dur: 0.8, a: 0.05, g: 0.16, filt: [{ type: 'bandpass', f: 4000, f2: 1200, tf: 0.8, q: 1.5 }] });
    sparkle(S, d, { t: 0.1, n: 4, base: 2200, g: 0.04, r: 0.5 });
  },
  lilitu(S, d) {
    S.tone(d, { f: 2300, f2: 280, tf: 0.55, type: 'sawtooth', g: 0.17, a: 0.01, r: 0.6, filt: [{ type: 'bandpass', f: 1800, f2: 500, tf: 0.5, q: 2.5 }], vib: { rate: 13, depth: 60, delay: 0 } });
    S.noise(d, { t: 0.1, dur: 0.6, a: 0.04, g: 0.22, filt: [{ type: 'bandpass', f: 3200, f2: 1000, tf: 0.6, q: 2 }] });
    thump(S, d, { t: 0.05, f: 100, f2: 40, g: 0.4 });
  },
  scorpion(S, d) {
    for (let i = 0; i < 4; i++) S.click(d, { t: i * 0.035 + Math.random() * 0.02, g: 0.5, f: R(1500, 4200), q: 1.6, dur: 0.02 });
    S.noise(d, { t: 0.1, dur: 0.5, a: 0.02, g: 0.2, filt: [{ type: 'highpass', f: 4000 }] }); // hiss
    thump(S, d, { f: 120, f2: 45, g: 0.6, r: 0.25 });
    S.noise(d, { t: 0.05, dur: 0.25, g: 0.3, color: 'pink', filt: [{ type: 'lowpass', f: 900, f2: 250, tf: 0.25 }] });
  },
  asag(S, d) {
    S.noise(d, { dur: 1.1, a: 0.02, r: 1.0, g: 0.9, color: 'brown', filt: [{ type: 'lowpass', f: 420, f2: 90, tf: 1.0 }], am: { rate: 9, depth: 0.6 } });
    thump(S, d, { f: 85, f2: 28, g: 1.0, r: 0.6 });
    for (let i = 0; i < 7; i++) S.noise(d, { t: 0.05 + i * 0.09 + Math.random() * 0.06, dur: 0.07, a: 0.001, g: 0.4, filt: [{ type: 'bandpass', f: R(300, 1800), q: 2.5 }] });
  },
  neti(S, d, o) {
    horn(S, d, { midi: 31, dur: 1.8, a: 0.2, r: 2.2, g: 0.35, open: 1100, bend: -7 });
    choir(S, d, { midis: [38, 45, 50, 53], dur: 2, a: 0.9, r: 3.2, g: 0.12, vowel: 'oh' });
    thump(S, d, { f: 75, f2: 24, g: 1.0, r: 1.0 });
    S.noise(d, { dur: 2.2, a: 0.05, r: 2, g: 0.8, color: 'brown', filt: [{ type: 'lowpass', f: 380, f2: 70, tf: 2.2 }], am: { rate: 6, depth: 0.5 } });
    S.bell(d, { t: 0.6, f: 196, g: 0.16, dur: 4 });
    S.bell(d, { t: 1.4, f: 147, g: 0.12, dur: 4 });
    if (o?.elite) thump(S, d, { t: 0.1, f: 60, f2: 24, g: 0.4 });
  },
};

// ---- hazards (by colour class) -----------------------------------------------------------------------
const BLASTS = {
  fire(S, d) {
    thump(S, d, { f: 80, f2: 32, g: 0.9, r: 0.45 });
    S.noise(d, { dur: 0.7, a: 0.02, g: 0.7, color: 'pink', filt: [{ type: 'lowpass', f: 1800, f2: 220, tf: 0.65 }] });
    S.noise(d, { t: 0.1, dur: 0.5, a: 0.05, g: 0.2, filt: [{ type: 'bandpass', f: 3000, q: 1 }], am: { rate: 45, depth: 0.9 } }); // crackle
  },
  void(S, d) {
    S.tone(d, { f: 180, f2: 45, tf: 0.5, type: 'sine', g: 0.8, a: 0.03, r: 0.5 });
    S.tone(d, { f: 360, f2: 90, tf: 0.5, type: 'sawtooth', g: 0.1, a: 0.03, r: 0.5, filt: [{ type: 'lowpass', f: 900, f2: 200, tf: 0.5 }], vib: { rate: 18, depth: 100, delay: 0 } });
    S.noise(d, { dur: 0.5, a: 0.03, g: 0.25, filt: [{ type: 'bandpass', f: 1500, f2: 300, tf: 0.5, q: 2 }] });
    S.tone(d, { t: 0.02, f: 2400, f2: 400, tf: 0.3, type: 'sine', g: 0.08, a: 0.002, r: 0.3 });
  },
  stone(S, d) {
    thump(S, d, { f: 70, f2: 28, g: 1.0, r: 0.5 });
    S.noise(d, { dur: 0.06, a: 0.001, g: 0.7, filt: [{ type: 'highpass', f: 2500 }] });
    S.noise(d, { dur: 0.6, a: 0.01, g: 0.7, color: 'brown', filt: [{ type: 'lowpass', f: 500, f2: 120, tf: 0.55 }] });
    for (let i = 0; i < 4; i++) S.click(d, { t: 0.05 + Math.random() * 0.25, g: 0.3, f: R(900, 3500), q: 2 });
  },
  electric(S, d) {
    S.noise(d, { dur: 0.05, a: 0.001, g: 0.8, filt: [{ type: 'highpass', f: 3000 }] });
    S.tone(d, { f: 1800, f2: 160, tf: 0.14, type: 'sawtooth', g: 0.2, a: 0.001, r: 0.16, filt: [{ type: 'lowpass', f: 5000 }] });
    S.noise(d, { t: 0.02, dur: 0.3, a: 0.01, g: 0.3, filt: [{ type: 'bandpass', f: 2600, q: 1.5 }], am: { rate: 60, depth: 1, type: 'square' } });
    thump(S, d, { f: 100, f2: 40, g: 0.5 });
  },
};

// ---- loot ------------------------------------------------------------------------------------------------
const LOOT = {
  common(S, d) { // dull clunk
    thump(S, d, { f: 190, f2: 110, g: 0.4, r: 0.1 });
    S.click(d, { g: 0.4, f: 1400, q: 1.5, dur: 0.03 });
    S.tone(d, { t: 0.02, f: 620, type: 'triangle', g: 0.1, a: 0.001, r: 0.12 });
  },
  magic(S, d) {
    thump(S, d, { f: 170, f2: 100, g: 0.3, r: 0.1 });
    bells(S, d, [79, 86], { gap: 0.1, g: 0.14, dur: 1.2 });
  },
  rare(S, d) {
    thump(S, d, { f: 160, f2: 90, g: 0.35, r: 0.12 });
    bells(S, d, [74, 78, 81, 86, 90], { gap: 0.075, g: 0.14, dur: 1.8 });
    sparkle(S, d, { t: 0.3, n: 4, base: 2600, g: 0.035, r: 0.5 });
  },
  legendary(S, d) {
    // Choir-like swell on a major-coloured chord with the flat second as a sigh, a tolling bell, a shimmer.
    choir(S, d, { midis: [50, 57, 62, 66], dur: 1.0, a: 1.0, r: 2.6, g: 0.2, vowel: 'ah' });
    choir(S, d, { t: 0.1, midis: [74, 81], dur: 0.9, a: 0.9, r: 2.4, g: 0.07, vowel: 'ah' });
    S.bell(d, { t: 0.55, f: midiToHz(50), g: 0.3, dur: 4 });
    S.bell(d, { t: 0.55, f: midiToHz(74), g: 0.12, dur: 3 });
    thump(S, d, { t: 0.5, f: 68, f2: 30, g: 0.8, r: 0.9 });
    S.noise(d, { t: 0.2, dur: 2.5, a: 1.2, r: 1.2, g: 0.07, filt: [{ type: 'highpass', f: 5500 }] });
    sparkle(S, d, { t: 0.7, n: 9, base: 1568, span: 19, g: 0.045, gap: 0.09, r: 0.9 });
  },
};

// ---- the table --------------------------------------------------------------------------------------------
const sw = (combo) => (S, d) => {
  if (combo === 1) {
    whoosh(S, d, { dur: 0.16, f: 700, f2: 3200, g: 0.34 });
    whoosh(S, d, { t: 0.01, dur: 0.12, f: 5200, f2: 7000, g: 0.07, q: 0.6 });
  } else if (combo === 2) {
    whoosh(S, d, { dur: 0.17, f: 3400, f2: 650, g: 0.34, peak: 0.3 });
    whoosh(S, d, { t: 0.01, dur: 0.12, f: 6500, f2: 4200, g: 0.07, q: 0.6 });
  } else {
    whoosh(S, d, { dur: 0.3, f: 300, f2: 2200, g: 0.55, peak: 0.55 });
    whoosh(S, d, { dur: 0.22, f: 4200, f2: 6500, g: 0.1, q: 0.6 });
    S.tone(d, { t: 0.12, f: 130, f2: 52, tf: 0.2, type: 'sine', g: 0.6, a: 0.02, r: 0.25 });
    S.noise(d, { t: 0.14, dur: 0.18, g: 0.2, color: 'pink', filt: [{ type: 'lowpass', f: 700 }] });
  }
};

export const SFX = {
  // ---- hero
  swing1: { type: 'swing', max: 3, gap: 0.04, dur: 0.4, send: 0.1, gain: 0.8, fn: sw(1) },
  swing2: { type: 'swing', max: 3, gap: 0.04, dur: 0.4, send: 0.1, gain: 0.8, fn: sw(2) },
  swing3: { type: 'swing', max: 3, gap: 0.04, dur: 0.6, send: 0.15, gain: 1, fn: sw(3) },
  hitFlesh: { type: 'hit', max: 6, gap: 0.035, dur: 0.5, send: 0.18, gain: 0.95, fn: hitFlesh },
  hitDemon: { type: 'hit', max: 6, gap: 0.035, dur: 0.5, send: 0.18, gain: 0.95, fn: (S, d, o) => hitFlesh(S, d, { ...o, kind: 'demon' }) },
  hitStone: { type: 'hit', max: 6, gap: 0.035, dur: 0.6, send: 0.22, gain: 1, fn: hitStone },
  hitGhost: { type: 'hit', max: 6, gap: 0.035, dur: 0.6, send: 0.3, gain: 0.85, fn: hitGhost },
  hitChitin: { type: 'hit', max: 6, gap: 0.035, dur: 0.4, send: 0.15, gain: 0.95, fn: hitChitin },
  hitBoss: { type: 'hit', max: 6, gap: 0.035, dur: 1.0, send: 0.3, gain: 1, fn: hitBoss },
  crit: { type: 'crit', max: 3, gap: 0.06, dur: 1.2, send: 0.3, gain: 0.8, fn: (S, d, o) => critRing(S, d, o.vel ?? 1) },
  evade: {
    type: 'evade', max: 2, gap: 0.1, dur: 0.5, send: 0.1, gain: 0.8, fn: (S, d) => {
      whoosh(S, d, { dur: 0.2, f: 1400, f2: 5000, g: 0.3, q: 0.7 });
      S.noise(d, { t: 0.02, dur: 0.28, a: 0.06, g: 0.2, color: 'pink', filt: [{ type: 'lowpass', f: 1500, f2: 500, tf: 0.28 }], am: { rate: 22, depth: 0.5 } }); // cloth
      thump(S, d, { t: 0.2, f: 100, f2: 55, g: 0.3, r: 0.1 });
    },
  },
  potion: {
    type: 'potion', max: 1, gap: 0.2, dur: 1.2, send: 0.2, gain: 0.8, fn: (S, d) => {
      for (let i = 0; i < 3; i++) S.tone(d, { t: i * 0.085, f: 260 + i * 40, f2: 520 + i * 70, tf: 0.06, type: 'sine', g: 0.28, a: 0.004, r: 0.09, vary: false }); // glug
      S.noise(d, { dur: 0.3, a: 0.02, g: 0.1, color: 'pink', filt: [{ type: 'bandpass', f: 700, q: 2 }], am: { rate: 14, depth: 0.7 } });
      [79, 83, 86, 91].forEach((m, i) => S.tone(d, { t: 0.3 + i * 0.07, f: midiToHz(m), type: 'sine', g: 0.07, a: 0.004, r: 0.55, vary: false }));
      sparkle(S, d, { t: 0.35, n: 4, base: 3000, span: 7, g: 0.025, r: 0.4 });
    },
  },
  footstep: {
    type: 'footstep', max: 4, gap: 0.07, dur: 0.4, send: 0.1, gain: 0.5, fn: (S, d, o) => {
      const surf = o.surface ?? 'dirt';
      const heavy = o.heavy ? 1 : 0;
      const f = { dirt: 900, sand: 650, mud: 420, stone: 1700, dust: 800 }[surf] ?? 900;
      S.noise(d, { dur: 0.09 + heavy * 0.05, a: 0.004, g: 0.5, color: 'pink', filt: [{ type: 'bandpass', f: f * R(0.85, 1.2), f2: f * 0.5, tf: 0.1, q: 0.8 }] });
      thump(S, d, { f: heavy ? 70 : 105, f2: heavy ? 36 : 60, g: heavy ? 0.9 : 0.45, r: heavy ? 0.25 : 0.1 });
      if (surf === 'stone') S.click(d, { g: 0.25, f: 2600, q: 2 });
      if (surf === 'mud') S.noise(d, { t: 0.04, dur: 0.12, g: 0.25, filt: [{ type: 'bandpass', f: 300, f2: 900, tf: 0.1, q: 3 }] });
      if (heavy) S.noise(d, { t: 0.02, dur: 0.3, g: 0.3, color: 'brown', filt: [{ type: 'lowpass', f: 260 }] });
    },
  },
  hurt: {
    type: 'hurt', max: 2, gap: 0.12, dur: 0.6, send: 0.15, gain: 0.95, fn: (S, d, o) => {
      const v = o.vel ?? 1;
      thump(S, d, { f: 120, f2: 42, g: 0.9 * v, r: 0.26 });
      S.noise(d, { dur: 0.12, a: 0.002, g: 0.45 * v, color: 'pink', filt: [{ type: 'lowpass', f: 1200, f2: 300, tf: 0.1 }] });
      S.tone(d, { t: 0.01, f: 170, f2: 100, tf: 0.16, type: 'sawtooth', g: 0.2 * v, a: 0.01, r: 0.2, filt: [{ type: 'bandpass', f: 700, f2: 450, tf: 0.2, q: 2 }] }); // grunt
    },
  },
  heartbeat: {
    type: 'heart', max: 2, gap: 0.2, dur: 0.6, send: 0.05, gain: 1, fn: (S, d, o) => {
      const v = o.vel ?? 1;
      S.tone(d, { f: 62, f2: 40, tf: 0.1, type: 'sine', g: 0.9 * v, a: 0.006, r: 0.18, vary: false });
      S.tone(d, { t: 0.2, f: 52, f2: 36, tf: 0.1, type: 'sine', g: 0.65 * v, a: 0.006, r: 0.2, vary: false });
    },
  },
  playerDeath: {
    type: 'death', max: 1, gap: 1, dur: 5.5, send: 0.6, gain: 1, fn: (S, d) => {
      S.tone(d, { f: 58, f2: 36, tf: 4, type: 'sawtooth', g: 0.42, a: 0.15, h: 2.5, r: 2, filt: [{ type: 'lowpass', f: 900, f2: 110, tf: 4.5, q: 2 }], vary: false });
      S.tone(d, { f: 41, f2: 30, tf: 4, type: 'sine', g: 0.8, a: 0.1, h: 2.5, r: 2.2, vary: false });
      thump(S, d, { f: 80, f2: 28, g: 1, r: 0.9 });
      S.bell(d, { t: 0.1, f: 196, g: 0.2, dur: 4.5, vary: false });
      S.bell(d, { t: 1.6, f: 147, g: 0.14, dur: 4.5, vary: false });
      S.noise(d, { dur: 4, a: 0.3, r: 3, g: 0.3, color: 'brown', filt: [{ type: 'lowpass', f: 500, f2: 80, tf: 4 }] });
    },
  },
  // ---- skills
  javelinThrow: {
    type: 'javelin', max: 2, gap: 0.05, dur: 0.9, send: 0.25, gain: 0.85, fn: (S, d) => {
      whoosh(S, d, { dur: 0.28, f: 900, f2: 4200, g: 0.34, q: 0.8, peak: 0.3 });
      S.tone(d, { f: 800, f2: 2600, tf: 0.1, type: 'sine', g: 0.14, a: 0.002, r: 0.12 });
      S.bell(d, { t: 0.02, f: 1568, g: 0.13, dur: 0.9, ratios: [1, 2.4, 3.93, 6.1], amps: [1, 0.5, 0.3, 0.15], vary: false });
      S.bell(d, { t: 0.09, f: 2093, g: 0.07, dur: 0.7, ratios: [1, 2.4], amps: [1, 0.4], vary: false });
    },
  },
  javelinHit: {
    type: 'javelinHit', max: 3, gap: 0.04, dur: 0.9, send: 0.3, gain: 0.9, fn: (S, d) => {
      S.noise(d, { dur: 0.05, a: 0.001, g: 0.55, filt: [{ type: 'highpass', f: 4000 }] });
      S.tone(d, { f: 2400, f2: 380, tf: 0.12, type: 'triangle', g: 0.25, a: 0.001, r: 0.14 });
      thump(S, d, { f: 130, f2: 50, g: 0.55, r: 0.18 });
      S.bell(d, { f: 1760, g: 0.12, dur: 0.8, vary: false });
    },
  },
  tetherHit_lapis: {
    type: 'tether', max: 4, gap: 0.05, dur: 0.4, send: 0.3, gain: 0.55, fn: (S, d) => {
      S.tone(d, { f: R(2300, 2900), type: 'sine', g: 0.2, a: 0.001, r: 0.3 });
      S.tone(d, { f: R(3500, 4300), type: 'sine', g: 0.1, a: 0.001, r: 0.15 });
      S.noise(d, { dur: 0.03, a: 0.001, g: 0.3, filt: [{ type: 'highpass', f: 5500 }] });
    },
  },
  tetherHit_fire: {
    type: 'tether', max: 4, gap: 0.05, dur: 0.4, send: 0.2, gain: 0.55, fn: (S, d) => {
      S.noise(d, { dur: 0.2, a: 0.002, g: 0.5, filt: [{ type: 'bandpass', f: 2600, f2: 900, tf: 0.2, q: 0.8 }], am: { rate: 70, depth: 1 } });
      thump(S, d, { f: 150, f2: 70, g: 0.35, r: 0.1 });
    },
  },
  tetherHit_chain: {
    type: 'tether', max: 4, gap: 0.05, dur: 0.4, send: 0.25, gain: 0.55, fn: (S, d) => {
      for (const f of [R(640, 760), R(1720, 2000), R(3100, 3500)]) S.tone(d, { f, type: 'square', g: 0.06, a: 0.001, r: 0.16, filt: [{ type: 'bandpass', f, q: 6 }] });
      S.click(d, { g: 0.5, f: 3800, q: 1 });
      S.noise(d, { t: 0.03, dur: 0.1, g: 0.14, filt: [{ type: 'highpass', f: 4200 }], am: { rate: 90, depth: 1, type: 'square' } });
    },
  },
  tetherHit_bulwark: {
    type: 'tether', max: 4, gap: 0.05, dur: 0.5, send: 0.3, gain: 0.6, fn: (S, d) => {
      S.tone(d, { f: 190, f2: 120, tf: 0.15, type: 'sine', g: 0.6, a: 0.002, r: 0.28 });
      S.tone(d, { f: 380, f2: 240, tf: 0.15, type: 'triangle', g: 0.15, a: 0.002, r: 0.2 });
      S.bell(d, { f: 330, g: 0.06, dur: 0.5, vary: false });
    },
  },
  snap: {
    type: 'snap', max: 2, gap: 0.08, dur: 0.9, send: 0.3, gain: 0.95, fn: (S, d, o) => {
      S.tone(d, { f: 200, f2: 2000, tf: 0.15, type: 'sawtooth', g: 0.2, a: 0.01, r: 0.05, filt: [{ type: 'lowpass', f: 3000, q: 2 }] });
      S.noise(d, { t: 0.15, dur: 0.07, a: 0.001, g: 0.7, filt: [{ type: 'highpass', f: 2500 }] });
      S.tone(d, { t: 0.15, f: 1500, f2: 150, tf: 0.2, type: 'square', g: 0.14, a: 0.001, r: 0.2, filt: [{ type: 'lowpass', f: 4000 }] });
      thump(S, d, { t: 0.15, f: 100, f2: 38, g: 0.8, r: 0.3 });
      const tint = { lapis: 1760, fire: 440, chain: 987, bulwark: 330 }[o.aspect] ?? 1200;
      S.bell(d, { t: 0.16, f: tint, g: 0.08, dur: 0.7, vary: false });
    },
  },
  lightning: {
    type: 'lightning', max: 3, gap: 0.05, dur: 3.2, send: 0.5, gain: 0.9, fn: (S, d) => {
      S.noise(d, { dur: 0.045, a: 0.0008, g: 0.9, filt: [{ type: 'highpass', f: 1500 }] });
      S.noise(d, { t: 0.02, dur: 0.35, a: 0.002, g: 0.4, filt: [{ type: 'bandpass', f: 3200, f2: 800, tf: 0.3, q: 0.8 }], am: { rate: 55, depth: 0.9 } });
      S.tone(d, { f: 2800, f2: 120, tf: 0.1, type: 'sawtooth', g: 0.13, a: 0.001, r: 0.12, filt: [{ type: 'lowpass', f: 6000 }] });
      // rolling thunder
      S.noise(d, { t: 0.1, dur: 2.8, a: 0.12, r: 2.6, g: 1.0, color: 'brown', filt: [{ type: 'lowpass', f: 520, f2: 80, tf: 2.6 }], am: { rate: 7 + Math.random() * 3, depth: 0.6 } });
      thump(S, d, { t: 0.05, f: 70, f2: 26, g: 0.9, r: 0.9 });
    },
  },
  stormCast: {
    type: 'stormCast', max: 1, gap: 0.3, dur: 1.2, send: 0.4, gain: 0.7, fn: (S, d) => {
      S.tone(d, { f: 110, f2: 440, tf: 0.6, type: 'sawtooth', g: 0.12, a: 0.3, r: 0.4, filt: [{ type: 'lowpass', f: 400, f2: 2800, tf: 0.6, q: 3 }] });
      whoosh(S, d, { dur: 0.7, f: 500, f2: 5000, g: 0.25, peak: 0.8 });
      sparkle(S, d, { t: 0.2, n: 6, base: 2000, g: 0.04, gap: 0.06, r: 0.3 });
    },
  },
  leapStart: {
    type: 'leap', max: 2, gap: 0.1, dur: 0.9, send: 0.25, gain: 0.85, fn: (S, d) => {
      whoosh(S, d, { dur: 0.42, f: 380, f2: 3200, g: 0.4, q: 0.7, peak: 0.6 });
      S.noise(d, { dur: 0.4, a: 0.05, g: 0.2, filt: [{ type: 'bandpass', f: 1800, q: 1 }], am: { rate: 26, depth: 0.8 } }); // wing flutter
      S.tone(d, { f: 220, f2: 700, tf: 0.35, type: 'triangle', g: 0.1, a: 0.05, r: 0.2 });
      sparkle(S, d, { t: 0.05, n: 3, base: 2400, g: 0.03 });
    },
  },
  leapLand: {
    type: 'boom', max: 2, gap: 0.15, dur: 1.4, send: 0.35, gain: 1, fn: (S, d) => {
      thump(S, d, { f: 100, f2: 28, g: 1.0, r: 0.7 });
      S.noise(d, { dur: 0.06, a: 0.001, g: 0.5, filt: [{ type: 'highpass', f: 2200 }] });
      S.noise(d, { dur: 0.7, a: 0.01, g: 0.7, color: 'brown', filt: [{ type: 'lowpass', f: 520, f2: 110, tf: 0.65 }] });
      S.noise(d, { t: 0.06, dur: 0.5, a: 0.03, g: 0.2, color: 'pink', filt: [{ type: 'bandpass', f: 1100, f2: 400, tf: 0.5, q: 0.7 }] }); // dust
    },
  },
  aegis: {
    type: 'aegis', max: 1, gap: 0.3, dur: 2.2, send: 0.4, gain: 0.9, fn: (S, d) => {
      S.bell(d, { f: 880, g: 0.18, dur: 1.8, ratios: [1, 1.5, 2, 2.76, 4.07], amps: [1, 0.5, 0.6, 0.3, 0.15], vary: false });
      S.tone(d, { f: 55, f2: 80, tf: 0.5, type: 'sine', g: 0.8, a: 0.04, r: 0.9 });
      S.tone(d, { f: 110, type: 'triangle', g: 0.2, a: 0.05, r: 0.8, filt: [{ type: 'lowpass', f: 400 }] });
      S.noise(d, { dur: 0.9, a: 0.02, g: 0.12, filt: [{ type: 'highpass', f: 6000 }] });
      sparkle(S, d, { t: 0.1, n: 5, base: 2200, g: 0.04, r: 0.6 });
    },
  },
  pyreCast: {
    type: 'pyre', max: 1, gap: 0.5, dur: 2.2, send: 0.4, gain: 0.95, fn: (S, d) => {
      thump(S, d, { f: 90, f2: 30, g: 1.0, r: 0.8 });
      S.noise(d, { dur: 1.8, a: 0.15, r: 1.5, g: 0.75, color: 'pink', filt: [{ type: 'lowpass', f: 2200, f2: 300, tf: 1.8 }] });
      S.noise(d, { t: 0.1, dur: 1.5, a: 0.1, r: 1.2, g: 0.16, filt: [{ type: 'bandpass', f: 3200, q: 1 }], am: { rate: 40, depth: 1 } });
      horn(S, d, { midi: 38, dur: 0.6, a: 0.15, r: 1.0, g: 0.12, open: 700 });
    },
  },
  pyrePulse: {
    type: 'pyrePulse', max: 2, gap: 0.2, dur: 0.7, send: 0.2, gain: 0.55, fn: (S, d) => {
      S.noise(d, { dur: 0.45, a: 0.04, g: 0.55, color: 'pink', filt: [{ type: 'lowpass', f: 1700, f2: 250, tf: 0.42 }] });
      thump(S, d, { f: 70, f2: 38, g: 0.5, r: 0.3 });
      S.noise(d, { t: 0.05, dur: 0.3, a: 0.01, g: 0.12, filt: [{ type: 'highpass', f: 4500 }], am: { rate: 55, depth: 1 } });
    },
  },
  aspectChange: {
    type: 'ui', max: 2, gap: 0.05, dur: 0.8, send: 0.3, gain: 0.55, fn: (S, d, o) => {
      const base = { lapis: 84, fire: 72, chain: 77, bulwark: 69 }[o.aspect] ?? 76;
      S.bell(d, { f: midiToHz(base), g: 0.14, dur: 0.7, vary: false });
      S.bell(d, { t: 0.07, f: midiToHz(base + 7), g: 0.08, dur: 0.6, vary: false });
      S.noise(d, { dur: 0.15, a: 0.03, g: 0.08, filt: [{ type: 'bandpass', f: 3000, f2: 1500, q: 1.5 }] });
    },
  },
  // ---- enemies
  windup: { type: 'windup', max: 4, gap: 0.05, dur: 1.2, send: 0.25, gain: 0.75, fn: (S, d, o) => (WINDUPS[o.etype] ?? WINDUPS.gallu)(S, d, o) },
  attack: { type: 'attack', max: 4, gap: 0.05, dur: 0.8, send: 0.2, gain: 0.8, fn: (S, d, o) => (ATTACKS[o.etype] ?? ATTACKS.gallu)(S, d, o) },
  projectile: {
    type: 'projectile', max: 3, gap: 0.08, dur: 0.8, send: 0.15, gain: 0.7, fn: (S, d) => {
      S.tone(d, { f: 140, f2: 90, tf: 0.05, type: 'triangle', g: 0.3, a: 0.001, r: 0.18 }); // bow twang
      S.click(d, { g: 0.3, f: 2200, q: 1.5 });
      S.tone(d, { t: 0.03, f: 2200, f2: 1100, tf: 0.5, type: 'sine', g: 0.07, a: 0.04, r: 0.4 }); // whistle
      whoosh(S, d, { t: 0.02, dur: 0.4, f: 3000, f2: 1500, g: 0.12, q: 2 });
    },
  },
  blast_fire: { type: 'hazard', max: 4, gap: 0.05, dur: 1, send: 0.3, gain: 0.9, fn: BLASTS.fire },
  blast_void: { type: 'hazard', max: 4, gap: 0.05, dur: 0.9, send: 0.4, gain: 0.85, fn: BLASTS.void },
  blast_stone: { type: 'hazard', max: 4, gap: 0.05, dur: 1, send: 0.3, gain: 0.95, fn: BLASTS.stone },
  blast_electric: { type: 'hazard', max: 4, gap: 0.05, dur: 0.6, send: 0.3, gain: 0.85, fn: BLASTS.electric },
  netiRoar: {
    type: 'boss', max: 1, gap: 1, dur: 4, send: 0.5, gain: 1, fn: (S, d) => {
      horn(S, d, { midi: 26, dur: 1.4, a: 0.35, r: 1.8, g: 0.42, open: 1100, bend: -2 });
      horn(S, d, { t: 0.05, midi: 33, dur: 1.2, a: 0.4, r: 1.6, g: 0.22, open: 900 });
      S.noise(d, { dur: 2.4, a: 0.3, r: 1.8, g: 0.35, color: 'pink', filt: [{ type: 'bandpass', f: 220, f2: 600, tf: 1.4, q: 1.2 }], am: { rate: 26, depth: 0.7 } }); // growl
      thump(S, d, { t: 0.3, f: 60, f2: 24, g: 1, r: 1.2 });
      S.noise(d, { t: 0.1, dur: 3, a: 0.4, r: 2, g: 0.5, color: 'brown', filt: [{ type: 'lowpass', f: 300, f2: 60, tf: 3 }] });
    },
  },
  netiPhase: {
    type: 'boss', max: 1, gap: 1, dur: 5, send: 0.55, gain: 1, fn: (S, d) => {
      horn(S, d, { midi: 26, dur: 1.2, a: 0.3, r: 1.6, g: 0.4, open: 1300 });
      horn(S, d, { t: 0.9, midi: 29, dur: 1.2, a: 0.2, r: 1.8, g: 0.36, open: 1500 });
      choir(S, d, { midis: [38, 45, 50, 56], dur: 2, a: 1.0, r: 2.5, g: 0.15, vowel: 'oh' });
      thump(S, d, { f: 62, f2: 24, g: 1, r: 1.1 });
      thump(S, d, { t: 0.9, f: 62, f2: 24, g: 0.9, r: 1.1 });
      S.noise(d, { dur: 3.5, a: 0.2, r: 2.5, g: 0.6, color: 'brown', filt: [{ type: 'lowpass', f: 320, f2: 60, tf: 3.5 }], am: { rate: 12, depth: 0.6 } });
      for (let i = 0; i < 5; i++) S.noise(d, { t: 0.2 + i * 0.25, dur: 0.1, g: 0.3, filt: [{ type: 'bandpass', f: R(300, 1500), q: 2 }] }); // falling rubble
    },
  },
  // ---- loot / progression
  coin: {
    type: 'coin', max: 4, gap: 0.03, dur: 0.5, send: 0.2, gain: 0.7, fn: (S, d, o) => {
      const n = o.n ?? 1;
      for (let i = 0; i < n; i++) coin(S, d, { t: i * R(0.035, 0.06), g: 0.16, pitch: o.pitch ?? 1 });
    },
  },
  lootCommon: { type: 'loot', max: 3, gap: 0.05, dur: 0.6, send: 0.2, gain: 0.8, fn: LOOT.common },
  lootMagic: { type: 'loot', max: 3, gap: 0.05, dur: 1.8, send: 0.35, gain: 0.8, fn: LOOT.magic },
  lootRare: { type: 'loot', max: 3, gap: 0.05, dur: 2.6, send: 0.4, gain: 0.85, fn: LOOT.rare },
  lootLegendary: { type: 'loot', max: 2, gap: 0.2, dur: 4.5, send: 0.5, gain: 1, fn: LOOT.legendary },
  pickup: {
    type: 'pickup', max: 3, gap: 0.04, dur: 0.4, send: 0.1, gain: 0.7, fn: (S, d, o) => {
      S.click(d, { g: 0.5, f: 2000, q: 1.2, dur: 0.02 });
      S.tone(d, { f: 560, f2: 840, tf: 0.05, type: 'triangle', g: 0.2, a: 0.002, r: 0.1 });
      if (o.rarity === 'rare' || o.rarity === 'legendary') S.bell(d, { t: 0.04, f: 1568, g: 0.07, dur: 0.6, vary: false });
      else if (o.rarity === 'magic') S.bell(d, { t: 0.04, f: 1175, g: 0.05, dur: 0.4, vary: false });
    },
  },
  orb: {
    type: 'pickup', max: 3, gap: 0.04, dur: 0.6, send: 0.25, gain: 0.7, fn: (S, d) => {
      S.tone(d, { f: 500, f2: 1000, tf: 0.05, type: 'sine', g: 0.25, a: 0.002, r: 0.1 });
      S.bell(d, { t: 0.05, f: 1760, g: 0.1, dur: 0.5, vary: false });
    },
  },
  levelUp: {
    type: 'stinger', max: 2, gap: 0.5, dur: 6, send: 0.55, gain: 1, fn: (S, d) => {
      choir(S, d, { midis: [50, 57, 62, 66, 69], dur: 1.2, a: 0.25, r: 3, g: 0.2, vowel: 'ah' });
      thump(S, d, { f: 70, f2: 30, g: 0.9, r: 0.8 });
      // shimmering arpeggio over D hijaz: D Eb F# G A Bb D
      [74, 75, 78, 79, 81, 86, 90, 93].forEach((m, i) => S.bell(d, { t: 0.12 + i * 0.085, f: midiToHz(m), g: 0.13, dur: 2.2, vary: false }));
      S.noise(d, { t: 0.2, dur: 2.4, a: 0.5, r: 1.7, g: 0.09, filt: [{ type: 'highpass', f: 6000 }] });
      sparkle(S, d, { t: 0.8, n: 12, base: 2093, span: 19, g: 0.04, gap: 0.08, r: 0.8 });
      horn(S, d, { t: 0.05, midi: 50, dur: 0.8, a: 0.1, r: 1.5, g: 0.1, open: 1800 });
    },
  },
  questComplete: {
    type: 'stinger', max: 2, gap: 0.5, dur: 4, send: 0.45, gain: 1, fn: (S, d) => {
      [[62, 0], [69, 0.22], [74, 0.44], [78, 0.66]].forEach(([m, t], i) => horn(S, d, { t, midi: m, dur: i === 3 ? 0.9 : 0.12, a: 0.03, r: i === 3 ? 1.6 : 0.3, g: 0.12, open: 2400 }));
      for (let i = 0; i < 8; i++) drum(S, d, { t: i * 0.055, kind: 'tek', vel: 0.5 + i * 0.05 });
      drum(S, d, { t: 0.66, kind: 'tom', vel: 0.9 });
      S.bell(d, { t: 0.66, f: midiToHz(86), g: 0.14, dur: 2.5, vary: false });
      choir(S, d, { t: 0.6, midis: [50, 57, 62, 66], dur: 0.6, a: 0.2, r: 2, g: 0.12 });
    },
  },
  questAccept: {
    type: 'stinger', max: 1, gap: 0.5, dur: 2, send: 0.4, gain: 0.7, fn: (S, d) => {
      S.bell(d, { f: midiToHz(74), g: 0.12, dur: 1.2, vary: false });
      S.bell(d, { t: 0.14, f: midiToHz(81), g: 0.12, dur: 1.6, vary: false });
      S.tone(d, { f: 146.8, type: 'sine', g: 0.2, a: 0.1, r: 1.0, vary: false });
    },
  },
  questProgress: {
    type: 'stinger', max: 1, gap: 0.3, dur: 1.2, send: 0.35, gain: 0.5, fn: (S, d) => {
      S.bell(d, { f: midiToHz(83), g: 0.1, dur: 0.9, vary: false });
      S.bell(d, { t: 0.1, f: midiToHz(86), g: 0.08, dur: 0.9, vary: false });
    },
  },
  region: {
    type: 'stinger', max: 1, gap: 2, dur: 3, send: 0.6, gain: 0.5, fn: (S, d, o) => {
      const root = o.midi ?? 62;
      choir(S, d, { midis: [root - 12, root - 5], dur: 0.5, a: 0.8, r: 2, g: 0.07, vowel: 'oo', breath: 0.003 });
      S.bell(d, { t: 0.6, f: midiToHz(root + 12), g: 0.05, dur: 2, vary: false });
    },
  },
  waypoint: {
    type: 'stinger', max: 1, gap: 1, dur: 4, send: 0.6, gain: 0.9, fn: (S, d) => {
      S.tone(d, { f: 146.8, type: 'sine', g: 0.3, a: 0.7, h: 0.6, r: 1.6, vary: false });
      S.tone(d, { f: 293.7, type: 'triangle', g: 0.07, a: 0.8, h: 0.5, r: 1.6, filt: [{ type: 'lowpass', f: 900 }], vary: false });
      choir(S, d, { midis: [50, 57, 62], dur: 0.8, a: 0.8, r: 2, g: 0.08, vowel: 'oo', breath: 0.004 });
      S.bell(d, { t: 0.8, f: 880, g: 0.2, dur: 3, vary: false });
      sparkle(S, d, { t: 1.0, n: 4, base: 2093, span: 12, g: 0.03, r: 0.8 });
    },
  },
  shrine: {
    type: 'stinger', max: 1, gap: 1, dur: 4, send: 0.55, gain: 0.9, fn: (S, d, o) => {
      const t0 = { 'power': 62, 'haste': 65, 'fortune': 67 }[o.skind] ?? 64;
      choir(S, d, { midis: [t0 - 12, t0 - 5, t0], dur: 0.8, a: 0.7, r: 2.2, g: 0.13, vowel: 'oh' });
      sparkle(S, d, { t: 0.2, n: 10, base: 1568, span: 14, g: 0.045, gap: 0.07, r: 0.9 });
      S.bell(d, { t: 0.15, f: midiToHz(t0 + 12), g: 0.14, dur: 2.5, vary: false });
    },
  },
  chestOpen: {
    type: 'chest', max: 2, gap: 0.2, dur: 1.8, send: 0.3, gain: 0.9, fn: (S, d) => {
      S.tone(d, { f: 120, f2: 210, tf: 0.5, type: 'sawtooth', g: 0.14, a: 0.05, r: 0.15, filt: [{ type: 'bandpass', f: 520, f2: 950, tf: 0.5, q: 5 }], vib: { rate: 19, depth: 70, delay: 0 } }); // creak
      S.noise(d, { dur: 0.5, a: 0.06, g: 0.1, filt: [{ type: 'bandpass', f: 700, f2: 1300, tf: 0.5, q: 6 }], am: { rate: 23, depth: 0.7, type: 'square' } });
      thump(S, d, { t: 0.5, f: 140, f2: 60, g: 0.6, r: 0.16 });
      S.click(d, { t: 0.5, g: 0.5, f: 1800, q: 1 });
      for (let i = 0; i < 6; i++) coin(S, d, { t: 0.62 + i * R(0.05, 0.09), g: 0.12, pitch: R(0.85, 1.2) });
      sparkle(S, d, { t: 0.65, n: 5, base: 2600, g: 0.03 });
    },
  },
  portal: {
    type: 'portal', max: 1, gap: 0.5, dur: 2, send: 0.5, gain: 0.95, fn: (S, d) => {
      whoosh(S, d, { dur: 1.3, f: 160, f2: 5000, g: 0.5, q: 0.8, peak: 0.7 });
      S.tone(d, { f: 90, f2: 900, tf: 1.0, type: 'sawtooth', g: 0.09, a: 0.4, r: 0.6, filt: [{ type: 'lowpass', f: 600, f2: 3500, tf: 1 }] });
      thump(S, d, { t: 1.0, f: 70, f2: 28, g: 0.9, r: 0.7 });
      sparkle(S, d, { t: 0.6, n: 9, base: 1760, span: 19, g: 0.04, gap: 0.06, r: 0.7 });
      S.noise(d, { t: 0.9, dur: 0.9, a: 0.02, g: 0.2, filt: [{ type: 'bandpass', f: 4000, f2: 600, tf: 0.9, q: 0.8 }] });
    },
  },
  // ---- UI (uiBus, dry)
  uiMove: {
    type: 'ui', bus: 'ui', max: 3, gap: 0.025, dur: 0.15, send: 0, gain: 0.5, vary: 0.04, fn: (S, d) => {
      S.tone(d, { f: 1250, f2: 880, tf: 0.03, type: 'sine', g: 0.2, a: 0.001, r: 0.045 });
      S.click(d, { g: 0.1, f: 4000, dur: 0.008 });
    },
  },
  uiConfirm: {
    type: 'ui', bus: 'ui', max: 3, gap: 0.05, dur: 0.5, send: 0, gain: 0.7, vary: 0.02, fn: (S, d) => {
      S.tone(d, { f: 523.3, type: 'sine', g: 0.2, a: 0.002, r: 0.25 });
      S.tone(d, { t: 0.045, f: 784, type: 'sine', g: 0.2, a: 0.002, r: 0.32 });
      S.tone(d, { t: 0.045, f: 1568, type: 'sine', g: 0.04, a: 0.002, r: 0.2 });
      S.tone(d, { f: 160, f2: 100, tf: 0.05, type: 'triangle', g: 0.25, a: 0.001, r: 0.07 });
      S.click(d, { g: 0.15, f: 2500, dur: 0.01 });
    },
  },
  uiBack: {
    type: 'ui', bus: 'ui', max: 3, gap: 0.05, dur: 0.4, send: 0, gain: 0.6, vary: 0.02, fn: (S, d) => {
      S.tone(d, { f: 523.3, f2: 392, tf: 0.1, type: 'sine', g: 0.2, a: 0.002, r: 0.16 });
      S.tone(d, { t: 0.05, f: 392, f2: 294, tf: 0.1, type: 'sine', g: 0.15, a: 0.002, r: 0.2 });
      S.click(d, { g: 0.1, f: 2000, dur: 0.01 });
    },
  },
  uiOpen: {
    type: 'ui', bus: 'ui', max: 2, gap: 0.1, dur: 0.6, send: 0, gain: 0.6, vary: 0.03, fn: (S, d, o) => {
      const up = !o.close;
      S.noise(d, { dur: 0.26, a: 0.07, g: 0.2, color: 'pink', filt: [{ type: 'bandpass', f: up ? 600 : 1800, f2: up ? 1800 : 500, tf: 0.26, q: 0.8 }] });
      for (let i = 0; i < 3; i++) S.noise(d, { t: 0.03 + i * 0.045, dur: 0.05, a: 0.004, g: 0.06, filt: [{ type: 'highpass', f: 4500 }] }); // paper
      S.tone(d, { f: up ? 330 : 440, f2: up ? 440 : 330, tf: 0.2, type: 'sine', g: 0.07, a: 0.04, r: 0.2 });
    },
  },
  denied: {
    type: 'ui', bus: 'ui', max: 2, gap: 0.12, dur: 0.4, send: 0, gain: 0.55, vary: 0.02, fn: (S, d) => {
      S.tone(d, { f: 118, type: 'square', g: 0.2, a: 0.004, h: 0.07, r: 0.08, filt: [{ type: 'lowpass', f: 500 }] });
      S.tone(d, { t: 0.1, f: 98, type: 'square', g: 0.2, a: 0.004, h: 0.07, r: 0.1, filt: [{ type: 'lowpass', f: 450 }] });
    },
  },

  // ---- Night of the Gidim (events gidimRise / gidimDeath / gidimRecoil)
  gidimRise: { // a breathy whisper that climbs as the ground gives way
    type: 'gidimRise', max: 2, gap: 0.15, dur: 2.7, send: 0.55, gain: 0.8, vary: 0.1, fn: (S, d) => {
      S.noise(d, { dur: 1.9, a: 1.1, r: 0.7, g: 0.3, filt: [{ type: 'bandpass', f: 700, f2: 3200, tf: 1.8, q: 2.2 }], am: { rate: 5.5, depth: 0.5 } }); // breath
      S.noise(d, { t: 0.2, dur: 1.5, a: 0.9, r: 0.5, g: 0.1, color: 'pink', filt: [{ type: 'highpass', f: 3500 }] }); // air
      for (const [f, f2, g] of [[420, 640, 0.07], [630, 1000, 0.05]]) S.tone(d, { f, f2, tf: 1.6, type: 'sine', g, a: 0.9, r: 0.7, det: R(-12, 12), vib: { rate: 6, depth: 22, delay: 0.3 } }); // whispered vowels
      S.tone(d, { f: 52, f2: 74, tf: 1.8, type: 'sine', g: 0.22, a: 1.0, r: 0.7 }); // the ground, giving way
      sparkle(S, d, { t: 1.4, n: 3, base: 1800, span: 7, g: 0.03, r: 0.5 });
    },
  },
  gidimDeath: { // glass breaking, a wail falling away
    type: 'gidimDeath', max: 3, gap: 0.05, dur: 1.5, send: 0.4, gain: 0.85, vary: 0.08, fn: (S, d) => {
      S.noise(d, { dur: 0.09, a: 0.001, g: 0.5, filt: [{ type: 'highpass', f: 3600, q: 0.7 }] }); // crack
      for (let i = 0; i < 7; i++) S.bell(d, { t: i * 0.028 + Math.random() * 0.02, f: R(1500, 4200), g: 0.07, dur: 0.7, ratios: [1, 2.4, 4.1], amps: [1, 0.5, 0.25], vary: false }); // shards
      S.tone(d, { f: 660, f2: 180, tf: 0.5, type: 'sine', g: 0.16, a: 0.01, r: 0.55, vib: { rate: 8, depth: 35, delay: 0 } });
      S.noise(d, { t: 0.04, dur: 0.5, a: 0.01, g: 0.18, filt: [{ type: 'bandpass', f: 5200, f2: 1800, tf: 0.5, q: 1.2 }] });
    },
  },
  gidimRecoil: { // a hiss as the sanctuary pushes it back
    type: 'gidimRecoil', max: 2, gap: 0.3, dur: 0.95, send: 0.3, gain: 0.7, vary: 0.1, fn: (S, d) => {
      S.noise(d, { dur: 0.6, a: 0.05, r: 0.5, g: 0.4, filt: [{ type: 'highpass', f: 3200, q: 0.8 }, { type: 'bandpass', f: 6500, f2: 4200, tf: 0.5, q: 0.9 }], am: { rate: 38, depth: 0.35 } });
      S.tone(d, { f: 900, f2: 420, tf: 0.4, type: 'sawtooth', g: 0.05, a: 0.03, r: 0.35, filt: [{ type: 'bandpass', f: 1500, q: 3 }], vib: { rate: 14, depth: 50, delay: 0 } });
      S.noise(d, { dur: 0.12, a: 0.003, g: 0.18, color: 'pink', filt: [{ type: 'lowpass', f: 600 }] }); // the snap back
    },
  },
};
// Enemy death sounds are generated per type and registered as `die_<type>`.
for (const k of Object.keys(DEATHS)) {
  SFX[`die_${k}`] = { type: 'die', max: 4, gap: 0.04, dur: k === 'neti' ? 6 : k === 'asag' ? 1.6 : 1.1, send: k === 'neti' ? 0.5 : 0.25, gain: k === 'neti' ? 1 : 0.9, fn: DEATHS[k] };
}

// Loudness calibration in dB, measured offline (see the audio measurement notes) so that sounds of
// equal importance land at similar levels. Applied on top of each entry's `gain`.
export const TRIMS = {
  'swing1': 7,
  'swing2': 6,
  'swing3': -5.5,
  'hitFlesh': 7.5,
  'hitDemon': 6.5,
  'hitStone': 7,
  'hitGhost': 8.5,
  'hitChitin': 9,
  'hitBoss': 7.5,
  'crit': 5,
  'evade': -0.5,
  'potion': -0.5,
  'footstep:light': 4,
  'footstep:heavy': 2.5,
  'hurt': 8,
  'heartbeat': -6.5,
  'playerDeath': -8,
  'javelinThrow': 3,
  'javelinHit': 4.5,
  'tetherHit_lapis': 8,
  'tetherHit_fire': 6,
  'tetherHit_chain': 3,
  'tetherHit_bulwark': 0,
  'snap': -9.5,
  'lightning': -1.5,
  'stormCast': 3.5,
  'leapStart': 2.5,
  'leapLand': 3,
  'aegis': -4.5,
  'pyreCast': 0,
  'pyrePulse': 2.5,
  'aspectChange': 2,
  'windup:gallu': -4.5,
  'windup:utukku': 1,
  'windup:lilitu': 2.5,
  'windup:scorpion': 17,
  'windup:asag': 2,
  'windup:neti': 4.5,
  'attack:gallu': 4.5,
  'attack:utukku': 8.5,
  'attack:lilitu': 9.5,
  'attack:scorpion': 11,
  'attack:asag': -1,
  'attack:neti': -1.5,
  'projectile': 6,
  'blast_fire': 3,
  'blast_void': 0.5,
  'blast_stone': 3.5,
  'blast_electric': 7.5,
  'netiRoar': -1,
  'netiPhase': -1,
  'coin': 9.5,
  'lootCommon': 7.5,
  'lootMagic': -2,
  'lootRare': -2.5,
  'lootLegendary': -3,
  'pickup': 10,
  'orb': 2,
  'levelUp': 1,
  'questComplete': -4.5,
  'questAccept': -1,
  'questProgress': 2.5,
  'region': 0.5,
  'waypoint': -4.5,
  'shrine': 1,
  'chestOpen': -4,
  'portal': -7,
  'uiMove': 10,
  'uiConfirm': -2,
  'uiBack': 3,
  'uiOpen': 2.5,
  'denied': -5.5,
  'die_gallu': -1.5,
  'die_utukku': 3.5,
  'die_lilitu': 1,
  'die_scorpion': 0,
  'die_asag': 3,
  'die_neti': 2,
  'gidimRise': 0,
  'gidimDeath': 0,
  'gidimRecoil': 0,
};
export function trimKey(name, o) {
  if (o?.etype) return `${name}:${o.etype}`;
  if (name === 'footstep') return `footstep:${o?.heavy ? 'heavy' : 'light'}`;
  return name;
}
export function trimGain(name, o) {
  const db = TRIMS[trimKey(name, o)] ?? TRIMS[name] ?? 0;
  return 10 ** (db / 20);
}
