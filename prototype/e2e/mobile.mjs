// Phone / touch end-to-end test: drives the game with real touch events (CDP Input.dispatchTouchEvent,
// multi-touch) in a landscape phone viewport, then rotates to portrait.
// Usage: npm run build && npm run preview, then in another shell:
//   node e2e/mobile.mjs [url] [screenshot-dir]
// Needs Playwright (npm i -D playwright && npx playwright install chromium). Software GL runs at ~3 fps,
// so the waits are generous.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const URL = process.argv[2] || 'http://localhost:4173/';
const OUT = process.argv[3] || '.';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 844, height: 390 }, deviceScaleFactor: 3 });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message + '\n' + e.stack));
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) errors.push('console: ' + m.text()); });
const cdp = await ctx.newCDPSession(page);

const summary = {};
const failed = [];
const check = (name, cond, detail) => { summary[name] = detail === undefined ? !!cond : { ok: !!cond, ...detail }; if (!cond) failed.push(name); };
const wait = (ms) => page.waitForTimeout(ms);
const shot = (name) => page.screenshot({ path: `${OUT}/${name}.png`, timeout: 120000 });
const G = (fn, arg) => page.evaluate(fn, arg);

// ---- real touch input: every call sends the full list of active fingers, like a touch screen would ----
const fingers = new Map();
const send = (type) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: [...fingers].map(([id, p]) => ({ id, x: p.x, y: p.y, radiusX: 2, radiusY: 2, force: 1 })) });
const down = async (id, x, y) => { fingers.set(id, { x, y }); await send('touchStart'); };
const move = async (id, x, y) => { fingers.set(id, { x, y }); await send('touchMove'); };
const up = async (id) => { fingers.delete(id); await send('touchEnd'); };
const drag = async (id, x0, y0, x1, y1, steps = 6) => {
  await down(id, x0, y0);
  for (let i = 1; i <= steps; i++) { await move(id, x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps); await wait(40); }
};
const centre = async (sel) => { const b = await page.locator(sel).first().boundingBox(); if (!b) throw new Error(`no box for ${sel}`); return { x: b.x + b.width / 2, y: b.y + b.height / 2, w: b.width, h: b.height }; };
const tap = async (x, y, hold = 0) => { await down(99, x, y); if (hold) await wait(hold); await up(99); };
const tapEl = async (sel, hold = 0) => { const c = await centre(sel); await tap(c.x, c.y, hold); return c; };
const mode = () => G(() => window.__game.ui.mode);
const until = (fn, arg, timeout = 15000) => page.waitForFunction(fn, arg, { timeout });

// ------------------------------------------------------------------------------------------ boot + title
await page.goto(URL);
await page.waitForFunction(() => window.__game, null, { timeout: 120000 });
await wait(2500);
const title = await G(() => ({ device: document.body.dataset.device, fullscreen: [...document.querySelectorAll('#title-options .plaque')].map((e) => e.textContent.trim().toLowerCase()), noticeShown: !!document.getElementById('desktop-notice'), rotateShown: !document.getElementById('rotate').hidden }));
check('device is touch on a phone', title.device === 'touch', { device: title.device });
check('no desktop notice on phones', !title.noticeShown && !title.rotateShown);
check('title offers Fullscreen where the API exists', title.fullscreen.some((t) => t.includes('fullscreen')), { options: title.fullscreen });
await shot('1-title');

// Tap Begin with a real touch.
await tapEl('#title-options .plaque');
await until(() => window.__game.ui.mode === 'intro');
await wait(1200);
await tap(422, 195); // tap to skip the intro
let introDone = true;
try { await until(() => window.__game.started === true, null, 8000); } catch { introDone = false; }
if (!introDone) { await G(() => window.__game.ui.finishIntro()); await until(() => window.__game.started === true); }
check('intro skips on tap', introDone);
await wait(2500);
const hudOn = await G(() => ({ touchShown: !document.getElementById('touch').hidden, buttons: document.querySelectorAll('#touch .t-btn').length, hudShown: !document.getElementById('hud').hidden, device: document.body.dataset.device, skillBarHidden: getComputedStyle(document.getElementById('slots-row')).display === 'none' }));
check('touch overlay appears in game', hudOn.touchShown && hudOn.buttons >= 13 && hudOn.skillBarHidden, hudOn);

// Helpers inside the page: keep the hero alive and count hits.
await G(() => {
  const g = window.__game;
  window.__hits = 0;
  g.events.on('hit', () => window.__hits++);
  window.__evades = 0; g.events.on('evade', () => window.__evades++);
  window.__god = setInterval(() => { if (!g.player.dead) { g.player.life = Math.max(g.player.life, g.player.stats.maxLife * 0.6); g.player.anima = 100; } }, 200);
});

// ------------------------------------------------------------------------------------------ left stick: move
const p0 = await G(() => { const p = window.__game.player.pos; return { x: p.x, z: p.z }; });
await down(1, 120, 300);
await wait(100);
const stickBase = await G(() => document.getElementById('t-move').classList.contains('on'));
await move(1, 175, 300); await wait(60); await move(1, 190, 300);
await wait(2500);
const mv = await G(() => ({ move: window.__game.input.move, device: window.__game.input.device }));
await up(1);
await wait(1200); // a few frames at software-GL speed
const p1 = await G(() => { const p = window.__game.player.pos; return { x: p.x, z: p.z }; });
const moved = Math.hypot(p1.x - p0.x, p1.z - p0.z);
check('floating stick appears under the thumb', stickBase);
check('left stick moves the hero', moved > 0.8 && p1.x > p0.x, { moved: +moved.toFixed(2), dx: +(p1.x - p0.x).toFixed(2), move: mv.move });
const released = await G(() => window.__game.input.move.mag);
check('stick releases to rest', released === 0);

// ------------------------------------------------------------------------------------------ attack: hold near an enemy
const foe = await G(async () => {
  const g = window.__game;
  const alive = g.enemies.list.filter((e) => e.alive);
  let e = alive.sort((a, b) => a.pos.distanceTo(g.player.pos) - b.pos.distanceTo(g.player.pos))[0];
  if (!e) {
    const camp = g.enemies.camps.filter((c) => c.region === 'sunfields' && !c.elite).sort((a, b) => Math.hypot(a.x, a.z - 120) - Math.hypot(b.x, b.z - 120))[0];
    g.teleport(camp.x + 4, camp.z + 4);
    await new Promise((r) => setTimeout(r, 2500));
    e = g.enemies.list.filter((x) => x.alive).sort((a, b) => a.pos.distanceTo(g.player.pos) - b.pos.distanceTo(g.player.pos))[0];
  }
  g.teleport(e.pos.x + 1.6, e.pos.z);
  return { name: e.name, hp: e.hp };
});
await wait(2500);
const before = await G(() => { const g = window.__game; return { hits: window.__hits, hp: g.enemies.list.filter((e) => e.alive && e.pos.distanceTo(g.player.pos) < 10).reduce((s, e) => s + e.hp, 0), combat: g.combatNearby, interact: !!g.interactTarget }; });
await down(2, 760, 330); // the big attack button
// Poll: in software GL a frame can take longer than half a second.
let attackDown;
for (let i = 0; i < 10; i++) {
  await wait(250);
  attackDown = await G(() => ({ down: window.__game.input.down.skill1, cls: document.querySelector('.t-attack').classList.contains('down') }));
  if (attackDown.down) break;
}
await wait(5000);
const after = await G(() => { const g = window.__game; return { hits: window.__hits, hp: g.enemies.list.filter((e) => e.alive && e.pos.distanceTo(g.player.pos) < 10).reduce((s, e) => s + e.hp, 0), dead: g.enemies.list.filter((e) => !e.alive).length }; });
await up(2);
check('attack button is held while the finger is down', attackDown.down === true && attackDown.cls, attackDown);
check('holding attack deals damage', after.hits > before.hits || after.hp < before.hp, { foe, before, after });

// ------------------------------------------------------------------------------------------ right thumb steers the Tether
await G(() => { window.__game.player.life = window.__game.player.stats.maxLife; });
// Both thumbs at once: left moves, right aims (right).
await down(3, 130, 310); await move(3, 175, 310);
await down(4, 480, 140); await move(4, 540, 140);
await wait(1800);
const aimA = await G(() => { const g = window.__game; return { aim: { ...g.input.aim }, mode: g.tether.mode, rel: { x: g.tether.B.x - g.player.pos.x, z: g.tether.B.z - g.player.pos.z }, move: g.input.move.mag, ring: document.getElementById('t-aim').classList.contains('on') }; });
await shot('2-combat-hud');
await move(4, 420, 140); await wait(60); await move(4, 400, 140); // swing the other way
await wait(1800);
const aimB = await G(() => { const g = window.__game; return { aim: { ...g.input.aim }, rel: { x: g.tether.B.x - g.player.pos.x, z: g.tether.B.z - g.player.pos.z } }; });
await up(4); await up(3);
await until(() => !window.__game.input.aim.active, null, 20000).catch(() => {}); // frames are slow in software GL
const aimC = await G(() => { const g = window.__game; return { active: g.input.aim.active, kept: { ...g.input.touchAim }, mode: g.tether.mode }; });
check('multi-touch: move + aim at once', aimA.move > 0.3 && aimA.aim.active, { move: aimA.move, aim: aimA.aim });
check('right drag steers the tether (right)', aimA.mode === 'manual' && aimA.aim.x > 0.5 && aimA.rel.x > 1, { mode: aimA.mode, rel: aimA.rel });
check('right drag steers the tether (left)', aimB.aim.x < -0.3 && aimB.rel.x < -0.5, aimB);
check('tether stick shows a ring while dragging', aimA.ring);
check('lifting the thumb keeps the last direction but frees the familiar', aimC.active === false && aimC.kept.x !== 0 && aimC.kept.held === false, aimC);

// ------------------------------------------------------------------------------------------ potion + evade (taps shorter than a frame)
await G(() => { const g = window.__game; g.player.life = g.player.stats.maxLife * 0.3; window.__god && clearInterval(window.__god); g.enemies.list.forEach((e) => { if (e.alive) { e.hp = e.maxHp; } }); });
const pots0 = await G(() => window.__game.player.potions);
await tapEl('.t-potion'); // down + up back to back
await wait(1500);
const pots1 = await G(() => ({ potions: window.__game.player.potions, life: window.__game.player.life, badge: document.querySelector('.t-potion .badge').textContent }));
check('potion tap drinks a potion and the count updates', pots1.potions === pots0 - 1 && String(pots1.potions) === pots1.badge, { before: pots0, after: pots1 });
const ev0 = await G(() => window.__evades);
let ev1 = null, evTaps = 0;
while (evTaps++ < 4) { // at ~3 fps a hit-stop frame can swallow a tap, so allow a retry
  await tapEl('.t-evade');
  await wait(1500);
  ev1 = await G(() => ({ evades: window.__evades, charges: window.__game.player.evadeCharges }));
  if (ev1.evades > ev0) break;
}
check('evade tap dashes', ev1.evades === ev0 + 1, { ...ev1, taps: evTaps });
await G(() => { const g = window.__game; g.player.life = g.player.stats.maxLife; window.__god = setInterval(() => { if (!g.player.dead) { g.player.life = Math.max(g.player.life, g.player.stats.maxLife * 0.6); g.player.anima = 100; } }, 200); });

// ------------------------------------------------------------------------------------------ menu → inventory → equip
const kit = await G(() => {
  const g = window.__game, p = g.player;
  p.inventory.splice(0);
  const it = window.__genItem({ ilvl: 30, rarity: 'rare', kind: 'helm' });
  p.addItem(it);
  p.equipment.helm = null; p.recompute?.();
  p.skillPoints = 3; p.level = Math.max(p.level, 4);
  return { id: it.id, name: it.name };
});
await wait(600);
await tapEl('.t-menu');
await until(() => window.__game.ui.mode === 'pause');
check('Menu button opens the pause menu', (await mode()) === 'pause');
await wait(600);
await shot('3a-pause');
await tapEl('#pause-options .plaque:has-text("Inventory")');
await until(() => window.__game.ui.mode === 'menu');
await wait(700);
const invBefore = await G(() => ({ sel: window.__game.ui.menus.focusKey, tt: !!document.querySelector('#tt .tooltip'), hint: !!document.querySelector('#tt .tt-hint'), actions: document.querySelectorAll('#tt-act .t-do').length }));
check('inventory: nothing selected until you tap', invBefore.sel === null && invBefore.hint && invBefore.actions === 0, invBefore);
await tapEl('[data-nav="inv:0"]');
await wait(700);
const invSel = await G(() => ({ sel: window.__game.ui.menus.focusKey, name: document.querySelector('#tt .tt-name')?.textContent, buttons: [...document.querySelectorAll('#tt-act .t-do')].map((e) => e.textContent.trim()), equippedYet: !!window.__game.player.equipment.helm }));
check('inventory: tap selects and shows the tooltip with Equip / Salvage', invSel.sel === 'inv:0' && invSel.name === kit.name && invSel.buttons.join() === 'Equip,Salvage' && !invSel.equippedYet, invSel);
await shot('4-inventory-tooltip');
const btnBox = await G(() => [...document.querySelectorAll('#menu .plaque, #menu .tab, #menu .x-close, #menu [data-nav]')].filter((e) => e.offsetParent && e.getBoundingClientRect().height < 44 && !e.classList.contains('cell')).map((e) => `${e.className}:${Math.round(e.getBoundingClientRect().height)}`));
check('inventory: buttons and tabs are at least 44px tall', btnBox.length === 0, { small: btnBox });
await tapEl('#tt-act [data-do="equip"]');
await wait(900);
const eq = await G(() => ({ helm: window.__game.player.equipment.helm?.id, inv: window.__game.player.inventory.length }));
check('Equip button equips the item', eq.helm === kit.id && eq.inv === 0, { expected: kit.id, ...eq });

// Skills: tap a skill, rank it up, assign it to a button.
await tapEl('#menu-tabs .tab[data-tab="skills"]');
await wait(800);
await tapEl('[data-nav="skill:javelin"]');
await wait(500);
await tapEl('#skill-act [data-do^="rank:"]');
await wait(500);
const rank = await G(() => window.__game.player.skillRanks.javelin ?? 0);
await tapEl('#skill-act [data-do^="assign:"]');
await wait(500);
const binding = await G(() => window.__game.ui.menus.binding);
await tapEl('.bind[data-do="bind:3"]');
await wait(500);
const slots = await G(() => [...window.__game.player.slots]);
check('skills: tap, Learn / Rank up, then tap-to-assign', rank >= 1 && binding === 'javelin' && slots[3] === 'javelin', { rank, binding, slots });
await shot('5-skills');

// Settings: touch layout rows, left-handed toggle, a slider dragged with a finger.
await tapEl('#menu .x-close'); // back to the pause menu
await until(() => window.__game.ui.mode === 'pause');
await wait(500);
await tapEl('#pause-options .plaque:has-text("Settings")');
await until(() => window.__game.ui.mode === 'menu');
await wait(700);
await shot('6-settings');
const side = () => G(() => { const e = document.querySelector('.t-attack'); return e.style.left === 'auto' ? 'right' : 'left'; }); // the overlay is hidden while a menu is open, so read its layout
const side0 = await side();
await tapEl('[data-nav="set:touchLefty"]');
await wait(600);
const lefty = await G(() => ({ on: window.__game.settings.get('touchLefty'), cls: document.body.classList.contains('t-lefty') }));
const side1 = await side();
check('settings: left-handed mirrors the layout', lefty.on && lefty.cls && side0 === 'right' && side1 === 'left', { side0, side1 });
await tapEl('[data-nav="set:touchLefty"]');
await wait(500);
const sl = await centre('[data-slider="touchScale"]');
await drag(5, sl.x - sl.w / 2 + 4, sl.y, sl.x + sl.w / 2, sl.y, 4);
await up(5);
await wait(400);
const scaleSet = await G(() => ({ scale: window.__game.settings.get('touchScale'), lefty: window.__game.settings.get('touchLefty') }));
check('settings: sliders drag by touch, toggles tap', scaleSet.scale > 1.2 && scaleSet.lefty === false, scaleSet);
await G(() => window.__game.settings.set('touchScale', 1));
await tapEl('#menu .x-close');
await until(() => window.__game.ui.mode === 'pause');

// ------------------------------------------------------------------------------------------ map: tap a waypoint to travel
await G(() => window.__game.teleport(1, 95));
await wait(500);
await tapEl('#pause-options .plaque:has-text("Map")');
await until(() => window.__game.ui.mode === 'map');
await wait(900);
await shot('7-map');
const target = await G(() => { const g = window.__game; const w = g.world.waypoints.find((x) => x.id === 'wp-town') ?? g.world.waypoints.find((x) => x.discovered); return { x: w.x, z: w.z, id: w.id }; });
const mc = await page.locator('#map-canvas').boundingBox();
await tap(mc.x + ((target.x + 220) / 440) * mc.width, mc.y + ((target.z + 220) / 440) * mc.height);
await wait(1200);
const trav = await G((t) => ({ mode: window.__game.ui.mode, d: Math.hypot(window.__game.player.pos.x - t.x, window.__game.player.pos.z - t.z) }), target);
check('map: tapping a waypoint fast-travels', trav.mode === null && trav.d < 6, { target: target.id, ...trav });

// ------------------------------------------------------------------------------------------ dialogue: walk up to Ninsun, tap ⚔ to talk
await G(() => { const g = window.__game, n = g.world.npcs[0]; g.teleport(n.x + 1.4, n.z + 0.4); });
await wait(1800);
await until(() => !!window.__game.interactTarget && document.querySelector('.t-attack').classList.contains('interact'), null, 20000).catch(() => {});
const canTalk = await G(() => ({ target: window.__game.interactTarget?.label, prompt: !document.getElementById('prompt').hidden, handShown: document.querySelector('.t-attack').classList.contains('interact') }));
await shot('8a-interact-prompt');
await tapEl('.t-attack', 120);
try { await until(() => window.__game.ui.mode === 'dialog', null, 10000); } catch { /* reported below */ }
await wait(500);
await tapEl('#dialog .d-text'); // tap to finish the typewriter
await wait(900);
await shot('8-dialogue');
const dlg = await G(() => ({ mode: window.__game.ui.mode, options: [...document.querySelectorAll('#dialog .opt')].map((o) => Math.round(o.getBoundingClientRect().height)), typing: window.__game.ui.dialog?.typing }));
check('dialogue: attack button talks to Ninsun, options are tappable', canTalk.handShown && dlg.mode === 'dialog' && dlg.options.length > 0 && dlg.options.every((h) => h >= 44) && dlg.typing === false, { canTalk, dlg });
await tapEl('#dialog .opt:last-child');
await wait(800);
check('dialogue: tapping an option closes it', (await mode()) === null);

// ------------------------------------------------------------------------------------------ page never scrolls
await G(() => { window.scrollTo(0, 80); });
await drag(6, 300, 300, 300, 120, 4); await up(6); // a vertical swipe over the game
await wait(300);
const scroll = await G(() => ({ top: document.scrollingElement.scrollTop, sw: document.scrollingElement.scrollWidth, cw: document.scrollingElement.clientWidth, sh: document.scrollingElement.scrollHeight, ch: document.scrollingElement.clientHeight, x: document.scrollingElement.scrollLeft }));
check('no page scroll and no horizontal overflow', scroll.top === 0 && scroll.x === 0 && scroll.sw <= scroll.cw && scroll.sh <= scroll.ch, scroll);
const meta = await G(() => document.querySelector('meta[name=viewport]').content);
check('viewport blocks pinch zoom', /user-scalable=no/.test(meta) && /maximum-scale=1/.test(meta), { meta });

// ------------------------------------------------------------------------------------------ portrait: rotate overlay, game paused
await G(() => window.__game.player.life = window.__game.player.stats.maxLife);
await page.setViewportSize({ width: 390, height: 844 });
await wait(1800);
const portrait = await G(() => ({ shown: !document.getElementById('rotate').hidden, text: document.querySelector('#rotate h2')?.textContent, mode: window.__game.ui.mode, touchHidden: document.getElementById('touch').hidden }));
await shot('9-portrait-rotate');
check('portrait: Rotate overlay shows and pauses the game', portrait.shown && /Rotate your phone to landscape/.test(portrait.text) && portrait.mode === 'pause' && portrait.touchHidden, portrait);
await page.setViewportSize({ width: 844, height: 390 });
await wait(1800);
const landscape = await G(() => ({ shown: !document.getElementById('rotate').hidden, mode: window.__game.ui.mode }));
check('back in landscape: overlay clears and the game resumes', !landscape.shown && landscape.mode === null, landscape);

// ------------------------------------------------------------------------------------------ report
await G(() => clearInterval(window.__god));
await browser.close();
console.log(JSON.stringify(summary));
console.log(failed.length ? `FAILED: ${failed.join(', ')}` : 'all checks passed');
console.log(errors.length ? `errors:\n${errors.join('\n')}` : 'errors: none');
process.exit(failed.length || errors.length ? 1 : 0);
