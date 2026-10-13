import { SLOT_LABEL, RARITY, POWERS, KIND_SLOTS, affixLines, sellValue, itemScore, gambleCost, generateItem } from '../game/items.js';
import { SKILLS, SKILL_ORDER, SLOT_BUTTONS, MAX_RANK, ASPECTS, canRankUp, skillCoef } from '../game/skills.js';
import { STAT_INFO, averageHit } from '../game/stats.js';
import { QUESTS } from '../game/quests.js';
import { itemIcon, skillIcon } from './icons.js';
import { escapeHtml } from './hud.js';

const $ = (id) => document.getElementById(id);
const TABS = [['inventory', 'Inventory'], ['skills', 'Skills'], ['quests', 'Quests'], ['system', 'Controls']];
const KIND_LABEL = { weapon: 'Weapon', helm: 'Helm', chest: 'Chest Armor', gloves: 'Gloves', boots: 'Boots', amulet: 'Amulet', ring: 'Ring' };

// Controller-first menus. Every interactive element has data-nav; the D-pad/stick
// moves focus to the nearest element in that direction (mouse hover works too).
export class Menus {
  constructor(g) {
    this.g = g;
    this.root = $('menu');
    this.body = $('menu-body');
    this.tab = 'inventory';
    this.focusKey = null;
    this.merchant = false;
    this.binding = null; // skill id waiting for a button
    this.confirmNew = false;
    this.root.addEventListener('mousemove', (e) => {
      const el = e.target.closest('[data-nav]');
      if (el && el.dataset.nav !== this.focusKey) { this.focusKey = el.dataset.nav; this.render(); }
    });
    this.root.addEventListener('click', (e) => {
      const tab = e.target.closest('[data-tab]');
      if (tab) { this.switchTab(tab.dataset.tab); return; }
      const el = e.target.closest('[data-nav]');
      if (el) { this.focusKey = el.dataset.nav; this.activate('confirm'); }
    });
    this.root.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const el = e.target.closest('[data-nav]');
      if (el) { this.focusKey = el.dataset.nav; this.activate('alt'); }
    });
  }

  get open() { return !this.root.hidden; }

  show(tab = 'inventory', { merchant = false } = {}) {
    this.tab = tab;
    this.merchant = merchant;
    this.focusKey = null;
    this.binding = null;
    this.confirmNew = false;
    this.root.hidden = false;
    this.render();
  }

  hide() { this.root.hidden = true; this.merchant = false; this.binding = null; }

  switchTab(tab) {
    this.tab = tab;
    this.focusKey = null;
    this.binding = null;
    this.confirmNew = false;
    this.render();
  }

  update() {
    const input = this.g.input;
    if (this.binding) {
      // Waiting for the player to press the button they want this skill on.
      for (let i = 0; i < 6; i++) {
        if (input.pressed[`skill${i + 1}`]) { this.bindSkill(this.binding, i); return; }
      }
      if (input.pressed.back) { this.binding = null; this.render(); }
      return;
    }
    if (input.pressed.back || input.pressed.menu) { this.hide(); this.g.ui.closed(); return; }
    if (input.pressed.tabNext || input.pressed.tabPrev) {
      const i = TABS.findIndex(([id]) => id === this.tab);
      const n = (i + (input.pressed.tabNext ? 1 : -1) + TABS.length) % TABS.length;
      this.switchTab(TABS[n][0]);
      return;
    }
    if (input.nav.x || input.nav.y) this.moveFocus(input.nav.x, input.nav.y);
    if (input.pressed.confirm) this.activate('confirm');
    else if (input.pressed.alt) this.activate('alt');
  }

  moveFocus(dx, dy) {
    const els = [...this.body.querySelectorAll('[data-nav]')];
    if (!els.length) return;
    const cur = els.find((e) => e.dataset.nav === this.focusKey);
    if (!cur) { this.focusKey = els[0].dataset.nav; this.render(); return; }
    const r = cur.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    let best = null, bestScore = Infinity;
    for (const e of els) {
      if (e === cur) continue;
      const b = e.getBoundingClientRect();
      const ex = b.left + b.width / 2, ey = b.top + b.height / 2;
      const ddx = ex - cx, ddy = ey - cy;
      const along = ddx * dx + ddy * dy;
      if (along <= 4) continue;
      const across = Math.abs(dx ? ddy : ddx);
      const score = along + across * 2.5;
      if (score < bestScore) { bestScore = score; best = e; }
    }
    if (best) { this.focusKey = best.dataset.nav; this.render(); best.scrollIntoView?.({ block: 'nearest' }); }
  }

  // ---- actions --------------------------------------------------------------------
  activate(kind) {
    const g = this.g, p = g.player, key = this.focusKey;
    if (!key) return;
    const [type, id] = key.split(':');
    if (type === 'inv') {
      const item = p.inventory[+id];
      if (!item) return;
      if (kind === 'confirm') { p.equip(item); g.fx.rumble(0.1, 0.2, 30); } else if (this.merchant) this.sell(item, 1);
      else this.sell(item, 0.25);
    } else if (type === 'eq') {
      if (kind === 'confirm' && p.equipment[id]) { if (!p.unequip(id)) g.hud.notify('Your inventory is full', 'warn'); }
    } else if (type === 'gamble') {
      this.gamble(id);
    } else if (type === 'skill') {
      if (kind === 'confirm') {
        if (canRankUp(id, p.level, p.skillRanks, p.skillPoints)) {
          p.skillPoints--;
          const first = !p.skillRanks[id];
          p.skillRanks[id] = (p.skillRanks[id] ?? 0) + 1;
          if (first && !p.slots.includes(id)) { const empty = p.slots.indexOf(null); if (empty >= 0) p.slots[empty] = id; }
          g.hud.notify(`${SKILLS[id].name} rank ${p.skillRanks[id]}`, 'good');
        } else if (p.skillRanks[id]) {
          this.binding = id;
        } else g.hud.notify(p.skillPoints ? `Unlocks at level ${SKILLS[id].unlock}` : 'No skill points to spend', 'warn');
      } else if (p.skillRanks[id]) this.binding = id;
    } else if (type === 'sys') {
      if (id === 'resume') { this.hide(); g.ui.closed(); return; }
      if (id === 'new') {
        if (!this.confirmNew) { this.confirmNew = true; } else { this.hide(); g.ui.closed(); g.newGame(); return; }
      }
    }
    g.save();
    this.render();
  }

  bindSkill(id, slot) {
    const p = this.g.player;
    const prev = p.slots.indexOf(id);
    if (prev >= 0) p.slots[prev] = p.slots[slot];
    p.slots[slot] = id;
    // The basic skill must stay somewhere so you always have an attack.
    if (!p.slots.includes('strike')) p.slots[p.slots.indexOf(null) >= 0 ? p.slots.indexOf(null) : 0] = 'strike';
    this.binding = null;
    this.g.hud.notify(`${SKILLS[id].name} → ${SLOT_BUTTONS[slot][this.g.input.device === 'pad' ? 'pad' : 'kbm']}`, 'good');
    this.g.save();
    this.render();
  }

  sell(item, rate) {
    const p = this.g.player;
    const value = Math.max(1, Math.round(sellValue(item) * rate));
    p.inventory.splice(p.inventory.indexOf(item), 1);
    p.gold += value;
    this.g.hud.feed(`${rate < 1 ? 'Salvaged' : 'Sold'} ${item.name} · +${value} gold`, 'gold');
  }

  gamble(kind) {
    const g = this.g, p = g.player;
    const cost = gambleCost(p.level);
    if (p.gold < cost) { g.hud.notify('Not enough gold', 'warn'); return; }
    if (p.inventory.length >= 30) { g.hud.notify('Your inventory is full', 'warn'); return; }
    p.gold -= cost;
    const rarity = Math.random() < 0.08 ? 'legendary' : Math.random() < 0.45 ? 'rare' : 'magic';
    const item = generateItem({ ilvl: p.level, rarity, kind });
    p.addItem(item);
    g.hud.feed(item.name, `r-${item.rarity}`);
  }

  // ---- rendering --------------------------------------------------------------------
  render() {
    const g = this.g;
    $('menu-tabs').innerHTML = `<kbd class="pad">LB</kbd><kbd class="kbm">Q</kbd>` + TABS.map(([id, label]) => `<div class="tab ${id === this.tab ? 'on' : ''}" data-tab="${id}">${label}${id === 'skills' && g.player.skillPoints ? ` (${g.player.skillPoints})` : ''}</div>`).join('') + `<kbd class="pad">RB</kbd><kbd class="kbm">E</kbd>`;
    this.body.innerHTML = this[`render_${this.tab}`]();
    const els = [...this.body.querySelectorAll('[data-nav]')];
    if (!els.find((e) => e.dataset.nav === this.focusKey) && els.length) this.focusKey = els[0].dataset.nav;
    for (const e of els) e.classList.toggle('focus', e.dataset.nav === this.focusKey);
    if (this.tab === 'inventory' && els.length) this.body.querySelector('#tt').innerHTML = this.tooltipFor(this.focusKey);
    $('menu-help').innerHTML = this.helpText();
  }

  helpText() {
    const pad = this.g.input.device === 'pad';
    const k = (a, b) => `<kbd>${pad ? a : b}</kbd>`;
    if (this.binding) return `Press the button for <b>${SKILLS[this.binding].name}</b>: ${pad ? 'A, X, Y, RB, RT or LT' : 'left/right mouse or 1 to 4'} · ${k('B', 'Esc')} cancel`;
    if (this.tab === 'inventory') {
      const [type] = (this.focusKey ?? '').split(':');
      const sell = this.merchant ? 'Sell' : 'Salvage for gold';
      if (type === 'inv') return `${k('A', 'Click')} Equip · ${k('X', 'Right-click')} ${sell} · ${k('B', 'Esc')} Close`;
      if (type === 'eq') return `${k('A', 'Click')} Unequip · ${k('B', 'Esc')} Close`;
      if (type === 'gamble') return `${k('A', 'Click')} Buy a random item · ${k('B', 'Esc')} Close`;
    }
    if (this.tab === 'skills') return `${k('A', 'Click')} Learn / rank up (or rebind if you have no points) · ${k('X', 'Right-click')} Assign to a button · ${k('B', 'Esc')} Close`;
    return `${k('LB / RB', 'Q / E')} Switch tab · ${k('B', 'Esc')} Close`;
  }

  render_inventory() {
    const p = this.g.player;
    const s = p.stats;
    const doll = ['helm', 'amulet', 'weapon', 'chest', 'gloves', 'ring1', 'boots', 'ring2'];
    const layout = { helm: [2, 1], amulet: [3, 1], weapon: [1, 2], chest: [2, 2], gloves: [3, 2], ring1: [1, 3], boots: [2, 3], ring2: [3, 3] };
    const cell = (item, nav, label, extra = '') => {
      const color = item ? RARITY[item.rarity].color : '#5a4a3a';
      return `<div class="cell focusable ${item ? `rb-${item.rarity}` : ''}" data-nav="${nav}" ${extra}>${item ? itemIcon(item.kind, color) : ''}${label ? `<span class="lbl">${label}</span>` : ''}${item && nav.startsWith('inv') && isUpgrade(p, item) ? '<span class="up">▲</span>' : ''}</div>`;
    };
    const dollHtml = doll.map((slot) => cell(p.equipment[slot], `eq:${slot}`, SLOT_LABEL[slot], `style="grid-column:${layout[slot][0]};grid-row:${layout[slot][1]}"`)).join('');
    const grid = Array.from({ length: 30 }, (_, i) => p.inventory[i] ? cell(p.inventory[i], `inv:${i}`, '') : '<div class="cell"></div>').join('');
    const statRows = [
      ['Damage per hit', Math.round(averageHit(s))],
      ['Weapon damage', `${s.weaponMin}–${s.weaponMax}`],
      ['Attack speed', s.attackSpeed.toFixed(2)],
      ['Maximum Life', s.maxLife],
      ['Armor', s.armor],
      ['Critical chance', `${(s.critChance * 100).toFixed(1)}%`],
      ['Critical damage', `+${Math.round((s.critMult - 1) * 100)}%`],
      ['Movement speed', `${Math.round((s.moveSpeed / 6.2) * 100)}%`],
      ['Cooldown reduction', `${Math.round(s.cdr * 100)}%`],
      ['Tether damage', `+${Math.round((s.tetherMult - 1) * 100)}%`],
    ];
    const gambleHtml = this.merchant ? `<h3 style="margin-top:14px">Ubar's wares · ${gambleCost(p.level)} gold each</h3><div class="gamble">${Object.keys(KIND_SLOTS).map((k) => `<div class="g-btn focusable" data-nav="gamble:${k}">${itemIcon(k, '#d6a740').replace('<svg', '<svg width="18" height="18"')} ${KIND_LABEL[k]}</div>`).join('')}</div>` : '';
    return `<div class="inv">
      <div><h3>${this.merchant ? 'Trading with Ubar' : 'Equipped'}</h3><div class="paperdoll">${dollHtml}</div>
        <div class="stats">${statRows.map(([a, b]) => `<span>${a}</span><b>${b}</b>`).join('')}</div>
        <div class="gold-line">${p.gold} gold · ${p.potions}/${p.maxPotions} potions</div></div>
      <div><h3>Inventory (${p.inventory.length}/30)</h3><div class="grid">${grid}</div>${gambleHtml}</div>
      <div><h3>Details</h3><div id="tt"></div></div>
    </div>`;
  }

  tooltipFor(key) {
    const p = this.g.player;
    if (!key) return '';
    const [type, id] = key.split(':');
    let item = null;
    if (type === 'inv') item = p.inventory[+id];
    if (type === 'eq') item = p.equipment[id];
    if (type === 'gamble') return `<div class="tooltip"><div class="tt-name">Mystery ${KIND_LABEL[id]}</div><div class="tt-type">Magic, Rare or (rarely) Legendary · item level ${p.level}</div></div>`;
    if (!item) return `<div class="tooltip"><div class="tt-type">Empty</div></div>`;
    let html = itemTooltip(item);
    if (type === 'inv') {
      const cmp = p.comparisonFor(item);
      if (cmp) html += `<div class="tooltip"><div class="tt-eq">Equipped</div>${itemTooltip(cmp, true)}${deltaLines(item, cmp)}</div>`;
      html += `<div class="tt-type" style="margin-top:6px">${this.merchant ? `Sells for ${sellValue(item)} gold` : `Salvages for ${Math.max(1, Math.round(sellValue(item) * 0.25))} gold (sell to Ubar in town for ${sellValue(item)})`}</div>`;
    }
    return html;
  }

  render_skills() {
    const p = this.g.player;
    const rows = SKILL_ORDER.map((id) => {
      const d = SKILLS[id];
      const rank = p.skillRanks[id] ?? 0;
      const locked = p.level < d.unlock;
      const can = canRankUp(id, p.level, p.skillRanks, p.skillPoints);
      const meta = [d.category, d.cost ? `${d.cost} Anima` : d.gain ? `+${d.gain} Anima` : null, d.cooldown ? `${d.cooldown}s cooldown` : null, d.coef ? `${Math.round(skillCoef(id, Math.max(1, rank)) * 100)}% weapon damage` : null].filter(Boolean).join(' · ');
      return `<div class="skill-row focusable ${locked ? 'locked' : ''}" data-nav="skill:${id}">
        <div class="ic">${skillIcon(id, locked ? '#5a4a3a' : d.color)}</div>
        <div><div class="nm">${d.name}</div><div class="cat">${locked ? `Unlocks at level ${d.unlock}` : meta}</div><div class="ds">${d.desc}</div></div>
        <div><div class="pips">${Array.from({ length: MAX_RANK }, (_, i) => `<i class="${i < rank ? 'on' : ''}"></i>`).join('')}</div>${can ? '<div class="pos" style="font-size:12px;margin-top:4px">Can rank up</div>' : ''}</div>
      </div>`;
    }).join('');
    const pad = this.g.input.device === 'pad';
    const binds = SLOT_BUTTONS.map((b, i) => {
      const id = p.slots[i];
      return `<div class="bind"><kbd>${pad ? b.pad : b.kbm}</kbd>${id ? skillIcon(id, SKILLS[id].color) : ''}<span>${id ? SKILLS[id].name : 'Empty'}</span></div>`;
    }).join('');
    const aspects = ASPECTS.map((a) => `<div style="${p.level < a.unlock ? 'opacity:.45' : ''}"><i style="background:${a.css}"></i><span><b>${a.name}</b>${p.level < a.unlock ? ` (level ${a.unlock})` : ''}: ${a.desc}</span></div>`).join('');
    return `<div class="skills">
      <div><h3>${p.skillPoints} skill point${p.skillPoints === 1 ? '' : 's'} to spend</h3>${rows}</div>
      <div><h3>Action bar</h3><div class="bindings">${binds}</div>
        ${this.binding ? `<div class="bind-wait">Press a skill button for ${SKILLS[this.binding].name}</div>` : ''}
        <h3 style="margin-top:16px">Tether Aspects (${pad ? 'D-pad ◀ ▶' : 'R / F'})</h3><div class="aspects">${aspects}</div></div>
    </div>`;
  }

  render_quests() {
    const q = this.g.quests;
    const cur = q.active;
    const list = QUESTS.map((x, i) => `<div class="${i < q.index ? 'done' : ''}">${i < q.index ? '✓' : i === q.index ? '◆' : '·'} ${x.title}</div>`).join('');
    const body = q.pending ? `<h2>${escapeHtml(q.pending.title)}</h2><p>Ninsun, High Priestess of Eridu Outpost, waits for you by the temple.</p>`
      : cur ? `<h2>${cur.title}</h2><p>${escapeHtml(cur.intro)}</p><p><b>${escapeHtml(q.objectiveText())}</b></p><p class="tt-type">Reward: ${cur.reward.xp} XP, ${cur.reward.gold} gold${cur.reward.item ? `, a ${cur.reward.item.rarity} item` : ''}</p>`
        : `<h2>The First Gate is open</h2><p>Neti has fallen. Six gates remain, and the land is still full of things to kill. Hunt elites, clear the Ganzir Stair again for better loot, and finish the Ritual of the Gallu.</p>`;
    return `<div class="quest-log"><div>${body}</div><div><h3>Main story</h3>${list}</div></div>`;
  }

  render_system() {
    return `<div class="controls">
      <div><h3>Controller</h3><table>
        <tr><td>Left stick</td><td>Move</td></tr><tr><td>Right stick</td><td>Steer the Tether (your spirit sweeps on its own if you don't)</td></tr>
        <tr><td>A · X · Y · RB · RT · LT</td><td>Skills (A also talks, loots and opens when no enemies are near)</td></tr>
        <tr><td>B</td><td>Evade</td></tr><tr><td>LB</td><td>Healing potion</td></tr><tr><td>D-pad ◀ ▶</td><td>Change Tether Aspect</td></tr>
        <tr><td>D-pad ▲</td><td>Town Portal</td></tr><tr><td>D-pad ▼</td><td>Zoom</td></tr><tr><td>Back / View</td><td>Map and fast travel</td></tr><tr><td>Start / Menu</td><td>Inventory, skills, quests</td></tr>
      </table></div>
      <div><h3>Keyboard &amp; mouse</h3><table>
        <tr><td>WASD</td><td>Move</td></tr><tr><td>Mouse</td><td>Aim skills and steer the Tether</td></tr>
        <tr><td>Left / right click</td><td>Skill slots 1 and 2</td></tr><tr><td>1 · 2 · 3 · 4</td><td>Skill slots 3 to 6</td></tr>
        <tr><td>Space</td><td>Evade</td></tr><tr><td>Q</td><td>Healing potion</td></tr><tr><td>E</td><td>Interact / pick up</td></tr>
        <tr><td>R / F</td><td>Change Tether Aspect</td></tr><tr><td>T</td><td>Town Portal</td></tr><tr><td>Z / wheel</td><td>Zoom</td></tr>
        <tr><td>M / Tab</td><td>Map</td></tr><tr><td>I · K · J</td><td>Inventory · Skills · Quests</td></tr>
      </table></div>
    </div>
    <div class="sys-actions">
      <div class="btn focusable" data-nav="sys:resume">Resume</div>
      <div class="btn focusable" data-nav="sys:new">${this.confirmNew ? 'Confirm: erase this hero and start over' : 'Start a new game'}</div>
    </div>
    <p class="tt-type">Progress saves automatically in this browser.</p>`;
  }
}

function itemTooltip(item, compact = false) {
  const R = RARITY[item.rarity];
  const main = item.base.min ? `${item.base.min}–${item.base.max} damage · ${item.base.speed.toFixed(2)} attacks/s` : item.base.armor ? `${item.base.armor} Armor` : '';
  const inner = `<div class="tt-name" style="color:${R.color}">${escapeHtml(item.name)}</div>
    <div class="tt-type">${R.label} ${KIND_LABEL[item.kind]} · item level ${item.ilvl}</div>
    ${main ? `<div class="tt-main">${main}</div>` : ''}
    ${affixLines(item).map((l) => `<div class="tt-aff">${l}</div>`).join('')}
    ${item.power ? `<div class="tt-power">◆ ${POWERS[item.power].text}</div>` : ''}`;
  return compact ? inner : `<div class="tooltip">${inner}</div>`;
}

// Stat-by-stat comparison vs the equipped item.
function deltaLines(item, eq) {
  const sum = (it) => {
    const m = {};
    for (const a of it.affixes) m[a.stat] = (m[a.stat] ?? 0) + a.value;
    if (it.base.armor) m.armor = (m.armor ?? 0) + it.base.armor;
    return m;
  };
  const a = sum(item), b = sum(eq);
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const lines = [];
  if (item.base.min) {
    const d = (item.base.min + item.base.max) / 2 - (eq.base.min + eq.base.max) / 2;
    lines.push(`<div class="${d >= 0 ? 'pos' : 'neg'}">${d >= 0 ? '+' : ''}${d.toFixed(1)} average weapon damage</div>`);
  }
  for (const k of keys) {
    const d = (a[k] ?? 0) - (b[k] ?? 0);
    if (Math.abs(d) < 0.05) continue;
    const v = STAT_INFO[k].fmt(Math.abs(d)).replace('+', '');
    lines.push(`<div class="${d > 0 ? 'pos' : 'neg'}">${d > 0 ? '+' : '−'}${v} ${STAT_INFO[k].label}</div>`);
  }
  if (item.power !== eq.power && (item.power || eq.power)) lines.push(`<div class="${item.power ? 'pos' : 'neg'}">${item.power ? 'Gains' : 'Loses'} a legendary power</div>`);
  return `<div class="tt-delta">${lines.join('') || 'No stat differences'}</div>`;
}

function isUpgrade(p, item) {
  const eq = p.comparisonFor(item);
  return !eq || itemScore(item) > itemScore(eq) * 1.05;
}

