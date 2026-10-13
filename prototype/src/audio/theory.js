// Pure helpers for the audio system: music theory, spatial maths, DSP sample
// generators, music-state decisions. Nothing in here touches Web Audio, so it
// is all unit-tested in test/audio.test.js.

// ---- notes and scales ----------------------------------------------------------------
export const SCALES = {
  phrygianDominant: [0, 1, 4, 5, 7, 8, 10], // "hijaz": the classic ancient/Near-Eastern colour
  doubleHarmonic: [0, 1, 4, 5, 7, 8, 11],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  hungarianMinor: [0, 2, 3, 6, 7, 8, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  locrian: [0, 1, 3, 5, 6, 8, 10],
};

export const midiToHz = (m) => 440 * 2 ** ((m - 69) / 12);
export const hzToMidi = (f) => 69 + 12 * Math.log2(f / 440);
export const dbToGain = (db) => 10 ** (db / 20);
export const gainToDb = (g) => 20 * Math.log10(Math.max(g, 1e-9));
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// MIDI note of a scale degree. Degrees may be negative or exceed the scale length (they wrap by octaves).
export function scaleNote(root, scale, degree) {
  const n = scale.length;
  const oct = Math.floor(degree / n);
  const idx = ((degree % n) + n) % n;
  return root + oct * 12 + scale[idx];
}

// Open voicing built on a scale degree: root, fifth, octave (+ colour tone). Strict triads are avoided on purpose;
// open fifths stay ambiguous over the drone, which is what we want from ancient modes.
export function openVoicing(root, scale, degree, colour = true) {
  const notes = [scaleNote(root, scale, degree), scaleNote(root, scale, degree + 4), scaleNote(root, scale, degree + 7)];
  if (colour) notes.push(scaleNote(root, scale, degree + 9));
  return notes;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rnd() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pickWeighted(rnd, items, weights) {
  let total = 0;
  for (const w of weights) total += w;
  let r = rnd() * total;
  for (let i = 0; i < items.length; i++) { r -= weights[i]; if (r <= 0) return items[i]; }
  return items[items.length - 1];
}

// Even spread of `pulses` over `steps` (Euclidean-style rhythm).
export function euclid(pulses, steps, rotate = 0) {
  const out = new Array(steps).fill(false);
  if (pulses <= 0) return out;
  for (let i = 0; i < pulses; i++) out[(Math.floor((i * steps) / pulses) + rotate) % steps] = true;
  return out;
}

// ---- generative melody ------------------------------------------------------------------
// Random-walk phrases in scale degrees with a remembered motif, so melodies feel like they
// "say" something and come back to it, then rest on the tonic / fifth / flat-second colour.
export class MelodyGen {
  constructor(rnd, { low = -3, high = 9 } = {}) {
    this.rnd = rnd;
    this.low = low;
    this.high = high;
    this.deg = 2;
    this.motif = null;
  }

  makeMotif() {
    const r = this.rnd;
    const len = 3 + Math.floor(r() * 2);
    const steps = [];
    for (let i = 0; i < len; i++) steps.push(pickWeighted(r, [-2, -1, 0, 1, 2, 3], [1, 3, 1, 3, 2, 1]));
    this.motif = steps;
  }

  // Returns [{deg, len}] where len is in steps (16th notes); total length is `bars` bars.
  phrase(bars = 1, { ending = true, long = false } = {}) {
    const r = this.rnd;
    if (!this.motif || r() < 0.25) this.makeMotif();
    const lens = long ? [4, 6, 8, 4, 12] : [2, 2, 4, 3, 1, 4, 6];
    const out = [];
    let total = 0;
    const target = bars * 16;
    let motifPos = 0;
    let useMotif = r() < 0.7;
    while (total < target - 1) {
      let step;
      if (useMotif && motifPos < this.motif.length) step = this.motif[motifPos++];
      else step = pickWeighted(r, [-3, -2, -1, 0, 1, 2, 3], [0.5, 1.5, 3, 1, 3, 1.5, 0.5]);
      this.deg = clamp(this.deg + step, this.low, this.high);
      let len = lens[Math.floor(r() * lens.length)];
      if (total + len > target) len = target - total;
      out.push({ deg: this.deg, len });
      total += len;
      if (motifPos >= this.motif.length) useMotif = r() < 0.3;
    }
    if (ending && out.length) {
      const last = out[out.length - 1];
      // Resolve: mostly the tonic, sometimes the fifth, rarely the flat second (the "ancient" sigh).
      const goal = pickWeighted(r, [0, 4, 1, 7], [5, 2.5, 1, 1.5]);
      last.deg = clamp(goal, this.low, this.high);
      this.deg = last.deg;
    }
    return out;
  }
}

// ---- Karplus-Strong plucked string ----------------------------------------------------
// Rendered once per (note, timbre) into a buffer and cached by the caller, because a
// feedback delay line shorter than 128 samples cannot be built from Web Audio nodes.
export function karplusStrong(rate, freq, dur, { brightness = 0.5, damping = 0.996, pluckPos = 0.28, seed = 7, pick = 0.5 } = {}) {
  const len = Math.max(1, Math.floor(rate * dur));
  const out = new Float32Array(len);
  const rnd = mulberry32(seed + Math.round(freq * 10));
  const P = rate / freq;
  const Pa = P - 0.5; // the averaging filter contributes half a sample of delay
  const N = Math.max(2, Math.floor(Pa));
  const F = Pa - N;
  const C = (1 - F) / (1 + F); // first-order allpass for the fractional part
  const M = N + 2;
  const ring = new Float32Array(M);
  // Excitation: noise, low-passed more for softer plucks (gut strings), comb-filtered by pick position.
  let lp = 0;
  const k = clamp(brightness, 0.05, 1);
  for (let i = 0; i < M; i++) {
    const x = rnd() * 2 - 1;
    lp += k * (x - lp);
    ring[i] = lp;
  }
  const pp = Math.max(1, Math.round(pluckPos * N));
  for (let i = M - 1; i >= pp; i--) ring[i] -= ring[i - pp] * pick;
  let apState = 0;
  let outPrev = 0;
  let w = 0;
  for (let n = 0; n < len; n++) {
    const a = ring[(w + M - N) % M];
    const b = ring[(w + M - N - 1) % M];
    const s = 0.5 * (a + b) * damping;
    const y = C * s + apState - C * outPrev;
    apState = s;
    outPrev = y;
    ring[w] = y;
    w = (w + 1) % M;
    out[n] = y;
  }
  // normalise, fade the tail
  let peak = 0;
  for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(out[i]));
  const fade = Math.min(len, Math.floor(rate * 0.06));
  const norm = peak > 0 ? 0.9 / peak : 1;
  for (let i = 0; i < len; i++) {
    let v = out[i] * norm;
    if (i > len - fade) v *= (len - i) / fade;
    out[i] = v;
  }
  return out;
}

// ---- reverb impulse response ----------------------------------------------------------------
// Exponentially decaying stereo noise whose high end dies faster than the lows, plus a few
// early reflections. seconds ~1.3 = open air, ~3.8 = big stone hall.
export function generateImpulse(rate, { seconds = 2, decayDb = 60, preDelay = 0.012, damp = 0.85, early = 6, seed = 1 } = {}) {
  const len = Math.floor(rate * seconds);
  const chans = [new Float32Array(len), new Float32Array(len)];
  for (let c = 0; c < 2; c++) {
    const rnd = mulberry32(seed * 977 + c * 131);
    const d = chans[c];
    const pre = Math.floor(rate * preDelay * (1 + c * 0.17));
    const k = (decayDb / 20) * Math.LN10 / seconds; // amplitude decay constant (1/s)
    let lp = 0;
    for (let i = pre; i < len; i++) {
      const t = (i - pre) / rate;
      const frac = t / seconds;
      const a = lerp(0.95, 1 - damp, Math.sqrt(frac)); // low-pass closes over time
      lp += a * ((rnd() * 2 - 1) - lp);
      d[i] = lp * Math.exp(-k * t) * (1 - Math.exp(-t * 90)); // soft onset
    }
    for (let e = 0; e < early; e++) {
      const idx = pre + Math.floor(rate * (0.008 + rnd() * 0.07 * (seconds > 2.5 ? 2 : 1)));
      if (idx < len) d[idx] += (rnd() < 0.5 ? -1 : 1) * (0.55 - e * 0.05) * (1 - c * 0.1);
    }
  }
  // normalise by energy so every IR is equally loud into the convolver
  let e = 0;
  for (const d of chans) for (let i = 0; i < len; i++) e += d[i] * d[i];
  const norm = e > 0 ? 1 / Math.sqrt(e / 2) : 1;
  for (const d of chans) for (let i = 0; i < len; i++) d[i] *= norm * 0.18;
  return chans;
}

// ---- spatialisation --------------------------------------------------------------------------
export const MAX_AUDIBLE = 35;

// dx,dz: source minus listener (metres). rx,rz: listener's right vector on the ground plane.
export function spatialize(dx, dz, rx = 1, rz = 0, maxDist = MAX_AUDIBLE) {
  const dist = Math.hypot(dx, dz);
  if (dist >= maxDist) return { audible: false, dist, gain: 0, pan: 0, lp: 0 };
  const side = dist > 0.001 ? (dx * rx + dz * rz) : 0;
  const pan = clamp(side / 14, -1, 1) * 0.85;
  const fade = 1 - smoothstep(maxDist * 0.72, maxDist, dist);
  const gain = fade / Math.sqrt(1 + (dist / 10) ** 2);
  const lp = clamp(16000 / (1 + dist / 5), 1500, 16000);
  return { audible: true, dist, gain, pan, lp };
}

// ---- voice limiting ---------------------------------------------------------------------------
// Pure bookkeeping: callers pass a kill() callback per voice. Voices expire at `end`.
export class VoiceLimiter {
  constructor(limits = {}, defaultMax = 4, globalMax = 40) {
    this.limits = limits;
    this.defaultMax = defaultMax;
    this.globalMax = globalMax;
    this.voices = [];
    this.lastStart = new Map();
    this.stolen = 0;
    this.rejected = 0;
  }

  prune(now) {
    if (!this.voices.length) return;
    this.voices = this.voices.filter((v) => v.end > now);
  }

  count(type) { let n = 0; for (const v of this.voices) if (v.type === type) n++; return n; }

  // Returns a voice record to fill in (voice.kill = fn), or null when the call must be dropped.
  acquire(type, now, dur = 1, minGap = 0) {
    this.prune(now);
    const last = this.lastStart.get(type) ?? -Infinity;
    if (now - last < minGap) { this.rejected++; return null; }
    const max = this.limits[type] ?? this.defaultMax;
    let same = 0;
    let oldest = null;
    for (const v of this.voices) if (v.type === type) { same++; if (!oldest) oldest = v; }
    if (same >= max && oldest) this.steal(oldest);
    if (this.voices.length >= this.globalMax) this.steal(this.voices[0]);
    const voice = { type, start: now, end: now + dur, kill: null };
    this.voices.push(voice);
    this.lastStart.set(type, now);
    return voice;
  }

  steal(v) {
    const i = this.voices.indexOf(v);
    if (i >= 0) this.voices.splice(i, 1);
    this.stolen++;
    try { v.kill?.(); } catch { /* voice already gone */ }
  }
}

// ---- decisions ----------------------------------------------------------------------------------
export const MENU_MODES = new Set(['menu', 'map', 'dialog']);

// Hazard colour (0xRRGGBB) -> which blast sound to use.
export function hazardKind(color) {
  const r = (color >> 16) & 255, g = (color >> 8) & 255, b = color & 255;
  if (b > 200 && r > 150 && g < 140) return 'void'; // purple (Lilitu)
  if (b > r && g > 150) return 'electric'; // pale blue (storm-touched)
  if (r > 200 && g >= 80 && b < 80) return 'fire'; // orange (molten)
  return 'stone'; // red slams (Asag, Neti)
}

// What music should be doing, from a snapshot of the game.
export function musicTargets(s) {
  let profile;
  if (!s.started) profile = 'title';
  else if (s.bossAggro) profile = 'boss';
  else if (s.inDungeon || s.region === 'dungeon') profile = 'dungeon';
  else profile = s.region || 'sunfields';
  const dead = !!s.dead || s.uiMode === 'death';
  const combat = s.started && (s.combatNearby || s.bossAggro) && !dead ? clamp(s.intensity ?? 1, 0.45, 1) : 0;
  let duckDb = 0;
  let lowpass = 20000;
  if (s.started && MENU_MODES.has(s.uiMode)) { duckDb = -6; lowpass = 2600; }
  else if (dead) { duckDb = -10; lowpass = 700; }
  return { profile, combat, boss: profile === 'boss' ? 1 : 0, duckDb, lowpass };
}

// 0.55..1 intensity from the number of engaged enemies and whether any is elite
export function combatIntensity(engaged, elite) {
  return clamp(0.55 + engaged * 0.07 + (elite ? 0.2 : 0), 0, 1);
}

// Slider (0..1) -> gain. Squared feels closer to loudness.
export const volumeCurve = (v) => clamp(Number.isFinite(v) ? v : 0, 0, 1) ** 2;

// Heart-beat rate (beats per second) from remaining life fraction (only used below 30%).
export function heartRate(frac) { return lerp(2.1, 1.1, clamp(frac / 0.3, 0, 1)); }
