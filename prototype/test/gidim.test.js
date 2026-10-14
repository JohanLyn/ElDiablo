import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  gidimVariant, markEligible, makeMark, pushMark, nightCap, ashFor, sanctuaryAt, inSanctuary, wardStrength,
  MARK_CAP, MAX_ACTIVE, VARIANTS, BASE, SANCTUARY_R, lanternRadius,
} from '../src/game/gidimRules.js';

test('cause of death picks the gidim variant', () => {
  assert.equal(gidimVariant({ source: 'strike' }), 'plain');
  assert.equal(gidimVariant({ source: 'javelin' }), 'plain');
  assert.equal(gidimVariant({}), 'plain');
  assert.equal(gidimVariant({ source: 'burn' }), 'burning');
  assert.equal(gidimVariant({ source: 'pyre' }), 'burning');
  assert.equal(gidimVariant({ source: 'strike', burning: true }), 'burning');
  assert.equal(gidimVariant({ source: 'tether' }), 'chained');
  assert.equal(gidimVariant({ source: 'snap' }), 'chained');
  assert.equal(gidimVariant({ source: 'strike', crit: true }), 'shattered');
  assert.equal(gidimVariant({ source: 'javelin', crit: true }), 'shattered');
});

test('variant precedence: Lord beats fire beats chains beats a crit', () => {
  assert.equal(gidimVariant({ source: 'tether', crit: true }), 'chained');
  assert.equal(gidimVariant({ source: 'tether', burning: true }), 'burning');
  assert.equal(gidimVariant({ source: 'burn', crit: true }), 'burning');
  assert.equal(gidimVariant({ source: 'tether', burning: true, crit: true, elite: true }), 'lord');
  assert.equal(gidimVariant({ source: 'strike', named: true }), 'lord');
  assert.equal(gidimVariant({ source: 'strike', elite: true }), 'lord');
});

test('every variant has stats and Lords are the biggest', () => {
  for (const v of ['plain', 'burning', 'chained', 'shattered', 'shard', 'lord']) {
    const s = VARIANTS[v];
    assert.ok(s.hp > 0 && s.dmg > 0 && s.speed > 0 && s.scale > 0, v);
  }
  assert.ok(VARIANTS.lord.scale > VARIANTS.plain.scale);
  assert.ok(VARIANTS.shard.scale < VARIANTS.plain.scale);
  assert.equal(BASE.hp, 0.7);
  assert.equal(BASE.dmg, 0.8);
  assert.equal(BASE.xp, 0.5);
  assert.equal(BASE.speed, 0.8);
});

test('marks only come from outdoor day kills', () => {
  assert.equal(markEligible({}), true);
  assert.equal(markEligible({ night: true }), false);
  assert.equal(markEligible({ inDungeon: true }), false);
  assert.equal(markEligible({ dungeon: true }), false);
  assert.equal(markEligible({ region: 'town' }), false);
  assert.equal(markEligible({ region: 'cistern' }), false);
  assert.equal(markEligible({ boss: true }), false);
  assert.equal(markEligible({ gidim: true }), false); // a risen gidim leaves no mark
  assert.equal(markEligible({ enabled: false }), false); // setting off
  assert.equal(markEligible({ region: 'ashen' }), true);
});

test('makeMark records type, rank, cause and variant', () => {
  const m = makeMark({ type: 'gallu', x: 3, z: 4, source: 'tether', time: 12, level: 4 });
  assert.equal(m.type, 'gallu');
  assert.equal(m.variant, 'chained');
  assert.equal(m.lord, false);
  assert.equal(m.time, 12);
  const lord = makeMark({ type: 'gallu', x: 0, z: 0, elite: { prefix: 'Bitter' } });
  assert.equal(lord.variant, 'lord');
  assert.equal(lord.lord, true);
  const named = makeMark({ type: 'scorpion', x: 0, z: 0, named: { name: 'Aqrabu the Venomed' } });
  assert.equal(named.variant, 'lord');
  assert.equal(named.named, 'Aqrabu the Venomed');
});

test('mark cap drops the oldest', () => {
  const marks = [];
  for (let i = 0; i < MARK_CAP + 15; i++) pushMark(marks, { id: i });
  assert.equal(marks.length, MARK_CAP);
  assert.equal(marks[0].id, 15);
  assert.equal(marks.at(-1).id, MARK_CAP + 14);
  const small = [];
  for (let i = 0; i < 5; i++) pushMark(small, { id: i }, 3);
  assert.deepEqual(small.map((m) => m.id), [2, 3, 4]);
});

test('the night size scales with level but stays capped', () => {
  assert.ok(nightCap(1) >= 10);
  assert.ok(nightCap(10) > nightCap(1));
  assert.ok(nightCap(5) <= nightCap(15));
  for (let l = 1; l <= 40; l++) assert.ok(nightCap(l) <= MAX_ACTIVE && nightCap(l) >= 10);
  assert.equal(nightCap(20), MAX_ACTIVE);
});

test('Ghost-ash: Lords 5, normal 1, shards 0.5 rounded, Grave-reader doubles', () => {
  assert.equal(ashFor('lord'), 5);
  assert.equal(ashFor('plain'), 1);
  assert.equal(ashFor('burning'), 1);
  assert.equal(ashFor('shard', { rand: 0.2 }), 1);
  assert.equal(ashFor('shard', { rand: 0.9 }), 0);
  assert.equal(ashFor('plain', { graveReader: true }), 2);
  assert.equal(ashFor('lord', { graveReader: true }), 10);
  assert.equal(ashFor('shard', { graveReader: true, rand: 0.99 }), 1);
});

const TOWN = { x: 0, z: 150, r: 26 };
const regionAt = (x, z) => (Math.hypot(x - TOWN.x, z - TOWN.z) < TOWN.r ? 'town' : 'sunfields');
const ctx = (over = {}) => ({
  regionAt, town: TOWN,
  shrines: [{ x: -30, z: 70 }], waypoints: [{ x: 6, z: 22 }],
  emitters: [
    { x: 100, z: 100, night: 1, enabled: true }, // a lantern
    { x: 120, z: 100, night: 0, enabled: true }, // an always-on brazier: not a lantern
    { x: 140, z: 100, night: 1, enabled: true, sedu: true }, // the sedu's own light
    { x: 160, z: 100, night: 1, enabled: false }, // a lantern that is switched off
  ],
  ...over,
});

test('town is a sanctuary', () => {
  const s = sanctuaryAt(0, 150, ctx());
  assert.equal(s.kind, 'town');
  assert.equal(inSanctuary(0, 150 + 25, ctx()), true);
  assert.equal(inSanctuary(0, 150 + 27, ctx()), false);
  assert.equal(sanctuaryAt(10, 160, ctx()).r, 26);
});

test('shrines and waypoints keep gidim out within 7 m', () => {
  const c = ctx();
  assert.equal(sanctuaryAt(-30 + 6.9, 70, c)?.kind, 'shrine');
  assert.equal(sanctuaryAt(-30 + 7.1, 70, c), null);
  assert.equal(sanctuaryAt(6, 22 - 6.5, c)?.kind, 'waypoint');
  assert.equal(sanctuaryAt(6, 22 - 7.5, c), null);
  assert.equal(SANCTUARY_R.shrine, 7);
  assert.equal(SANCTUARY_R.waypoint, 7);
});

test('lantern sanctuaries: 6 m, 9 m with the Lamp of Nanna, only lights that burn at night', () => {
  const c = ctx();
  assert.equal(sanctuaryAt(100 + 5.9, 100, c)?.kind, 'lantern');
  assert.equal(sanctuaryAt(100 + 6.1, 100, c), null);
  assert.equal(sanctuaryAt(100 + 8, 100, c), null);
  const lamp = ctx({ lampMult: 1.5 });
  assert.equal(sanctuaryAt(100 + 8, 100, lamp)?.kind, 'lantern');
  assert.equal(sanctuaryAt(100 + 9.1, 100, lamp), null);
  assert.equal(lanternRadius(1.5), 9);
  assert.equal(inSanctuary(120, 100, c), false, 'an always-on light is not a lantern');
  assert.equal(inSanctuary(140, 100, c), false, 'the sedu lantern is not a place');
  assert.equal(inSanctuary(160, 100, c), false, 'a disabled lantern is dark');
});

test('open ground is not a sanctuary', () => {
  assert.equal(sanctuaryAt(80, -40, ctx()), null);
  assert.equal(inSanctuary(80, -40, { regionAt, shrines: [], waypoints: [], emitters: [] }), false);
});

test('Tether ward doubles damage and the Lamp strengthens it by half', () => {
  assert.equal(wardStrength(false).dmg, 2);
  assert.equal(wardStrength(true).dmg, 2.5);
  assert.ok(wardStrength(true).push > wardStrength(false).push);
});
