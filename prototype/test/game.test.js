import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Rng, fbm } from '../src/core/rng.js';
import { generateItem, RARITY, sellValue, itemScore, startingWeapon, POWERS } from '../src/game/items.js';
import { computeStats, xpToNext, armorReduction, rollDamage, monsterLevelFor, MAX_LEVEL } from '../src/game/stats.js';
import { QuestLog, QUESTS } from '../src/game/quests.js';
import { canRankUp, skillCoef, SKILLS } from '../src/game/skills.js';

test('seeded rng is deterministic', () => {
  const a = new Rng(42), b = new Rng(42);
  for (let i = 0; i < 10; i++) assert.equal(a.next(), b.next());
  const n = fbm(3.3, 7.1, 5);
  assert.ok(n >= 0 && n < 1);
});

test('items roll affix counts by rarity and scale with item level', () => {
  const rng = new Rng(7);
  for (const rarity of Object.keys(RARITY)) {
    for (let i = 0; i < 50; i++) {
      const it = generateItem({ ilvl: 10, rarity, rng });
      const [lo, hi] = RARITY[rarity].affixes;
      assert.ok(it.affixes.length >= Math.min(lo, 1) - 1 && it.affixes.length <= hi, `${rarity} ${it.affixes.length}`);
      assert.equal(new Set(it.affixes.map((a) => a.stat)).size, it.affixes.length, 'no duplicate affixes');
      if (rarity === 'legendary') assert.ok(POWERS[it.power], 'legendary has a power');
      else assert.equal(it.power, null);
    }
  }
  const low = generateItem({ ilvl: 1, rarity: 'rare', kind: 'weapon', rng: new Rng(1) });
  const high = generateItem({ ilvl: 20, rarity: 'rare', kind: 'weapon', rng: new Rng(1) });
  assert.ok(high.base.max > low.base.max * 3);
  assert.ok(sellValue(high) > sellValue(low));
  assert.ok(itemScore(high) > itemScore(low));
});

test('computeStats applies gear', () => {
  const naked = computeStats(1, {});
  assert.equal(naked.maxLife, 100);
  const ring = { slot: 'ring1', base: {}, affixes: [{ stat: 'life', value: 50 }, { stat: 'critChance', value: 10 }], power: 'adad' };
  const s = computeStats(3, { weapon: startingWeapon(), ring1: ring });
  assert.equal(s.maxLife, 100 + 24 + 50);
  assert.ok(Math.abs(s.critChance - 0.15) < 1e-9);
  assert.equal(s.weaponMin, 4);
  assert.ok(s.powers.has('adad'));
});

test('damage, armor and xp formulas', () => {
  const s = computeStats(1, { weapon: startingWeapon() });
  const noCrit = rollDamage(s, 1, () => 0.99);
  assert.equal(noCrit.crit, false);
  assert.ok(Math.abs(noCrit.amount - (4 + 3 * 0.99)) < 1e-9);
  const crit = rollDamage(s, 1, () => 0.0);
  assert.equal(crit.crit, true);
  assert.ok(armorReduction(0, 5) === 0);
  assert.ok(armorReduction(1e9, 5) === 0.75);
  assert.ok(xpToNext(2) > xpToNext(1));
  assert.equal(xpToNext(MAX_LEVEL), Infinity);
  assert.equal(monsterLevelFor(5, 2), 5);
  assert.equal(monsterLevelFor(5, 9), 9);
});

test('skill ranks need points and levels', () => {
  assert.ok(canRankUp('javelin', 2, {}, 1));
  assert.ok(!canRankUp('javelin', 1, {}, 1));
  assert.ok(!canRankUp('javelin', 5, {}, 0));
  assert.ok(!canRankUp('javelin', 2, { javelin: 1 }, 1), 'rank 2 needs level 3');
  assert.ok(skillCoef('javelin', 3) > SKILLS.javelin.coef);
});

test('quest chain advances on matching events only', () => {
  const log = new QuestLog();
  assert.equal(log.active, null);
  log.accept();
  assert.equal(log.active.id, 'q1');
  log.notify({ type: 'kill', region: 'marsh' });
  assert.equal(log.progress, 0);
  for (let i = 0; i < QUESTS[0].objective.count; i++) log.notify({ type: 'kill', region: 'sunfields' });
  assert.equal(log.active.id, 'q2');
  log.notify({ type: 'discover', id: 'wp-marsh' });
  log.notify({ type: 'kill', region: 'ruins', named: 'aqrabu' });
  log.notify({ type: 'enter', id: 'dungeon' });
  assert.equal(log.active.id, 'q5');
  log.notify({ type: 'kill', boss: 'neti' });
  assert.ok(log.done);
  const restored = new QuestLog(JSON.parse(JSON.stringify(log)));
  assert.ok(restored.done);
});
