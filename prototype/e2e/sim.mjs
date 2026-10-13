// End-to-end gameplay simulation. Steps the game systems directly (no rendering
// wait), so it plays the whole quest chain in about a minute even on software GL.
// Usage: npm run build && npm run preview, then in another shell:
//   node e2e/sim.mjs [url] [screenshot-dir]
// Needs Playwright (npm i -D playwright && npx playwright install chromium).
import { chromium } from 'playwright';
const URL = process.argv[2] || 'http://localhost:4173/?low';
const OUT = process.argv[3] || '.';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message + '\n' + e.stack));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
await page.goto(URL);
await page.waitForFunction(() => window.__game, null, { timeout: 60000 });
await page.evaluate(() => {
  const g = window.__game;
  window.sim = {
    step(n, each) {
      const dt = 1 / 30;
      for (let i = 0; i < n; i++) {
        for (const k of Object.keys(g.input.pressed)) g.input.pressed[k] = false;
        g.input.down = {};
        g.input.move = { x: 0, z: 0, mag: 0 };
        g.input.aim = { x: 0, z: 0, mag: 0, active: false, mouse: false };
        g.input.device = 'pad';
        each?.(i);
        const region = g.world.regionAt(g.player.pos.x, g.player.pos.z);
        g.inSafeZone = region === 'town';
        g.combatNearby = g.enemies.list.some((e) => e.alive && e.spawning <= 0 && (e.aggro || e.boss) && e.pos.distanceToSquared(g.player.pos) < 64);
        g.time += dt;
        g.player.update(dt, g); g.abilities.update(dt, g); g.tether.update(dt, g); g.enemies.update(dt, g); g.loot.update(dt, g); g.interactions.update(dt);
        for (let j = g.timers.length - 1; j >= 0; j--) { const t = g.timers[j]; t.t -= dt; if (t.t <= 0) { g.timers.splice(j, 1); t.fn(); } }
      }
    },
    // Walk toward the nearest live enemy and attack; optional skills; optional god mode.
    fight(n, { skills = [], god = true, filter = () => true } = {}) {
      this.step(n, (i) => {
        if (god) { g.player.life = g.player.stats.maxLife; g.player.anima = 100; }
        let best = null, bd = 1e9;
        for (const e of g.enemies.list) { if (!e.alive || e.spawning > 0 || !filter(e)) continue; const d = e.pos.distanceTo(g.player.pos); if (d < bd) { bd = d; best = e; } }
        if (!best) return;
        const dx = best.pos.x - g.player.pos.x, dz = best.pos.z - g.player.pos.z, d = Math.hypot(dx, dz);
        if (d > 2.4) g.input.move = { x: dx / d, z: dz / d, mag: 1 };
        g.player.facing = Math.atan2(dx, dz);
        g.input.down.skill1 = true;
        if (i % 15 === 0) g.input.pressed.skill1 = true;
        // Whip the tether with the right stick.
        const a = i * 0.45; g.input.aim = { x: Math.cos(a), z: Math.sin(a), mag: 1, active: true, mouse: false };
        skills.forEach((slot, k) => { if ((i + k * 7) % 40 === 0) g.input.pressed[`skill${slot}`] = true; });
      });
    },
    s() { return { lvl: g.player.level, xp: Math.round(g.player.xp), gold: g.player.gold, life: Math.round(g.player.life), inv: g.player.inventory.length, quest: g.quests.active?.id ?? (g.quests.done ? 'done' : 'none'), prog: g.quests.progress, loot: g.loot.items.length, alive: g.enemies.list.filter((e) => e.alive).length, dead: g.player.dead }; },
  };
});
const log = async (label, fn) => { const r = await page.evaluate(fn); console.log(label.padEnd(18), JSON.stringify(r)); };

await log('start', () => { const g = window.__game; g.ui.startGame(true); return sim.s(); });
await log('talk ninsun', () => { const g = window.__game; g.ui.talk(g.world.npcs[0]); g.ui.dialog.focus = 0; g.ui.chooseOption(); return sim.s(); });
await log('sunfields fight', () => {
  const g = window.__game;
  const camps = g.enemies.camps.filter((c) => c.region === 'sunfields' && !c.elite).sort((a, b) => Math.hypot(a.x, a.z - 120) - Math.hypot(b.x, b.z - 120));
  for (const c of camps.slice(0, 4)) { g.teleport(c.x + 4, c.z + 4); sim.step(30); sim.fight(900, { god: false }); if (g.player.dead) { g.respawn(); } }
  return { ...sim.s(), campStates: camps.slice(0, 4).map((c) => c.state) };
});
await log('pickup loot', () => {
  const g = window.__game;
  let n = 0;
  for (const L of [...g.loot.items]) { g.player.pos.set(L.pos.x, L.pos.y, L.pos.z); sim.step(2); if (g.interactTarget?.label.startsWith('Pick up')) { g.interactTarget.use(); n++; } }
  return { picked: n, ...sim.s() };
});
await log('equip + skills', () => {
  const g = window.__game, p = g.player;
  for (const it of [...p.inventory]) p.equip(it);
  p.gainXp(5000, g);
  for (const id of ['javelin', 'snap', 'wings', 'storm', 'aegis', 'pyre']) { while (p.skillPoints > 0 && (p.skillRanks[id] ?? 0) < 1 && p.level >= ({ javelin: 2, snap: 3, wings: 4, storm: 6, aegis: 8, pyre: 10 })[id]) { g.ui.menus.show('skills'); g.ui.menus.focusKey = `skill:${id}`; g.ui.menus.activate('confirm'); } }
  g.ui.menus.hide(); g.ui.mode = null;
  return { slots: p.slots, ranks: p.skillRanks, points: p.skillPoints, ...sim.s() };
});
await log('ruins elites', () => {
  const g = window.__game;
  const c = g.enemies.camps.find((c) => c.region === 'ruins' && c.elite);
  g.teleport(c.x + 4, c.z + 4); sim.step(30);
  sim.fight(1500, { skills: [2, 3, 4, 5, 6] });
  return { camp: c.state, elite: c.elite.affixes, ...sim.s() };
});
await log('aqrabu', () => {
  const g = window.__game;
  if (g.quests.active?.id === 'q2') { const w = g.world.waypoints.find((w) => w.id === 'wp-marsh'); g.teleport(w.x, w.z + 3); sim.step(10); }
  const c = g.enemies.camps.find((c) => c.id === 'camp-aqrabu');
  g.teleport(c.x + 5, c.z + 5); sim.step(30);
  sim.fight(2500, { skills: [2, 3, 4, 5, 6] });
  return { camp: c.state, ...sim.s() };
});
await log('ritual event', () => {
  const g = window.__game;
  const W = g.world.ritual; g.teleport(W.x, W.z); sim.step(60);
  const started = g.interactions.ritual.state;
  sim.fight(2400, { skills: [2, 3] });
  return { started, state: g.interactions.ritual.state, kills: g.interactions.ritual.kills, cooldown: Math.round(g.interactions.ritual.cooldown), ...sim.s() };
});
await log('dungeon + neti', () => {
  const g = window.__game;
  g.teleport(0, -150); sim.step(5);
  g.enterDungeon(); sim.step(60);
  const boss = g.enemies.list.find((e) => e.boss);
  g.teleport(boss.pos.x, boss.pos.z + 8); sim.step(60);
  sim.fight(4000, { skills: [2, 3, 4, 5, 6], filter: (e) => e.boss || e.pos.distanceTo(boss.pos) < 14 });
  return { bossHp: Math.round(boss.hp), bossAlive: boss.alive, shielded: boss.shielded, exitPortal: !!g.interactions.exitPortal, legendaryDropped: g.loot.items.some((L) => L.item.rarity === 'legendary'), ...sim.s() };
});
await log('menus/map/dialog', () => {
  const g = window.__game;
  g.leaveDungeon();
  for (const t of ['inventory', 'skills', 'quests', 'system']) { g.ui.openMenu(t); g.ui.menus.moveFocus(1, 0); g.ui.menus.moveFocus(0, 1); }
  g.ui.menus.show('inventory', { merchant: true }); g.player.gold += 2000; g.ui.menus.focusKey = 'gamble:ring'; g.ui.menus.activate('confirm');
  g.ui.menus.focusKey = 'inv:0'; g.ui.menus.activate('alt');
  g.ui.menus.hide(); g.ui.mode = null;
  g.ui.openMap(); g.ui.mapSel = g.world.waypoints[0]; g.ui.travel();
  for (const n of g.world.npcs) { g.ui.talk(n); g.ui.closeDialog(); }
  return { pos: [Math.round(g.player.pos.x), Math.round(g.player.pos.z)], ...sim.s() };
});
await log('portal + save', () => {
  const g = window.__game;
  const w = g.world.waypoints.find((w) => w.id === 'wp-ruins'); g.teleport(w.x + 10, w.z);
  g.player.invuln = 99; g.startTownPortal(); sim.step(60); g.player.invuln = 0;
  const inTown = g.world.regionAt(g.player.pos.x, g.player.pos.z);
  g.interactions.returnThroughPortal();
  g.save();
  const before = JSON.stringify(sim.s());
  g.ui.startGame(false);
  return { inTown, roundTrip: before === JSON.stringify(sim.s()), ...sim.s() };
});
await log('death+respawn', () => {
  const g = window.__game;
  const c = g.enemies.camps.find((c) => c.region === 'ashen' && c.elite);
  g.teleport(c.x + 3, c.z + 3);
  g.player.equipment = {}; g.player.recompute(); g.player.life = 5;
  sim.step(400);
  const died = g.player.dead, deathShown = g.ui.mode;
  g.ui.respawn();
  return { died, deathShown, alive: !g.player.dead, life: Math.round(g.player.life), pos: [Math.round(g.player.pos.x), Math.round(g.player.pos.z)] };
});
await page.evaluate(() => { const g = window.__game; g.ui.mode = null; g.ui.openMenu('inventory'); });
await page.waitForTimeout(2500);
await page.screenshot({ path: `${OUT}/sim-inventory.png` });
console.log('errors:', errors.length ? errors.slice(0, 10).join('\n') : 'none');
process.exitCode = errors.length ? 1 : 0;
await browser.close();
