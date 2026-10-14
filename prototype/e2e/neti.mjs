// Boss check: a hero at a given level, in level-appropriate magic/rare gear with
// Strike, Javelin, Snap and Wings, fights Neti alone (no god mode) with a simple
// dodging AI. Prints Neti's level and HP, time to kill, deaths and potions per try.
// Usage: npm run build && npm run preview, then: node e2e/neti.mjs [url] [heroLevel] [tries]
import { chromium } from 'playwright';
const [,, url = 'http://localhost:4173/?low', lvl = '6', tries = '3'] = process.argv;
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 800, height: 450 } });
await page.goto(url);
await page.waitForFunction(() => window.__game, null, { timeout: 120000 });
const out = await page.evaluate(async ([lvl, tries]) => {
  const g = window.__game; g.simDriven = true;
  g.ui.startGame(true); g.ui.finishIntro();
  const step = (n, fn) => { for (let i = 0; i < n; i++) { fn?.(i); g.simulate(1 / 30); g.fx.update(1 / 30); for (const k of Object.keys(g.input.pressed)) g.input.pressed[k] = false; g.input.down = {}; g.input.move = { x: 0, z: 0, mag: 0 }; } };
  const P = g.player;
  while (P.level < lvl) P.gainXp(100 * P.level * P.level - P.xp + 1, g);
  P.skillRanks = { strike: 2, javelin: 2, snap: 1, wings: 1 };
  P.slots = ['strike', 'javelin', 'snap', 'wings', null, null];
  // Gear typical of minute ~18: magic/rare at the hero's level in every slot.
  for (const kind of ['weapon', 'helm', 'chest', 'gloves', 'boots', 'amulet', 'ring', 'ring']) P.equip(window.__genItem({ ilvl: lvl, rarity: Math.random() < 0.5 ? 'rare' : 'magic', kind }));
  P.recompute(); P.life = P.stats.maxLife;
  const results = [];
  for (let t = 0; t < tries; t++) {
    P.life = P.stats.maxLife; P.dead = false;
    g.enterDungeon('ganzir'); step(30);
    const boss = g.enemies.list.find((e) => e.boss);
    for (const e of g.enemies.list) if (e.alive && !e.boss) { e.alive = false; e.dispose(g.scene); }
    g.teleport(boss.pos.x, boss.pos.z + 9); step(20);
    let deaths = 0, potions = 0, frames = 0;
    for (; frames < 30 * 240 && boss.alive; frames++) {
      if (P.dead) { deaths++; P.life = P.stats.maxLife; P.dead = false; P.resetCombatState?.(); }
      if (P.life < P.stats.maxLife * 0.4 && P.potions > 0 && Math.random() < 0.05) { g.input.pressed.potion = true; potions++; }
      const dx = boss.pos.x - P.pos.x, dz = boss.pos.z - P.pos.z, d = Math.hypot(dx, dz);
      // dodge hazards about to land
      const hz = g.enemies.hazards.find((h) => h.delay - h.t < 0.5 && Math.hypot(P.pos.x - h.x, P.pos.z - h.z) < h.r + 0.6);
      if (hz) { const ax = P.pos.x - hz.x, az = P.pos.z - hz.z, al = Math.hypot(ax, az) || 1; g.input.move = { x: ax / al, z: az / al, mag: 1 }; if (Math.random() < 0.3) g.input.pressed.evade = true; }
      else if (d > 2.6) g.input.move = { x: dx / d, z: dz / d, mag: 1 };
      P.facing = Math.atan2(dx, dz);
      g.input.down.skill1 = true; if (frames % 15 === 0) g.input.pressed.skill1 = true;
      const a = frames * 0.4; g.input.aim = { x: Math.cos(a), z: Math.sin(a), mag: 1, active: true, mouse: false };
      for (let s = 2; s <= 4; s++) if ((frames + s * 9) % 45 === 0) g.input.pressed[`skill${s}`] = true;
      g.simulate(1 / 30); g.fx.update(1 / 30);
      for (const k of Object.keys(g.input.pressed)) g.input.pressed[k] = false;
      g.input.down = {}; g.input.move = { x: 0, z: 0, mag: 0 };
    }
    results.push({ netiLevel: boss.level, netiHp: Math.round(boss.maxHp), heroLife: Math.round(P.stats.maxLife), armor: Math.round(P.stats.armor), killed: !boss.alive, secs: Math.round(frames / 30), deaths, potions });
    g.leaveDungeon(); step(10);
  }
  return { slots: P.slots, level: P.level, results };
}, [+lvl, +tries]);
console.log(JSON.stringify(out, null, 1));
await browser.close();
