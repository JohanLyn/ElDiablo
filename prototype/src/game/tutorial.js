// Contextual, one-time tutorial prompts. Each step appears when its `when`
// condition becomes true and is dismissed when `done` is satisfied (or after a
// timeout). Text adapts to the active device. Completed steps persist in flags.

export const STEPS = [
  {
    id: 'move', when: (g) => g.flags.tut.started,
    text: { pad: ['Left stick', 'Move'], kbm: ['W A S D', 'Move'] },
    done: (g, s) => s.moved > 3,
  },
  {
    id: 'attack', when: (g) => g.combatNearby || nearEnemy(g, 12),
    text: { pad: ['A', 'Strike. Hold it to keep swinging'], kbm: ['Left click', 'Strike. Hold it to keep swinging'] },
    done: (g, s) => s.hits >= 4,
  },
  {
    id: 'tether', when: (g, s) => s.hits >= 4 && nearEnemy(g, 12),
    text: { pad: ['Right stick', 'Steer your sedu spirit. Its tether cuts through enemies; whip it fast for more damage'], kbm: ['Mouse', 'Your sedu spirit follows the cursor. Sweep its tether through enemies'] },
    done: (g, s) => s.tetherHits >= 6, timeout: 25,
  },
  {
    id: 'evade', when: (g, s) => s.windupNear,
    text: { pad: ['B', 'Evade out of red telegraphs'], kbm: ['Space', 'Evade out of red telegraphs'] },
    done: (g, s) => s.evades >= 1, timeout: 20,
  },
  {
    id: 'potion', when: (g) => g.player.life < g.player.stats.maxLife * 0.55 && g.player.potions > 0,
    text: { pad: ['LB', 'Drink a healing potion. Red orbs from monsters refill them'], kbm: ['Q', 'Drink a healing potion. Red orbs from monsters refill them'] },
    done: (g, s) => s.potions >= 1, timeout: 15,
  },
  {
    id: 'loot', when: (g) => !g.combatNearby && g.loot.items.length > 0 && g.loot.nearestItem(g.player.pos, 14),
    text: { pad: ['A', 'Walk to loot and press A to pick it up'], kbm: ['E', 'Walk to loot and press E to pick it up'] },
    done: (g, s) => s.pickups >= 1, timeout: 30,
  },
  {
    id: 'equip', when: (g, s) => s.pickups >= 1 && !g.combatNearby,
    text: { pad: ['Start', 'Open your inventory and equip items marked ▲'], kbm: ['I', 'Open your inventory and equip items marked ▲'] },
    done: (g, s) => s.equips >= 1, timeout: 40,
  },
  {
    id: 'follow', when: (g) => g.flags.introDone && !g.quests.done,
    text: { pad: ['◆', 'Follow the gold marker on your minimap'], kbm: ['◆', 'Follow the gold marker on your minimap'] },
    done: (g) => !g.quests.pending || g.quests.index > 1, timeout: 30,
  },
  {
    id: 'skill', when: (g) => g.player.skillPoints > 0 && g.player.level >= 2 && !g.combatNearby,
    text: { pad: ['Start', 'You have a skill point. Open Skills (RB) and learn Lapis Javelin'], kbm: ['K', 'You have a skill point. Open Skills and learn Lapis Javelin'] },
    done: (g) => (g.player.skillRanks.javelin ?? 0) > 0, timeout: 60,
  },
  {
    id: 'javelin', when: (g) => (g.player.skillRanks.javelin ?? 0) > 0 && nearEnemy(g, 14),
    text: { pad: ['X', 'Hurl a Lapis Javelin. It spends Anima, the blue orb'], kbm: ['Right click', 'Hurl a Lapis Javelin. It spends Anima, the blue orb'] },
    done: (g, s) => s.casts.javelin >= 2, timeout: 25,
  },
  {
    id: 'map', when: (g) => g.quests.index >= 2 && !g.combatNearby,
    text: { pad: ['Back', 'Open the map. Waypoints you discover allow fast travel'], kbm: ['M', 'Open the map. Waypoints you discover allow fast travel'] },
    done: (g, s) => s.maps >= 1, timeout: 20,
  },
  {
    id: 'aspect', when: (g) => g.player.level >= 3 && !g.combatNearby,
    text: { pad: ['D-pad ◀ ▶', 'New Tether Aspect unlocked: try the Aspect of Gibil (fire)'], kbm: ['R', 'New Tether Aspect unlocked: try the Aspect of Gibil (fire)'] },
    done: (g, s) => s.aspects >= 1, timeout: 25,
  },
  {
    id: 'portal', when: (g) => g.player.inventory.length >= 12 && !g.combatNearby && !g.inSafeZone,
    text: { pad: ['D-pad ▲', 'Town Portal: return to Eridu to sell loot to Ubar'], kbm: ['T', 'Town Portal: return to Eridu to sell loot to Ubar'] },
    done: (g, s) => s.portals >= 1, timeout: 30,
  },
  // Night of the Gidim (src/game/gidim.js): the first night, and the first Ghost-ash.
  {
    id: 'lanterns', when: (g) => g.isNight && !!g.flags.gidimSeen && g.settings.get('gidim') !== false,
    text: {
      pad: ['\u263E', 'The gidim cannot enter shrines, waypoints or lantern light. Your sedu spirit is a lantern now: sweep its tether across them to ward them back'],
      kbm: ['\u263E', 'The gidim cannot enter shrines, waypoints or lantern light. Your sedu spirit is a lantern now: sweep its tether across them to ward them back'],
    },
    done: (g, s) => s.wards >= 3, timeout: 26,
  },
  {
    id: 'ash', when: (g) => (g.player.ghostAsh ?? 0) > 0 && !g.combatNearby,
    text: { pad: ['\u25C8', 'Bring Ghost-ash to Ninsun in Eridu for a Night Blessing'], kbm: ['\u25C8', 'Bring Ghost-ash to Ninsun in Eridu for a Night Blessing'] },
    done: (g) => !!g.gidim?.blessing, timeout: 20,
  },
];

function nearEnemy(g, r) {
  return g.enemies.list.some((e) => e.alive && e.spawning <= 0 && e.pos.distanceToSquared(g.player.pos) < r * r);
}

export class Tutorial {
  constructor(g) {
    this.g = g;
    this.current = null;
    this.shownFor = 0;
    this.el = document.getElementById('tutorial');
    this.reset();
    const ev = g.events;
    ev.on('hit', () => this.s.hits++);
    ev.on('tetherHit', () => { if (g.tether.mode === 'manual') this.s.tetherHits++; });
    ev.on('evade', () => this.s.evades++);
    ev.on('potion', () => this.s.potions++);
    ev.on('pickup', (e) => { if (e.kind === 'item') this.s.pickups++; });
    ev.on('skillCast', (e) => { this.s.casts[e.id] = (this.s.casts[e.id] ?? 0) + 1; });
    ev.on('uiOpen', (e) => { if (e.kind === 'map') this.s.maps++; });
    ev.on('aspectChange', () => this.s.aspects++);
    ev.on('portal', () => this.s.portals++);
    ev.on('gidimWard', () => this.s.wards++);
    ev.on('enemyWindup', (e) => { if (e.enemy.pos.distanceTo(g.player.pos) < 7) this.s.windupNear = true; });
  }

  reset() {
    this.s = { moved: 0, hits: 0, tetherHits: 0, evades: 0, potions: 0, pickups: 0, equips: 0, casts: {}, maps: 0, aspects: 0, portals: 0, wards: 0, windupNear: false };
    this.lastPos = null;
    this.equipKey = null;
    this.hide();
  }

  // Called when a game starts or loads; flags.tut persists completed steps.
  start() {
    const f = this.g.flags;
    f.tut ??= { started: true, done: {} };
    this.reset();
  }

  get enabled() { return this.g.settings.get('tutorials') && !this.g.flags.tutorialSkipped; }

  update(dt) {
    const g = this.g, p = g.player;
    if (!g.flags.tut || !this.enabled) { this.hide(); return; }
    if (this.lastPos) this.s.moved += Math.hypot(p.pos.x - this.lastPos.x, p.pos.z - this.lastPos.z);
    this.lastPos = { x: p.pos.x, z: p.pos.z };
    const key = Object.values(p.equipment).map((i) => i?.id).join();
    if (this.equipKey !== null && key !== this.equipKey) this.s.equips++;
    this.equipKey = key;

    const done = g.flags.tut.done;
    if (this.current) {
      this.shownFor += dt;
      if (this.current.done(g, this.s) || (this.current.timeout && this.shownFor > this.current.timeout)) {
        done[this.current.id] = true;
        this.current = null;
        this.hide();
      }
    }
    if (!this.current && !g.uiOpen && !p.dead) {
      const next = STEPS.find((st) => !done[st.id] && st.when(g, this.s));
      if (next) {
        if (next.done(g, this.s)) { done[next.id] = true; return; }
        this.current = next;
        this.shownFor = 0;
        this.show(next);
      }
    }
    if (this.current) this.el.hidden = g.uiOpen;
  }

  show(step) {
    const dev = this.g.input.device === 'pad' ? 'pad' : 'kbm';
    const [key, text] = step.text[dev];
    this.el.innerHTML = `<kbd>${key}</kbd><span>${text}</span>`;
    this.el.hidden = false;
    this.el.classList.remove('pop');
    void this.el.offsetWidth;
    this.el.classList.add('pop');
  }

  hide() { if (this.el) this.el.hidden = true; }
}
