import test from 'node:test';
import assert from 'node:assert/strict';
import { clusterLayout, SKILL_BTNS, MIN_BTN, MIN_ATTACK } from '../src/ui/touchlayout.js';

const scaleFor = (w, h) => Math.max(0.6, Math.min(1.3, h / 390, w / 740));
const availFor = (h) => h - (6 + Math.min(90, Math.max(58, h * 0.2))) - 6;

const clear = (items) => {
  const list = Object.entries(items);
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const [a, b] = [list[i][1], list[j][1]];
      if (Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) < (a.size + b.size) / 2 + 5) return `${list[i][0]} touches ${list[j][0]}`;
    }
  }
  return null;
};

test('the cluster fits under the minimap at every phone size, no button overlaps another', () => {
  for (const [w, h] of [[844, 390], [844, 320], [740, 300], [667, 290], [932, 380], [640, 280], [568, 260]]) {
    for (const bound of [[], SKILL_BTNS.slice(0, 1), SKILL_BTNS.slice(0, 3), SKILL_BTNS]) {
      const r = clusterLayout({ scale: scaleFor(w, h), avail: availFor(h), bound });
      assert.ok(r.top <= availFor(h) + 0.5, `${w}x${h} ${bound.length} skills: top ${r.top.toFixed(0)} > ${availFor(h).toFixed(0)} (${r.mode})`);
      assert.equal(clear(r.items), null, `${w}x${h} ${bound.length} skills (${r.mode})`);
      for (const [name, it] of Object.entries(r.items)) assert.ok(it.size >= (name === 'attack' ? MIN_ATTACK : MIN_BTN) - 0.01, `${name} too small at ${w}x${h}`);
      assert.equal(Object.keys(r.items).length, 4 + bound.length); // attack + evade/potion/aspect + the bound skills only
    }
  }
});

test('bound skills pack from the first arc position and fewer skills make a shorter arc', () => {
  const two = clusterLayout({ scale: 1, avail: 400, bound: SKILL_BTNS.slice(0, 2) });
  const five = clusterLayout({ scale: 1, avail: 400, bound: SKILL_BTNS });
  assert.ok(Math.abs(two.items.s2.y - two.items.attack.y) < 0.5, 'the first skill sits level with the attack button');
  assert.ok(two.top < five.top);
  assert.equal(two.items.s4, undefined);
});

test('a very short screen falls back to two rows', () => {
  const r = clusterLayout({ scale: 0.6, avail: 120, bound: SKILL_BTNS });
  assert.equal(r.mode, 'rows');
  assert.ok(r.top <= 120);
  assert.equal(clear(r.items), null);
});
