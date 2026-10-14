// "First fifteen minutes" balance bot. A non-invulnerable AI player follows the
// quest markers, fights with every learned skill, dodges telegraphs with a human
// reaction delay, drinks potions, loots and equips upgrades and spends skill points.
// It plays 15 minutes of game time (stepped, not rendered) and prints a pacing
// timeline plus balance metrics, then checks them against the alpha targets.
//
// Usage: npm run build && npm run preview, then in another shell:
//   node e2e/firstfifteen.mjs [url] [minutes] [seed]
import { chromium } from 'playwright';

const URL = process.argv[2] || 'http://localhost:4173/?low';
const MINUTES = +(process.argv[3] || 15);
const SEED = +(process.argv[4] || 1);

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`${e.message}\n${e.stack}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(URL);
await page.waitForFunction(() => window.__game, null, { timeout: 90000 });

await page.evaluate((seed) => {
  // Deterministic Math.random for repeatable runs.
  let s = seed >>> 0;
  Math.random = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const g = window.__game;
  g.ui.startGame(true);
  g.simDriven = true;
  const DT = 1 / 30;
  const P = g.player;
  const log = [];
  const stats = { deaths: 0, kills: 0, eliteKills: 0, damageTaken: 0, potions: 0, evades: 0, ttk: [], eliteTtk: [], firstHit: new Map(), rarities: {}, idleTime: 0, combatTime: 0, stuckEvents: 0, hits: 0 };
  const t = () => g.time;
  const mark = (what) => log.push({ t: +t().toFixed(1), what });
  g.events.on('levelUp', (e) => mark(`level ${e.level}`));
  g.events.on('questUpdate', (e) => { if (e.kind === 'completed') mark(`quest done: ${e.quest.title}`); });
  g.events.on('playerDeath', () => { stats.deaths++; mark('DIED'); });
  g.events.on('playerHurt', (e) => { stats.damageTaken += e.amount; });
  g.events.on('potion', () => stats.potions++);
  g.events.on('evade', () => stats.evades++);
  g.events.on('waypoint', (e) => mark(`waypoint ${e.id}`));
  g.events.on('bossIntro', (e) => { if (e.stage === 'start') mark(`boss intro: ${e.name}`); });
  g.events.on('aqrabuBurrow', () => mark('Aqrabu burrows'));
  g.events.on('aqrabuEmerge', () => mark('Aqrabu erupts'));
  g.events.on('pyresComplete', () => mark('pyres complete'));
  g.events.on('hit', (e) => { stats.hits++; if (!stats.firstHit.has(e.enemy)) stats.firstHit.set(e.enemy, t()); });
  g.events.on('kill', (e) => {
    const en = e.enemy;
    stats.kills++;
    const t0 = stats.firstHit.get(en);
    if (t0 !== undefined) (en.elite || en.named || en.boss ? stats.eliteTtk : stats.ttk).push(t() - t0);
    if (en.elite || en.named) { stats.eliteKills++; mark(`killed ${en.name}`); }
    if (en.named?.id === 'aqrabu' && t0 !== undefined) mark(`Aqrabu fight lasted ${(t() - t0).toFixed(0)} s (first hit to kill)`);
    if (en.boss) mark(`killed ${en.name}`);
  });
  g.events.on('pickup', (e) => {
    if (e.kind !== 'item') return;
    stats.rarities[e.rarity] = (stats.rarities[e.rarity] ?? 0) + 1;
    if (stats.rarities[e.rarity] === 1 && e.rarity !== 'common') mark(`first ${e.rarity}`);
  });

  const SKILL_PRIORITY = ['javelin', 'snap', 'wings', 'storm', 'aegis', 'pyre', 'strike', 'javelin', 'snap', 'storm'];
  const bot = { busy: 0, stuck: 0, lastPos: P.pos.clone(), sidestep: 0, stuckRun: 0, sideDir: 1, reactAt: null, lootTarget: null };

  function spendPoints() {
    for (const id of SKILL_PRIORITY) {
      if (P.skillPoints <= 0) break;
      const r = P.skillRanks[id] ?? 0;
      if (r >= 5 || P.level < ({ strike: 1, javelin: 2, snap: 3, wings: 4, storm: 6, aegis: 8, pyre: 10 })[id] + r) continue;
      P.skillPoints--;
      P.skillRanks[id] = r + 1;
      if (!P.slots.includes(id)) { const i = P.slots.indexOf(null); if (i >= 0) P.slots[i] = id; }
    }
  }

  function equipUpgrades() {
    const score = (it) => window.__itemScore ? window.__itemScore(it) : 0;
    for (const it of [...P.inventory]) {
      const eq = P.comparisonFor(it);
      if (!eq || score(it) > score(eq)) P.equip(it);
    }
    // Keep the bag from filling: salvage the rest.
    while (P.inventory.length > 20) P.inventory.shift();
  }

  function nearestEnemy(range) {
    let best = null, bd = range;
    for (const e of g.enemies.list) {
      if (!e.alive || e.spawning > 0) continue;
      const d = Math.hypot(e.pos.x - P.pos.x, e.pos.z - P.pos.z);
      if (d < bd && (e.aggro || d < 12)) { bd = d; best = e; }
    }
    return best;
  }

  function threatened() {
    for (const h of g.enemies.hazards) {
      const left = h.delay - h.t;
      if (left < 0.45 && Math.hypot(P.pos.x - h.x, P.pos.z - h.z) < h.r + 0.6) return { x: h.x, z: h.z };
    }
    for (const e of g.enemies.list) {
      if (!e.alive || e.state !== 'windup' || e.def.ai !== 'melee') continue;
      const left = e.def.windup - e.stateTime;
      if (left < 0.3 && Math.hypot(P.pos.x - e.pos.x, P.pos.z - e.pos.z) < e.def.range + 1) return { x: e.pos.x, z: e.pos.z };
    }
    return null;
  }

  function moveToward(x, z, stopAt = 1.5) {
    const dx = x - P.pos.x, dz = z - P.pos.z, d = Math.hypot(dx, dz);
    if (d < stopAt) return true;
    let mx = dx / d, mz = dz / d;
    if (bot.sidestep > 0) { const s = bot.sideDir; [mx, mz] = [mx * 0.3 - mz * s, mz * 0.3 + mx * s]; }
    g.input.move = { x: mx, z: mz, mag: 1 };
    return false;
  }

  function tick() {
    // Reset per-frame input, as a real frame would.
    for (const k of Object.keys(g.input.pressed)) g.input.pressed[k] = false;
    g.input.down = {};
    g.input.move = { x: 0, z: 0, mag: 0 };
    g.input.aim = { x: 0, z: 0, mag: 0, active: false, mouse: false };
    g.input.device = 'pad';

    if (g.ui.mode === 'intro') { g.ui.finishIntro(); return; }
    if (g.ui.mode === 'death') { g.ui.respawn(); return; }
    // Humans spend time reading and managing gear: model it as busy time.
    if (bot.busy > 0) { bot.busy -= DT; g.simulate(DT); g.fx.update(DT); return; }
    if (g.ui.mode === 'dialog') { g.ui.dialog.focus = 0; g.ui.chooseOption(); bot.busy = 6; return; }
    if (g.ui.mode) { g.ui.mode = null; for (const id of ['menu', 'map']) document.getElementById(id).hidden = true; }
    if (P.dead) { g.simulate(DT); g.fx.update(DT); return; }

    const pts = P.skillPoints, eqKey = Object.values(P.equipment).map((i) => i?.id).join();
    spendPoints();
    if (P.inventory.length && !g.combatNearby) equipUpgrades();
    if (P.skillPoints < pts) bot.busy += 5;
    if (Object.values(P.equipment).map((i) => i?.id).join() !== eqKey) bot.busy += 4;
    if (P.life < P.stats.maxLife * 0.4 && P.potions > 0 && Math.random() < 0.08) g.input.pressed.potion = true;

    // Dodge telegraphs with a human-ish reaction (70% success, 0.15–0.35 s delay).
    const threat = threatened();
    if (threat && P.evadeCharges > 0) {
      if (bot.reactAt === null) bot.reactAt = t() + 0.15 + Math.random() * 0.2;
      if (t() >= bot.reactAt) {
        if (Math.random() < 0.7) {
          const dx = P.pos.x - threat.x, dz = P.pos.z - threat.z, d = Math.hypot(dx, dz) || 1;
          g.input.move = { x: dx / d, z: dz / d, mag: 1 };
          g.input.pressed.evade = true;
        }
        bot.reactAt = null;
      }
    } else bot.reactAt = null;

    const enemy = nearestEnemy(14);
    if (enemy) {
      stats.combatTime += DT;
      const dx = enemy.pos.x - P.pos.x, dz = enemy.pos.z - P.pos.z, d = Math.hypot(dx, dz);
      if (!g.input.pressed.evade && d > 2.2 + enemy.radius) moveToward(enemy.pos.x, enemy.pos.z, 2 + enemy.radius);
      P.facing = Math.atan2(dx, dz);
      g.input.down.skill1 = true;
      if (Math.floor(t() / DT) % 10 === 0) g.input.pressed.skill1 = true;
      // Whip the tether across the target.
      // A human whips the stick in bursts, not every frame.
      if (Math.sin(t() * 0.7) > -0.2) {
        const a = Math.atan2(dx, dz) + Math.sin(t() * 5) * 0.7;
        g.input.aim = { x: Math.sin(a), z: Math.cos(a), mag: 0.85, active: true, mouse: false };
      }
      const packed = g.enemies.list.filter((e) => e.alive && e.pos.distanceTo(P.pos) < 7).length;
      P.slots.forEach((id, i) => {
        if (!id || i === 0) return;
        if (id === 'aegis' && P.life > P.stats.maxLife * 0.6) return;
        if (id === 'wings' && d < 5) return;
        if ((id === 'storm' || id === 'pyre') && packed < 2 && !(enemy.elite || enemy.boss)) return;
        if (Math.random() < 0.12) g.input.pressed[`skill${i + 1}`] = true;
      });
    } else {
      stats.idleTime += DT;
      // Loot nearby items first.
      const L = g.loot.nearestItem(P.pos, 12);
      if (L && P.inventory.length < 28) {
        if (moveToward(L.pos.x, L.pos.z, 1.2)) g.input.pressed.interact = true;
      } else {
        let m = g.questMarker();
        // Leave or enter Eridu through its gates instead of walking into the wall.
        const inTown = Math.hypot(P.pos.x - 0, P.pos.z - 150) < 29;
        const targetInTown = m && Math.hypot(m.x - 0, m.z - 150) < 29;
        if (m && inTown !== targetInTown) {
          const gate = (inTown ? m.z : P.pos.z) < 150 ? { x: 0, z: 120 } : { x: 0, z: 180 };
          const inner = { x: gate.x, z: gate.z < 150 ? 130 : 170 };
          const near = Math.hypot(P.pos.x - gate.x, P.pos.z - gate.z) < 3;
          if (!near) m = Math.abs(P.pos.x) > 2.5 && Math.abs(P.pos.z - inner.z) > 3 && inTown ? inner : gate;
        }
        if (m) {
          const arrived = moveToward(m.x, m.z, 2.2);
          // Doorways (gate, well, portals) have colliders, so "close enough" counts.
          if (arrived || (Math.hypot(m.x - P.pos.x, m.z - P.pos.z) < 3.5 && g.interactTarget)) g.input.pressed.interact = true;
        }
      }
    }

    // Stuck detection: sidestep around props.
    if (Math.floor(t() / DT) % 60 === 0) {
      const moved = P.pos.distanceTo(bot.lastPos);
      if (g.input.move.mag > 0 && moved < 1.5) {
        bot.sidestep = 1.2; bot.sideDir = Math.random() < 0.5 ? 1 : -1; stats.stuckEvents++;
        // A long run of stuck checks means a navigation bug, not a stray prop: say where.
        if (++bot.stuckRun === 20) { const m = g.questMarker(); mark(`stuck at ${Math.round(P.pos.x)},${Math.round(P.pos.z)} heading for ${m ? `${Math.round(m.x)},${Math.round(m.z)}` : 'nothing'}`); }
      } else bot.stuckRun = 0;
      bot.lastPos.copy(P.pos);
    }
    bot.sidestep = Math.max(0, bot.sidestep - DT);

    g.simulate(DT);
    g.fx.update(DT);
  }

  window.__bot = { tick, log, stats, P, DT };
}, SEED);

const totalTicks = Math.round(MINUTES * 60 * 30);
const CHUNK = 900;
const t0 = Date.now();
for (let done = 0; done < totalTicks; done += CHUNK) {
  await page.evaluate((n) => { for (let i = 0; i < n; i++) window.__bot.tick(); }, Math.min(CHUNK, totalTicks - done));
  if (errors.length) break;
}

const report = await page.evaluate(() => {
  const { log, stats, P } = window.__bot;
  const avg = (a) => (a.length ? +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(1) : null);
  const g = window.__game;
  return {
    timeline: log,
    final: { level: P.level, gold: P.gold, quest: g.quests.active?.title ?? (g.quests.done ? 'chain complete' : 'not accepted'), equipped: Object.values(P.equipment).map((i) => `${i.rarity}:${i.name}`) },
    metrics: {
      deaths: stats.deaths, kills: stats.kills, eliteKills: stats.eliteKills, killsPerMin: +(stats.kills / (g.time / 60)).toFixed(1),
      avgTtkNormal: avg(stats.ttk), avgTtkElite: avg(stats.eliteTtk), damageTakenPerMin: Math.round(stats.damageTaken / (g.time / 60)),
      potions: stats.potions, evades: stats.evades, combatShare: +(stats.combatTime / g.time).toFixed(2), rarities: stats.rarities, stuckEvents: stats.stuckEvents,
    },
  };
});
console.log(`simulated ${MINUTES} min in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
console.log('--- timeline ---');
for (const e of report.timeline) console.log(`${String(Math.floor(e.t / 60)).padStart(2)}:${String(Math.floor(e.t % 60)).padStart(2, '0')}  ${e.what}`);
console.log('--- final ---', JSON.stringify(report.final));
console.log('--- metrics ---', JSON.stringify(report.metrics, null, 1));

// Alpha pacing targets (see docs/ROADMAP.md).
const at = (re) => report.timeline.find((e) => re.test(e.what))?.t ?? Infinity;
const checks = [
  ['level 2 by 2:30', at(/^level 2$/) <= 150],
  ['level 4 by 9:00', at(/^level 4$/) <= 540],
  ['level 5+ by 15:00', report.final.level >= 5],
  ['legendary by 12:00', at(/first legendary/) <= 720],
  ['2 quests done by 11:00', (report.timeline.filter((e) => /quest done/.test(e.what))[1]?.t ?? Infinity) <= 660],
  ['deaths <= 2', report.metrics.deaths <= 2],
  ['normal TTK 1-5 s', report.metrics.avgTtkNormal !== null && report.metrics.avgTtkNormal >= 1 && report.metrics.avgTtkNormal <= 5],
];
checks.push(['no stuck marks on quest legs', !report.timeline.some((e) => /^stuck at/.test(e.what))]);
console.log('--- targets ---');
for (const [name, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
console.log('errors:', errors.length ? errors.slice(0, 5).join('\n') : 'none');
process.exitCode = errors.length ? 1 : 0;
await browser.close();
