import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SCALES, midiToHz, hzToMidi, scaleNote, openVoicing, mulberry32, euclid, MelodyGen, karplusStrong, generateImpulse,
  spatialize, MAX_AUDIBLE, VoiceLimiter, hazardKind, musicTargets, combatIntensity, volumeCurve, heartRate, dbToGain, gainToDb,
} from '../src/audio/theory.js';
import { SFX, TRIMS, trimGain } from '../src/audio/sfx.js';
import { PROFILES } from '../src/audio/music.js';
import { VOICE_LIMITS } from '../src/audio/audio.js';
import { ENVIRONMENTS } from '../src/audio/engine.js';

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('note maths: A4 is 440 Hz and midi/hz round-trip', () => {
  near(midiToHz(69), 440);
  near(midiToHz(57), 220);
  near(hzToMidi(midiToHz(50.5)), 50.5, 1e-9);
  near(dbToGain(-6.0206), 0.5, 1e-4);
  near(gainToDb(1), 0);
});

test('scales: degrees wrap by octaves and stay in the mode', () => {
  const pd = SCALES.phrygianDominant;
  assert.equal(scaleNote(50, pd, 0), 50);
  assert.equal(scaleNote(50, pd, 1), 51); // flat second
  assert.equal(scaleNote(50, pd, 2), 54); // major third
  assert.equal(scaleNote(50, pd, 7), 62); // octave
  assert.equal(scaleNote(50, pd, -1), 48); // seventh degree one octave down: 50 - 12 + 10
  for (const [name, sc] of Object.entries(SCALES)) {
    assert.equal(sc.length, 7, name);
    assert.equal(sc[0], 0);
    for (let i = 1; i < 7; i++) assert.ok(sc[i] > sc[i - 1], `${name} ascends`);
    assert.ok(sc[6] < 12);
  }
});

test('open voicings stack fifth and octave on the degree', () => {
  const v = openVoicing(50, SCALES.phrygianDominant, 0);
  assert.deepEqual(v.slice(0, 3), [50, 57, 62]);
  assert.equal(v.length, 4);
  assert.equal(openVoicing(50, SCALES.dorian, 0, false).length, 3);
});

test('seeded RNG is deterministic and in [0,1)', () => {
  const a = mulberry32(5), b = mulberry32(5);
  for (let i = 0; i < 50; i++) { const x = a(); assert.equal(x, b()); assert.ok(x >= 0 && x < 1); }
});

test('euclid spreads pulses evenly', () => {
  assert.equal(euclid(4, 16).filter(Boolean).length, 4);
  assert.deepEqual(euclid(4, 16).map((x, i) => (x ? i : -1)).filter((i) => i >= 0), [0, 4, 8, 12]);
  assert.equal(euclid(0, 8).some(Boolean), false);
});

test('melody phrases fill the bar, stay in range and land on a resolution tone', () => {
  const rnd = mulberry32(42);
  const gen = new MelodyGen(rnd, { low: -3, high: 9 });
  for (let k = 0; k < 40; k++) {
    const bars = 1 + (k % 2);
    const p = gen.phrase(bars, { long: k % 3 === 0 });
    assert.equal(p.reduce((s, n) => s + n.len, 0), bars * 16);
    for (const n of p) { assert.ok(n.deg >= -3 && n.deg <= 9); assert.ok(n.len >= 1); }
    assert.ok([0, 1, 4, 7].includes(p[p.length - 1].deg));
    // every produced pitch belongs to the scale
    for (const n of p) assert.ok(SCALES.doubleHarmonic.includes(((scaleNote(45, SCALES.doubleHarmonic, n.deg) - 45) % 12 + 12) % 12));
  }
});

function estimatePitch(buf, rate, lo, hi) {
  // autocorrelation over the first 0.25 s
  const n = Math.floor(rate * 0.25);
  let best = 0, bestLag = 0;
  for (let lag = Math.floor(rate / hi); lag <= Math.ceil(rate / lo); lag++) {
    let s = 0;
    for (let i = 0; i + lag < n; i++) s += buf[i] * buf[i + lag];
    if (s > best) { best = s; bestLag = lag; }
  }
  return rate / bestLag;
}

test('Karplus-Strong plucks are in tune, bounded and decay', () => {
  const rate = 44100;
  for (const f of [110, 220, 440, 880]) {
    const b = karplusStrong(rate, f, 1.5, { brightness: 0.6 });
    assert.equal(b.length, Math.floor(rate * 1.5));
    let peak = 0;
    for (const x of b) { assert.ok(Number.isFinite(x)); peak = Math.max(peak, Math.abs(x)); }
    assert.ok(peak <= 1 && peak > 0.5);
    const est = estimatePitch(b, rate, f * 0.8, f * 1.25);
    assert.ok(Math.abs(est / f - 1) < 0.012, `pitch ${f}: got ${est}`);
    const rms = (a, c) => { let s = 0; for (let i = a; i < c; i++) s += b[i] * b[i]; return Math.sqrt(s / (c - a)); };
    assert.ok(rms(0, 4000) > rms(40000, 44000) * 2, 'string loses energy');
    assert.ok(Math.abs(b[b.length - 1]) < 1e-3);
  }
});

test('impulse responses: stereo, finite, decaying, hall longer than open air', () => {
  const rate = 22050;
  const open = generateImpulse(rate, { seconds: 1.5, seed: 3 });
  const hall = generateImpulse(rate, { seconds: 3.8, seed: 11 });
  assert.equal(open.length, 2);
  assert.equal(open[0].length, Math.floor(rate * 1.5));
  assert.equal(hall[0].length, Math.floor(rate * 3.8));
  assert.ok(open[0].some((v, i) => v !== open[1][i]), 'channels decorrelated');
  for (const ir of [open, hall]) {
    for (const ch of ir) {
      let peak = 0;
      for (const x of ch) { assert.ok(Number.isFinite(x)); peak = Math.max(peak, Math.abs(x)); }
      assert.ok(peak < 1.5);
      const e = (a, b) => { let s = 0; for (let i = a; i < b; i++) s += ch[i] * ch[i]; return s; };
      const q = Math.floor(ch.length / 5);
      assert.ok(e(0, q) > e(4 * q, 5 * q) * 20, 'tail is much quieter than the start');
    }
  }
});

test('spatialize: cull beyond 35 m, nearer is louder, pan follows the camera right vector', () => {
  assert.equal(spatialize(40, 0).audible, false);
  assert.equal(spatialize(0, MAX_AUDIBLE).audible, false);
  const near1 = spatialize(2, 0), far1 = spatialize(20, 0);
  assert.ok(near1.gain > far1.gain && far1.audible);
  assert.ok(near1.lp > far1.lp);
  assert.ok(spatialize(8, 0, 1, 0).pan > 0.3);
  assert.ok(spatialize(-8, 0, 1, 0).pan < -0.3);
  near(spatialize(0, 8, 1, 0).pan, 0);
  assert.ok(Math.abs(spatialize(100, 0, 1, 0, 200).pan) <= 0.85 + 1e-9);
  near(spatialize(0, 0).gain, 1);
  assert.ok(spatialize(34.9, 0).gain < 0.05, 'fades out smoothly near the limit');
});

test('voice limiter steals the oldest voice of a type and honours min gaps', () => {
  const lim = new VoiceLimiter({ hit: 2 }, 4, 5);
  const killed = [];
  const mk = (type, now, dur = 1, gap = 0) => { const v = lim.acquire(type, now, dur, gap); if (v) v.kill = () => killed.push(v.start); return v; };
  mk('hit', 0); mk('hit', 0.1);
  assert.equal(lim.count('hit'), 2);
  mk('hit', 0.2);
  assert.deepEqual(killed, [0]);
  assert.equal(lim.count('hit'), 2);
  assert.equal(lim.stolen, 1);
  // min gap rejects fast repeats
  assert.equal(mk('ui', 5, 0.2, 0.05) !== null, true);
  assert.equal(mk('ui', 5.01, 0.2, 0.05), null);
  assert.equal(lim.rejected, 1);
  // expired voices are pruned
  lim.prune(100);
  assert.equal(lim.voices.length, 0);
  // global cap
  const g = new VoiceLimiter({}, 10, 3);
  for (let i = 0; i < 6; i++) g.acquire('a' + i, i * 0.01, 10);
  assert.equal(g.voices.length, 3);
});

test('hazard colours map to the right blast sound', () => {
  assert.equal(hazardKind(0xff6a1a), 'fire');
  assert.equal(hazardKind(0xb04dff), 'void');
  assert.equal(hazardKind(0x8fd3ff), 'electric');
  assert.equal(hazardKind(0xff3a2a), 'stone');
  assert.equal(hazardKind(0xff2a2a), 'stone');
});

test('music targets: title, regions, dungeon, boss, menus and death', () => {
  const base = { started: true, region: 'marsh', inDungeon: false, bossAggro: false, combatNearby: false, uiMode: null, dead: false };
  assert.equal(musicTargets({ ...base, started: false }).profile, 'title');
  assert.equal(musicTargets(base).profile, 'marsh');
  assert.equal(musicTargets(base).combat, 0);
  assert.equal(musicTargets({ ...base, inDungeon: true, region: 'dungeon' }).profile, 'dungeon');
  const boss = musicTargets({ ...base, inDungeon: true, bossAggro: true });
  assert.equal(boss.profile, 'boss');
  assert.equal(boss.boss, 1);
  assert.ok(boss.combat > 0);
  const fight = musicTargets({ ...base, combatNearby: true, intensity: 0.8 });
  assert.equal(fight.combat, 0.8);
  assert.equal(fight.boss, 0);
  const menu = musicTargets({ ...base, uiMode: 'menu' });
  assert.equal(menu.duckDb, -6);
  assert.ok(menu.lowpass < 5000);
  assert.equal(musicTargets({ ...base, uiMode: 'title', started: false }).duckDb, 0);
  const dead = musicTargets({ ...base, combatNearby: true, dead: true });
  assert.equal(dead.combat, 0);
  assert.ok(dead.duckDb < menu.duckDb);
});

test('intensity, volume curve and heartbeat rate behave', () => {
  assert.ok(combatIntensity(1, false) < combatIntensity(6, false));
  assert.ok(combatIntensity(2, true) > combatIntensity(2, false));
  assert.ok(combatIntensity(50, true) <= 1);
  assert.equal(volumeCurve(0), 0);
  assert.equal(volumeCurve(1), 1);
  near(volumeCurve(0.5), 0.25);
  assert.equal(volumeCurve(NaN), 0);
  assert.ok(heartRate(0.02) > heartRate(0.29));
});

test('every SFX recipe is well-formed and has a voice limit', () => {
  for (const [name, def] of Object.entries(SFX)) {
    assert.equal(typeof def.fn, 'function', name);
    assert.ok(def.dur > 0, name);
    assert.ok(def.type in VOICE_LIMITS, `${name}: type ${def.type} has no voice limit`);
    assert.ok(def.gain > 0, name);
  }
  // the events gameplay emits all have a sound behind them
  for (const n of ['swing1', 'swing2', 'swing3', 'hitFlesh', 'hitStone', 'hitGhost', 'crit', 'evade', 'potion', 'footstep', 'hurt', 'playerDeath',
    'javelinThrow', 'javelinHit', 'snap', 'lightning', 'leapStart', 'leapLand', 'aegis', 'pyrePulse', 'windup', 'attack', 'projectile',
    'blast_fire', 'blast_void', 'blast_stone', 'blast_electric', 'netiRoar', 'netiPhase', 'lootCommon', 'lootMagic', 'lootRare', 'lootLegendary',
    'pickup', 'coin', 'levelUp', 'questComplete', 'waypoint', 'shrine', 'chestOpen', 'portal', 'uiMove', 'uiConfirm', 'uiBack', 'uiOpen', 'denied',
    'tetherHit_lapis', 'tetherHit_fire', 'tetherHit_chain', 'tetherHit_bulwark', 'die_gallu', 'die_utukku', 'die_lilitu', 'die_scorpion', 'die_asag', 'die_neti']) {
    assert.ok(SFX[n], `missing sound ${n}`);
  }
  assert.ok(Math.abs(gainToDb(trimGain('hitFlesh'))) < 20);
  assert.ok(TRIMS.levelUp !== undefined);
});

test('music profiles are complete and reference real scales / reverb environments', () => {
  for (const [id, P] of Object.entries(PROFILES)) {
    assert.ok(SCALES[P.scale], id);
    assert.ok(ENVIRONMENTS[P.env], id);
    assert.ok(P.bpm >= 40 && P.bpm <= 130, id);
    assert.ok(P.prog.length >= 4, id);
    for (const k of ['drone', 'pad', 'bell', 'levels']) assert.ok(P[k] !== undefined, `${id}.${k}`);
    if (P.drum) assert.equal(P.drum.pat.length, 16, id);
    assert.ok(P.combatMult >= 1);
  }
  for (const r of ['town', 'sunfields', 'marsh', 'ruins', 'ashen', 'dungeon', 'boss', 'title']) assert.ok(PROFILES[r], r);
});
