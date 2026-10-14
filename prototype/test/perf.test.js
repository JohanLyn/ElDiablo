import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DynRes } from '../src/core/dynres.js';
import { QUALITY, Settings, looksLikePhone } from '../src/core/settings.js';

// Feed `seconds` of frames at `ms` each; returns every ratio change.
function run(d, ms, seconds, t0 = 0) {
  const out = [];
  let t = t0;
  for (let n = 0; n < (seconds * 1000) / ms; n++) {
    t += ms;
    const r = d.frame(ms, t);
    if (r) out.push([+(t / 1000).toFixed(1), r]);
  }
  return out;
}

test('dynres steps down after about 2 s of slow frames and stops at the floor', () => {
  const d = new DynRes();
  d.configure(1, true);
  const ch = run(d, 40, 30);
  assert.ok(ch.length >= 3, 'walks down');
  assert.ok(ch[0][0] >= 2 && ch[0][0] <= 3.2, `first drop after ~2 s, got ${ch[0][0]}`);
  assert.equal(d.ratio, 0.6);
  for (const [, r] of ch) assert.ok(r >= 0.6 && r < 1);
});

test('dynres raises slowly, and never back to a ratio that just failed', () => {
  const d = new DynRes();
  d.configure(1, true);
  run(d, 40, 3); // one drop to 0.85
  assert.equal(d.ratio, 0.85);
  const up = run(d, 16.6, 20, 3000);
  assert.equal(up.length, 0, 'ceiling memory blocks an immediate retry');
  const later = run(d, 16.6, 30, 30000);
  assert.equal(later.length, 1);
  assert.equal(d.ratio, 1);
});

test('dynres leaves a healthy frame rate alone, ignores hitches, and is inert when disabled', () => {
  const d = new DynRes();
  d.configure(1, true);
  assert.equal(run(d, 16.7, 20).length, 0);
  for (let i = 0; i < 40; i++) assert.equal(d.frame(1500, i * 1500), 0); // tab-switch hitches
  const off = new DynRes();
  off.configure(1.5, false);
  assert.equal(run(off, 80, 10).length, 0);
  assert.equal(off.ratio, 1.5);
});

test('dynres on a 120 Hz display raises only when frames are fast', () => {
  const d = new DynRes();
  d.configure(1, true);
  run(d, 8.3, 2); // learns the refresh interval
  d.ratio = 0.72;
  assert.equal(run(d, 16.6, 12, 10000).length, 0, '60 fps is not healthy on a 120 Hz screen');
  assert.ok(run(d, 8.3, 12, 40000).length >= 1);
});

test('every preset defines the new fields; desktop presets keep today\'s values', () => {
  for (const [id, q] of Object.entries(QUALITY)) {
    for (const k of ['lights', 'post', 'cheapShaders', 'shafts', 'life', 'envBake']) assert.ok(k in q, `${id}.${k}`);
  }
  for (const id of ['low', 'medium', 'high', 'ultra']) {
    const q = QUALITY[id];
    assert.equal(q.lights, 12);
    assert.equal(q.post, true);
    assert.equal(q.cheapShaders, false);
    assert.equal(q.life, 1);
    assert.equal(q.envBake, true);
  }
  const m = QUALITY.mobile;
  assert.equal(m.label, 'Mobile');
  assert.ok(m.lights <= 4 && m.post === false && m.cheapShaders && m.envBake === false && !m.shadows && !m.bloom && m.grass === 0);
});

test('settings: a phone-like device defaults to Mobile on first run only', () => {
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  globalThis.matchMedia = (q) => ({ matches: q.includes('coarse') });
  globalThis.screen = { width: 844, height: 390 };
  assert.equal(looksLikePhone(), true);
  assert.equal(new Settings().get('quality'), 'mobile');
  globalThis.screen = { width: 1024, height: 768 }; // a tablet or a touch laptop keeps High
  assert.equal(looksLikePhone(), false);
  assert.equal(new Settings().get('quality'), 'high');
  globalThis.screen = { width: 844, height: 390 };
  const s = new Settings();
  s.set('quality', 'high'); // the player chose High: later visits keep it
  assert.equal(new Settings().get('quality'), 'high');
  globalThis.matchMedia = (q) => ({ matches: false });
  store.clear();
  assert.equal(new Settings().get('quality'), 'high'); // fine pointer: no auto-switch
  delete globalThis.localStorage; delete globalThis.matchMedia; delete globalThis.screen;
});

test('settings: needsReload tracks the baked light pool and shader set', () => {
  globalThis.localStorage = { getItem: () => null, setItem: () => {} };
  const s = new Settings();
  assert.equal(s.needsReload, false);
  s.set('quality', 'mobile');
  assert.equal(s.needsReload, true);
  s.set('quality', 'low');
  assert.equal(s.needsReload, false);
  delete globalThis.localStorage;
});
