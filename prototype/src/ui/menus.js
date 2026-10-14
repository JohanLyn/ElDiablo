import { SLOT_LABEL, RARITY, POWERS, KIND_SLOTS, affixLines, sellValue, itemScore, gambleCost, generateItem } from '../game/items.js';
import { SKILLS, SKILL_ORDER, SLOT_BUTTONS, MAX_RANK, ASPECTS, canRankUp, skillCoef } from '../game/skills.js';
import { STAT_INFO, averageHit } from '../game/stats.js';
import { QUESTS } from '../game/quests.js';
import { QUALITY } from '../core/settings.js';
import { itemIcon, skillIcon } from './icons.js';
import { escapeHtml } from './hud.js';
import { padGlyph, keyGlyph, touchGlyph } from './glyphs.js';

const $ = (id) => document.getElementById(id);
const TABS = [['inventory', 'Inventory'], ['skills', 'Skills'], ['quests', 'Quests'], ['settings', 'Settings'], ['system', 'Controls']];
const KIND_LABEL = { weapon: 'Weapon', helm: 'Helm', chest: 'Chest Armor', gloves: 'Gloves', boots: 'Boots', amulet: 'Amulet', ring: 'Ring' };
const SLOT_KIND = { ring1: 'ring', ring2: 'ring' };

// Settings screen layout: two columns of grouped rows.
const SETTINGS = [
  [
    ['Graphics', [
      { key: 'quality', label: 'Graphics quality', type: 'choice', options: Object.entries(QUALITY).map(([id, q]) => [id, q.label]), desc: 'Shadows, bloom, resolution and particle density. Mobile is for phones; the light and shader set of a new preset applies after a reload.' },
      { key: 'showFps', label: 'Show FPS', type: 'toggle', desc: 'A small corner readout: frames per second, frame time, render scale and scene load. Also: add ?fps to the address.' },
      { key: 'timeOfDay', label: 'Time of day', type: 'choice', options: [['cycle', 'Cycle'], ['dawn', 'Dawn'], ['noon', 'Noon'], ['golden', 'Golden hour'], ['dusk', 'Dusk'], ['night', 'Night']], desc: 'Let the day pass (a full day takes 14 minutes) or hold one time.' },
    ]],
    ['Audio', [
      { key: 'master', label: 'Master volume', type: 'slider', min: 0, max: 1, step: 0.05, fmt: (v) => `${Math.round(v * 100)}` },
      { key: 'music', label: 'Music volume', type: 'slider', min: 0, max: 1, step: 0.05, fmt: (v) => `${Math.round(v * 100)}` },
      { key: 'sfx', label: 'Effects volume', type: 'slider', min: 0, max: 1, step: 0.05, fmt: (v) => `${Math.round(v * 100)}` },
    ]],
  ],
  [
    ['Touch controls', [
      { key: 'touchScale', label: 'Touch layout size', type: 'slider', min: 0.8, max: 1.3, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%`, desc: 'Size of the on-screen sticks and buttons.' },
      { key: 'touchOpacity', label: 'Stick and button opacity', type: 'slider', min: 0.3, max: 1, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%` },
      { key: 'touchLefty', label: 'Left-handed layout', type: 'toggle', desc: 'Swap the sides: move with the right thumb, attack and skills on the left.' },
    ], 'only-touch'],
    ['Gameplay', [
      { key: 'screenShake', label: 'Screen shake', type: 'toggle' },
      { key: 'damageNumbers', label: 'Damage numbers', type: 'toggle' },
      { key: 'rumble', label: 'Controller rumble', type: 'toggle' },
      { key: 'tutorials', label: 'Tutorial hints', type: 'toggle' },
      { key: 'gidim', label: 'Night of the Gidim', type: 'toggle', desc: 'The monsters you slay by day rise as ghosts at night. Off: no marks, no risings.' },
    ]],
    ['Interface', [
      { key: 'uiScale', label: 'UI scale', type: 'slider', min: 0.9, max: 1.3, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%` },
      { key: 'colorblind', label: 'Colour-blind rarity markers', type: 'toggle', desc: 'Adds ◆ ★ ✦ symbols and a clearer palette to item rarities.' },
    ]],
  ],
];
const SETTING_BY_KEY = Object.fromEntries(SETTINGS.flat().flatMap(([, rows]) => rows).map((r) => [r.key, r]));

// Controller-first menus. Every interactive element has data-nav; the D-pad/stick
// moves focus to the nearest element in that direction (mouse hover works too).
export class Menus {
  constructor(g) {
    this.g = g;
    this.root = $('menu');
    this.body = $('menu-body');
    this.tab = 'inventory';
    this.only = null; // restrict to these tabs (title screen settings / controls)
    this.focusKey = null;
    this.merchant = false;
    this.binding = null; // skill id waiting for a button
    this.confirmNew = false;
    this.animate = false;
    this.root.addEventListener('mousemove', (e) => {
      const el = e.target.closest('[data-nav]');
      if (this.drag || this.g.input.emulatedMouse()) return; // taps replay as mouse moves: ignore those
      if (el && el.dataset.nav !== this.focusKey) { this.focusKey = el.dataset.nav; this.render(); }
    });
    this.root.addEventListener('mousedown', (e) => {
      const sl = e.target.closest('[data-slider]');
      if (!sl) return;
      this.drag = sl.dataset.slider;
      this.focusKey = `set:${this.drag}`;
      this.dragTo(e.clientX);
      const move = (ev) => this.dragTo(ev.clientX);
      const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); this.drag = null; this.render(); };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
      e.preventDefault();
    });
    // Touch sliders: pointer events, since a finger drag does not produce mouse events.
    this.root.addEventListener('pointerdown', (e) => {
      const sl = e.pointerType === 'mouse' ? null : e.target.closest('[data-slider]');
      if (!sl) return;
      this.drag = sl.dataset.slider;
      this.focusKey = `set:${this.drag}`;
      this.dragTo(e.clientX);
      try { sl.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      const move = (ev) => this.dragTo(ev.clientX);
      const up = () => { sl.removeEventListener('pointermove', move); sl.removeEventListener('pointerup', up); sl.removeEventListener('pointercancel', up); this.drag = null; this.render(); };
      sl.addEventListener('pointermove', move);
      sl.addEventListener('pointerup', up);
      sl.addEventListener('pointercancel', up);
      e.preventDefault();
    });
    this.root.addEventListener('click', (e) => {
      if (e.target.closest('[data-close]')) { this.g.ui.closeMenu(); return; }
      const act = e.target.closest('[data-do]');
      if (act) { this.doAction(act.dataset.do); return; }
      const tab = e.target.closest('[data-tab]');
      if (tab) { this.switchTab(tab.dataset.tab); return; }
      if (e.target.closest('[data-slider]')) return;
      const seg = e.target.closest('[data-seg]');
      if (seg) { const [k, v] = seg.dataset.seg.split(':'); this.focusKey = `set:${k}`; this.setSetting(k, v); this.render(); return; }
      const step = e.target.closest('[data-step]');
      if (step) { const [k, d] = step.dataset.step.split(':'); this.focusKey = `set:${k}`; this.adjustSetting(k, +d); return; }
      const el = e.target.closest('[data-nav]');
      if (el) {
        this.focusKey = el.dataset.nav;
        // Touch: a tap selects (details and an explicit button appear); it never equips or salvages by itself.
        if (this.touch && /^(inv|eq|skill|gamble):/.test(this.focusKey)) { this.picked = true; this.render(); return; }
        this.activate('confirm');
      }
    });
    this.root.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (this.touch) return; // a long press must not salvage anything
      const el = e.target.closest('[data-nav]');
      if (el) { this.focusKey = el.dataset.nav; this.activate('alt'); }
    });
  }

  get open() { return !this.root.hidden; }

  get touch() { return this.g.input.device === 'touch'; }

  get tabs() { return this.only ? TABS.filter(([id]) => this.only.includes(id)) : TABS; }

  show(tab = 'inventory', { merchant = false, only = null } = {}) {
    this.only = only;
    this.tab = tab;
    this.merchant = merchant;
    this.focusKey = null;
    this.binding = null;
    this.confirmNew = false;
    this.picked = false;
    this.animate = true;
    this.root.hidden = false;
    this.render();
  }

  hide() { this.root.hidden = true; this.merchant = false; this.binding = null; this.only = null; }

  switchTab(tab) {
    if (tab === this.tab) return;
    this.tab = tab;
    this.focusKey = null;
    this.binding = null;
    this.confirmNew = false;
    this.picked = false;
    this.animate = true;
    this.body.scrollTop = 0;
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
    if (input.pressed.back || input.pressed.menu) { this.g.ui.closeMenu(); return; }
    if (input.pressed.tabNext || input.pressed.tabPrev) {
      const tabs = this.tabs;
      const i = tabs.findIndex(([id]) => id === this.tab);
      const n = (i + (input.pressed.tabNext ? 1 : -1) + tabs.length) % tabs.length;
      this.switchTab(tabs[n][0]);
      return;
    }
    const [ftype, fid] = (this.focusKey ?? '').split(':');
    if (input.nav.x && ftype === 'set') this.adjustSetting(fid, input.nav.x);
    else if (input.nav.x || input.nav.y) {
      if (!this.body.querySelector('[data-nav]')) this.body.scrollBy({ top: input.nav.y * 90 });
      else this.moveFocus(input.nav.x, input.nav.y);
    }
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
    if (best) { this.focusKey = best.dataset.nav; this.render(); this.body.querySelector('.focus')?.scrollIntoView?.({ block: 'nearest' }); }
  }

  // ---- settings ---------------------------------------------------------------------
  setSetting(key, value) {
    const def = SETTING_BY_KEY[key];
    if (!def) return;
    if (def.type === 'slider') value = Math.round(Math.max(def.min, Math.min(def.max, value)) / def.step) * def.step, value = +value.toFixed(3);
    this.g.settings.set(key, value);
    this.g.events.emit('uiMove', {});
  }

  adjustSetting(key, dir) {
    const def = SETTING_BY_KEY[key];
    if (!def) return;
    const cur = this.g.settings.get(key);
    if (def.type === 'toggle') this.setSetting(key, !cur);
    else if (def.type === 'slider') this.setSetting(key, cur + dir * def.step);
    else if (def.type === 'choice') {
      const i = def.options.findIndex(([id]) => id === cur);
      const n = Math.max(0, Math.min(def.options.length - 1, i + dir));
      this.setSetting(key, def.options[n][0]);
    }
    this.render();
  }

  dragTo(clientX) {
    const key = this.drag;
    const def = SETTING_BY_KEY[key];
    const el = this.body.querySelector(`[data-slider="${key}"]`);
    if (!def || !el) return;
    const r = el.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    this.setSetting(key, def.min + ratio * (def.max - def.min));
    // Update in place so the drag keeps its element.
    const v = this.g.settings.get(key);
    el.querySelector('i').style.width = `${((v - def.min) / (def.max - def.min)) * 100}%`;
    el.closest('.set-row').querySelector('.sv').textContent = def.fmt(v);
  }

  resetTutorials() {
    const g = this.g;
    if (g.flags?.tut) g.flags.tut.done = {};
    if (g.flags) delete g.flags.tutorialSkipped;
    g.settings.set('tutorials', true);
    g.tutorial?.reset?.();
    g.save();
    g.hud.notify('Tutorial hints will appear again', 'good');
  }

  // ---- touch actions: explicit buttons next to a selection ----------------------------------------
  doAction(what) {
    const g = this.g, p = g.player;
    const [verb, arg] = what.split(':');
    const [type, id] = (this.focusKey ?? '').split(':');
    if (verb === 'equip' && type === 'inv') this.activate('confirm');
    else if (verb === 'salvage' && type === 'inv') this.activate('alt');
    else if (verb === 'unequip' && type === 'eq') this.activate('confirm');
    else if (verb === 'buy' && type === 'gamble') this.activate('confirm');
    else if (verb === 'rank' && type === 'skill') {
      if (canRankUp(id, p.level, p.skillRanks, p.skillPoints)) this.activate('confirm');
      else g.hud.notify((p.skillRanks[id] ?? 0) >= MAX_RANK ? 'Already at the highest rank' : p.skillPoints ? `Unlocks at level ${SKILLS[id].unlock}` : 'No skill points to spend', 'warn');
    } else if (verb === 'assign' && type === 'skill') {
      if (p.skillRanks[id]) { this.binding = id; this.render(); } else g.hud.notify('Learn this skill first', 'warn');
    } else if (verb === 'bind' && this.binding && this.touch) this.bindSkill(this.binding, +arg);
    else if (verb === 'cancel') { this.binding = null; this.render(); }
  }

  // ---- actions --------------------------------------------------------------------
  activate(kind) {
    const g = this.g, p = g.player, key = this.focusKey;
    if (!key) return;
    const [type, id] = key.split(':');
    if (type === 'set') {
      const def = SETTING_BY_KEY[id];
      if (kind !== 'confirm') return;
      if (def?.type === 'toggle') this.adjustSetting(id, 1);
      else if (def?.type === 'choice') {
        const i = def.options.findIndex(([o]) => o === this.g.settings.get(id));
        this.setSetting(id, def.options[(i + 1) % def.options.length][0]);
        this.render();
      }
      return;
    }
    if (type === 'act') {
      if (id === 'reload') { g.save(); location.reload(); return; }
      if (id === 'resetTut') this.resetTutorials();
      else if (id === 'new') {
        if (!this.confirmNew) this.confirmNew = true;
        else { g.ui.menuParent = null; g.ui.closeMenu(); g.newGame(); return; }
      }
      this.render();
      return;
    }
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
      if (id === 'resume') { g.ui.closeMenu(); return; }
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
    this.g.hud.notify(`${SKILLS[id].name} → ${this.touch ? `button ${slot + 1}` : SLOT_BUTTONS[slot][this.g.input.device === 'pad' ? 'pad' : 'kbm']}`, 'good');
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
    const tabs = this.tabs;
    const nav = tabs.length > 1;
    $('menu-tabs').innerHTML = (nav ? `${padGlyph('LB')}${keyGlyph('Q')}` : '') + tabs.map(([id, label]) => `<div class="tab ${id === this.tab ? 'on' : ''}" data-tab="${id}">${label}${id === 'skills' && g.player.skillPoints ? `<em class="badge">${g.player.skillPoints}</em>` : ''}</div>`).join('') + (nav ? `${padGlyph('RB')}${keyGlyph('E')}` : '');
    this.body.innerHTML = this[`render_${this.tab}`]();
    if (this.animate) {
      this.animate = false;
      this.body.classList.remove('tab-in'); void this.body.offsetWidth; this.body.classList.add('tab-in');
    }
    const els = [...this.body.querySelectorAll('[data-nav]')];
    if (this.touch && !this.picked) this.focusKey = null; // nothing is selected until the first tap
    else if (!els.find((e) => e.dataset.nav === this.focusKey) && els.length) this.focusKey = els[0].dataset.nav;
    for (const e of els) e.classList.toggle('focus', e.dataset.nav === this.focusKey);
    if (this.tab === 'inventory' && els.length) {
      this.body.querySelector('#tt').innerHTML = this.tooltipFor(this.focusKey) || '<div class="tt-hint">Tap an item to inspect it.</div>';
      this.body.querySelector('#tt-act').innerHTML = this.inventoryActions(this.focusKey);
    }
    if (this.tab === 'skills') this.body.querySelector('#skill-act').innerHTML = this.skillActions(this.focusKey);
    if (this.tab === 'settings') {
      const def = SETTING_BY_KEY[(this.focusKey ?? '').split(':')[1]];
      const d = this.body.querySelector('#set-desc');
      if (d) d.textContent = def?.desc ?? '';
    }
    $('menu-help').innerHTML = this.helpText();
  }

  helpText() {
    const k = (a, b) => `<span class="hk">${padGlyph(a)}${keyGlyph(b)}</span>`;
    const close = `${k('B', 'Esc')} ${this.g.ui.menuParent ? 'Back' : 'Close'}`;
    if (this.binding) return `Press the button for <b>${SKILLS[this.binding].name}</b>: <span class="pad">A, X, Y, RB, RT or LT</span><span class="kbm">left/right mouse or 1 to 4</span> · ${k('B', 'Esc')} cancel`;
    if (this.tab === 'inventory') {
      const [type] = (this.focusKey ?? '').split(':');
      const sell = this.merchant ? 'Sell' : 'Salvage for gold';
      if (type === 'inv') return `${k('A', 'Click')} Equip · ${k('X', 'Right-click')} ${sell} · ${close}`;
      if (type === 'eq') return `${k('A', 'Click')} Unequip · ${close}`;
      if (type === 'gamble') return `${k('A', 'Click')} Buy a random item · ${close}`;
    }
    if (this.tab === 'skills') return `${k('A', 'Click')} Learn / rank up (or rebind if you have no points) · ${k('X', 'Right-click')} Assign to a button · ${close}`;
    if (this.tab === 'settings') return `<span class="pad">D-pad ◀ ▶ change value · ${padGlyph('A')} toggle</span><span class="kbm">Click or drag to change · arrow keys ◀ ▶</span> · ${close}`;
    return `${this.tabs.length > 1 ? `${k('LB', 'Q')} ${k('RB', 'E')} Switch tab · ` : ''}${close}`;
  }

  // Touch: what the selected item can do. Tap = select, these buttons = act.
  inventoryActions(key) {
    const [type] = (key ?? '').split(':');
    const b = (what, label, cls = '') => `<div class="btn plaque t-do ${cls}" data-do="${what}"><span>${label}</span></div>`;
    if (type === 'inv') return b('equip', 'Equip') + b('salvage', this.merchant ? 'Sell' : 'Salvage', 'danger');
    if (type === 'eq' && this.g.player.equipment[key.split(':')[1]]) return b('unequip', 'Unequip');
    if (type === 'gamble') return b('buy', 'Buy');
    return '';
  }

  skillActions(key) {
    const [type, id] = (key ?? '').split(':');
    if (this.binding) return `<div class="sa-name">Assigning ${SKILLS[this.binding].name}</div><div class="t-actions"><div class="btn plaque t-do" data-do="cancel"><span>Cancel</span></div></div>`;
    if (type !== 'skill') return '<div class="sa-hint">Tap a skill to learn it, rank it up or put it on a button.</div>';
    const p = this.g.player, rank = p.skillRanks[id] ?? 0;
    const can = canRankUp(id, p.level, p.skillRanks, p.skillPoints);
    const b = (what, label, cls = '') => `<div class="btn plaque t-do ${cls}" data-do="${what}"><span>${label}</span></div>`;
    return `<div class="sa-name">${SKILLS[id].name}${rank ? ` · rank ${rank}` : ''}</div><div class="t-actions">${b(`rank:${id}`, rank ? 'Rank up' : 'Learn', can ? 'go' : 'dim')}${rank ? b(`assign:${id}`, 'Assign to button') : ''}</div>`;
  }

  render_inventory() {
    const p = this.g.player;
    const s = p.stats;
    const doll = ['helm', 'amulet', 'weapon', 'chest', 'gloves', 'ring1', 'boots', 'ring2'];
    const layout = { helm: [2, 1], amulet: [3, 1], weapon: [1, 2], chest: [2, 2], gloves: [3, 2], ring1: [1, 3], boots: [2, 3], ring2: [3, 3] };
    const cell = (item, nav, label, extra = '', ghost = null) => {
      const inner = item ? itemIcon(item.kind, 'currentColor') : ghost ? `<span class="ghost-ic">${itemIcon(ghost, 'currentColor')}</span>` : '';
      return `<div class="cell ${nav ? 'focusable' : ''} ${item ? `rb-${item.rarity} r-${item.rarity}` : ''}" ${nav ? `data-nav="${nav}"` : ''} ${extra}>${inner}${label ? `<span class="lbl">${label}</span>` : ''}${item && nav.startsWith('inv') && isUpgrade(p, item) ? '<span class="up">▲</span>' : ''}</div>`;
    };
    const dollHtml = doll.map((slot) => cell(p.equipment[slot], `eq:${slot}`, SLOT_LABEL[slot], `style="grid-column:${layout[slot][0]};grid-row:${layout[slot][1]}"`, SLOT_KIND[slot] ?? slot)).join('');
    const grid = Array.from({ length: 30 }, (_, i) => p.inventory[i] ? cell(p.inventory[i], `inv:${i}`, '') : '<div class="cell empty"></div>').join('');
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
    const gambleHtml = this.merchant ? `<h3 class="sec" style="margin-top:14px">Ubar's wares · ${gambleCost(p.level)} gold each</h3><div class="gamble">${Object.keys(KIND_SLOTS).map((k) => `<div class="g-btn focusable" data-nav="gamble:${k}">${itemIcon(k, '#e8c86a').replace('<svg', '<svg width="18" height="18"')} ${KIND_LABEL[k]}</div>`).join('')}</div>` : '';
    return `<div class="inv">
      <div class="inv-col"><h3 class="sec">${this.merchant ? 'Trading with Ubar' : 'Equipped'}</h3><div class="paperdoll">${dollHtml}</div>
        <div class="stats">${statRows.map(([a, b]) => `<span>${a}</span><b>${b}</b>`).join('')}</div>
        <div class="gold-line"><i class="coin"></i>${p.gold} gold <span class="sep">·</span> ${p.potions}/${p.maxPotions} potions${p.ghostAsh > 0 || this.g.flags.gidimSeen ? ` <span class="sep">·</span> <span class="ash-line"><i class="ash-gem">◈</i>${p.ghostAsh ?? 0} Ghost-ash</span>` : ''}</div></div>
      <div class="inv-col"><h3 class="sec">Inventory <small>${p.inventory.length}/30</small></h3><div class="grid">${grid}</div>${gambleHtml}</div>
      <div class="inv-col inv-detail"><h3 class="sec">Details</h3><div id="tt"></div><div id="tt-act" class="t-actions only-touch"></div></div>
    </div>`;
  }

  tooltipFor(key) {
    const p = this.g.player;
    if (!key) return '';
    const [type, id] = key.split(':');
    let item = null;
    if (type === 'inv') item = p.inventory[+id];
    if (type === 'eq') item = p.equipment[id];
    if (type === 'gamble') return `<div class="tooltip rar-rare"><div class="tt-head"><div class="tt-name">Mystery ${KIND_LABEL[id]}</div><div class="tt-type">Magic, Rare or (rarely) Legendary</div></div><div class="tt-body"><div class="tt-ilvl">Item level ${p.level}</div><div class="tt-sep"></div><div class="tt-note">Gamble ${gambleCost(p.level)} gold for a surprise.</div></div></div>`;
    if (!item) return `<div class="tooltip empty"><div class="tt-body"><div class="tt-type">Empty slot</div></div></div>`;
    let html = itemTooltip(item);
    if (type === 'inv') {
      const cmp = p.comparisonFor(item);
      if (cmp) html += `<div class="tt-vs"><div class="tt-eq">Currently equipped</div>${itemTooltip(cmp, true)}</div>${deltaLines(item, cmp)}`;
      html += `<div class="tt-sell">${this.merchant ? `Sells for <b>${sellValue(item)}</b> gold` : `Salvages for <b>${Math.max(1, Math.round(sellValue(item) * 0.25))}</b> gold <small>(sell to Ubar in town for ${sellValue(item)})</small>`}</div>`;
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
      return `<div class="skill-row focusable ${locked ? 'locked' : ''} ${can ? 'can' : ''}" data-nav="skill:${id}">
        <div class="ic">${skillIcon(id, locked ? '#5b6a94' : d.color)}</div>
        <div><div class="nm">${d.name}</div><div class="cat">${locked ? `Unlocks at level ${d.unlock}` : meta}</div><div class="ds">${d.desc}</div></div>
        <div class="rk"><div class="pips">${Array.from({ length: MAX_RANK }, (_, i) => `<i class="${i < rank ? 'on' : ''}"></i>`).join('')}</div>${can ? '<div class="canup">▲ Rank up</div>' : ''}</div>
      </div>`;
    }).join('');
    const binds = SLOT_BUTTONS.map((b, i) => {
      const id = p.slots[i];
      return `<div class="bind ${this.binding ? 'pick' : ''}" data-do="bind:${i}">${padGlyph(b.pad)}${keyGlyph(b.kbm)}${touchGlyph(i === 0 ? '⚔' : String(i + 1))}<div class="bind-ic">${id ? skillIcon(id, SKILLS[id].color) : ''}</div><span>${id ? SKILLS[id].name : 'Empty'}</span></div>`;
    }).join('');
    const aspects = ASPECTS.map((a) => `<div style="${p.level < a.unlock ? 'opacity:.45' : ''}"><i style="background:${a.css};box-shadow:0 0 8px ${a.css}"></i><span><b>${a.name}</b>${p.level < a.unlock ? ` (level ${a.unlock})` : ''}: ${a.desc}</span></div>`).join('');
    return `<div class="skills">
      <div><h3 class="sec">${p.skillPoints} skill point${p.skillPoints === 1 ? '' : 's'} to spend</h3>${rows}</div>
      <div><div id="skill-act" class="only-touch"></div><h3 class="sec">Action bar</h3><div class="bindings">${binds}</div>
        ${this.binding ? `<div class="bind-wait"><span class="not-touch">Press a skill button for ${SKILLS[this.binding].name}</span><span class="only-touch">Tap a slot above for ${SKILLS[this.binding].name}</span></div>` : ''}
        <h3 class="sec" style="margin-top:16px">Tether Aspects <small><span class="pad">D-pad ◀ ▶</span><span class="kbm">R / F</span></small></h3><div class="aspects">${aspects}</div></div>
    </div>`;
  }

  render_quests() {
    const q = this.g.quests;
    const cur = q.active;
    const list = QUESTS.map((x, i) => `<div class="qrow ${i < q.index ? 'done' : i === q.index ? 'now' : ''}"><i>${i < q.index ? '✓' : i === q.index ? '◆' : '·'}</i> ${x.title}</div>`).join('');
    const body = q.pending ? `<h2>${escapeHtml(q.pending.title)}</h2><p>Ninsun, High Priestess of Eridu Outpost, waits for you by the temple.</p>`
      : cur ? `<h2>${cur.title}</h2><p>${escapeHtml(cur.intro)}</p><p class="obj"><b>${escapeHtml(q.objectiveText())}</b></p><p class="reward">Reward: ${cur.reward.xp} XP, ${cur.reward.gold} gold${cur.reward.item ? `, a ${cur.reward.item.rarity} item` : ''}</p>`
        : `<h2>The First Gate is open</h2><p>Neti has fallen. Six gates remain, and the land is still full of things to kill. Hunt elites, clear the Ganzir Stair again for better loot, and finish the Ritual of the Gallu.</p>`;
    return `<div class="quest-log"><div class="tablet">${body}</div><div><h3 class="sec">Main story</h3><div class="qlist">${list}</div></div></div>`;
  }

  render_settings() {
    const g = this.g;
    const val = (key) => g.settings.get(key);
    const row = (def) => {
      const v = val(def.key);
      let ctl = '';
      if (def.type === 'slider') {
        const pct = ((v - def.min) / (def.max - def.min)) * 100;
        ctl = `<span class="sr-arrow" data-step="${def.key}:-1">◀</span><div class="slider" data-slider="${def.key}"><i style="width:${pct}%"></i><u style="left:${pct}%"></u></div><span class="sr-arrow" data-step="${def.key}:1">▶</span><span class="sv">${def.fmt(v)}</span>`;
      } else if (def.type === 'toggle') {
        ctl = `<span class="switch ${v ? 'on' : ''}"><i></i></span><span class="sv">${v ? 'On' : 'Off'}</span>`;
      } else {
        ctl = `<div class="seg">${def.options.map(([id, label]) => `<span data-seg="${def.key}:${id}" class="${v === id ? 'on' : ''}">${label}</span>`).join('')}</div>`;
      }
      const note = def.key === 'quality' && g.settings.needsReload ? ' <em class="sr-note" style="color:var(--gold-hi);font-size:12px;margin-left:6px">applies after reload</em>' : '';
      return `<div class="set-row focusable t-${def.type}" data-nav="set:${def.key}"><div class="sr-l"><b>${def.label}</b>${note}</div><div class="sr-c">${ctl}</div></div>`;
    };
    const col = (groups) => `<div class="set-col">${groups.filter((gr) => !gr[2] || this.touch).map(([name, rows, cls = '']) => `<h3 class="sec ${cls}">${name}</h3>${rows.map((r) => row(r).replace('class="set-row', `class="${cls} set-row`)).join('')}`).join('')}</div>`;
    const actions = this.only ? '' : `<div class="sys-actions">
      <div class="btn plaque focusable" data-nav="act:resetTut"><span>Reset tutorials</span></div>
      <div class="btn plaque focusable ${this.confirmNew ? 'danger' : ''}" data-nav="act:new"><span>${this.confirmNew ? 'Confirm: erase this hero and start over' : 'Start a new game'}</span></div>
    </div>`;
    const reload = g.settings.needsReload ? `<div class="sys-actions"><div class="btn plaque focusable" data-nav="act:reload"><span>Reload to apply ${g.settings.quality.label} graphics</span></div></div>` : '';
    return `<div class="settings">${SETTINGS.map(col).join('')}</div><div id="set-desc"></div>${reload}${actions}<p class="tt-type fine">Settings and progress save automatically in this browser.</p>`;
  }

  render_system() {
    const P = (...l) => l.map((x) => padGlyph(x)).join('');
    const K = (...l) => l.map((x) => keyGlyph(x)).join('');
    const T = (s) => `<kbd class="pad gp gp-text">${s}</kbd>`;
    const KT = (s) => `<kbd class="kbm key key-wide">${s}</kbd>`;
    return `<div class="controls">
      <div class="only-touch"><h3 class="sec">Touch</h3><table>
        <tr><td>${touchGlyph('Left side')}</td><td>Drag anywhere on the left half to move (the stick appears under your thumb)</td></tr>
        <tr><td>${touchGlyph('Right side')}</td><td>Drag on empty space on the right to steer your sedu spirit's Tether (it sweeps on its own if you don't)</td></tr>
        <tr><td>${touchGlyph('⚔')}</td><td>Strike (hold to keep swinging). It also talks, loots and opens things when no enemies are near</td></tr>
        <tr><td>${touchGlyph('Skills')}</td><td>The arc of buttons above it casts your other skills</td></tr>
        <tr><td>${touchGlyph('Evade')} ${touchGlyph('Potion')}</td><td>Dash out of danger, drink a healing potion</td></tr>
        <tr><td>${touchGlyph('Aspect')}</td><td>Change Tether Aspect</td></tr>
        <tr><td>${touchGlyph('Menu')} ${touchGlyph('Map')}</td><td>Pause menu (inventory, skills, quests, settings) and the map with fast travel</td></tr>
        <tr><td>${touchGlyph('Portal')} ${touchGlyph('Zoom')}</td><td>Town Portal, camera zoom</td></tr>
      </table><p class="tt-type fine">Settings has touch layout size, opacity and a left-handed layout. On iPhone and iPad, Share → Add to Home Screen plays full-screen.</p></div>
      <div class="not-touch"><h3 class="sec">Controller</h3><table>
        <tr><td>${T('Left stick')}</td><td>Move</td></tr><tr><td>${T('Right stick')}</td><td>Steer the Tether (your spirit sweeps on its own if you don't)</td></tr>
        <tr><td>${P('A', 'X', 'Y', 'RB', 'RT', 'LT')}</td><td>Skills (A also talks, loots and opens when no enemies are near)</td></tr>
        <tr><td>${P('B')}</td><td>Evade</td></tr><tr><td>${P('LB')}</td><td>Healing potion</td></tr><tr><td>${T('D-pad ◀ ▶')}</td><td>Change Tether Aspect</td></tr>
        <tr><td>${T('D-pad ▲')}</td><td>Town Portal</td></tr><tr><td>${T('D-pad ▼')}</td><td>Zoom</td></tr><tr><td>${P('Back')}</td><td>Map and fast travel</td></tr><tr><td>${P('Start')}</td><td>Pause menu</td></tr>
      </table></div>
      <div class="not-touch"><h3 class="sec">Keyboard &amp; mouse</h3><table>
        <tr><td>${K('W', 'A', 'S', 'D')}</td><td>Move</td></tr><tr><td>${KT('Mouse')}</td><td>Aim skills and steer the Tether</td></tr>
        <tr><td>${KT('Left')} ${KT('Right')}</td><td>Skill slots 1 and 2 (left / right click)</td></tr><tr><td>${K('1', '2', '3', '4')}</td><td>Skill slots 3 to 6</td></tr>
        <tr><td>${KT('Space')}</td><td>Evade</td></tr><tr><td>${K('Q')}</td><td>Healing potion</td></tr><tr><td>${K('E')}</td><td>Interact / pick up</td></tr>
        <tr><td>${K('R', 'F')}</td><td>Change Tether Aspect</td></tr><tr><td>${K('T')}</td><td>Town Portal</td></tr><tr><td>${K('Z')} ${KT('Wheel')}</td><td>Zoom</td></tr>
        <tr><td>${K('M')} ${KT('Tab')}</td><td>Map</td></tr><tr><td>${K('I', 'K', 'J')}</td><td>Inventory · Skills · Quests</td></tr><tr><td>${KT('Esc')}</td><td>Pause menu</td></tr>
      </table></div>
    </div>
    <p class="tt-type fine"><span class="pad">In menus: D-pad or stick to move, ${padGlyph('A')} choose, ${padGlyph('X')} second action, ${padGlyph('B')} back, ${padGlyph('LB')} ${padGlyph('RB')} switch tabs.</span><span class="kbm">In menus: arrow keys or WASD to move, ${keyGlyph('Enter')} choose, ${keyGlyph('X')} second action, ${keyGlyph('Esc')} back, ${keyGlyph('Q')} ${keyGlyph('E')} switch tabs.</span></p>`;
  }
}

const rc = (r) => `rar-${r}`;

function itemTooltip(item, compact = false) {
  const R = RARITY[item.rarity];
  const mainNum = item.base.min ? `${item.base.min}–${item.base.max}` : item.base.armor ? `${item.base.armor}` : '';
  const mainLbl = item.base.min ? `damage <span class="spd">${item.base.speed.toFixed(2)} attacks/s</span>` : item.base.armor ? 'Armor' : '';
  const inner = `<div class="tt-head"><div class="tt-name rmark r-${item.rarity}">${escapeHtml(item.name)}</div>
      <div class="tt-type">${R.label} ${KIND_LABEL[item.kind]}</div></div>
    <div class="tt-body">
      <div class="tt-ilvl">Item level ${item.ilvl}</div>
      ${mainNum ? `<div class="tt-main"><b>${mainNum}</b> <span>${mainLbl}</span></div>` : ''}
      ${item.affixes.length ? '<div class="tt-sep"></div>' : ''}
      ${affixLines(item).map((l) => `<div class="tt-aff"><i></i>${l}</div>`).join('')}
      ${item.power ? `<div class="tt-sep gold"></div><div class="tt-power"><i>◆</i> ${POWERS[item.power].text}</div>` : ''}
    </div>`;
  return compact ? `<div class="tooltip compact ${rc(item.rarity)}">${inner}</div>` : `<div class="tooltip ${rc(item.rarity)}">${inner}</div>`;
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
    lines.push(`<div class="${d >= 0 ? 'pos' : 'neg'}"><i>${d >= 0 ? '▲' : '▼'}</i> ${d >= 0 ? '+' : '−'}${Math.abs(d).toFixed(1)} average weapon damage</div>`);
  }
  for (const k of keys) {
    const d = (a[k] ?? 0) - (b[k] ?? 0);
    if (Math.abs(d) < 0.05) continue;
    const v = STAT_INFO[k].fmt(Math.abs(d)).replace('+', '');
    lines.push(`<div class="${d > 0 ? 'pos' : 'neg'}"><i>${d > 0 ? '▲' : '▼'}</i> ${d > 0 ? '+' : '−'}${v} ${STAT_INFO[k].label}</div>`);
  }
  if (item.power !== eq.power && (item.power || eq.power)) lines.push(`<div class="${item.power ? 'pos' : 'neg'}"><i>${item.power ? '▲' : '▼'}</i> ${item.power ? 'Gains' : 'Loses'} a legendary power</div>`);
  return `<div class="tt-delta"><div class="tt-eq">Compared to equipped</div>${lines.join('') || '<div class="same">No stat differences</div>'}</div>`;
}

function isUpgrade(p, item) {
  const eq = p.comparisonFor(item);
  return !eq || itemScore(item) > itemScore(eq) * 1.05;
}
