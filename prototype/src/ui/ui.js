import { Menus } from './menus.js';
import { drawMap } from './mapdraw.js';
import { escapeHtml } from './hud.js';
import { QUESTS } from '../game/quests.js';
import { HALF } from '../world/layout.js';

const $ = (id) => document.getElementById(id);

// Owns every overlay (menus, map, dialogue, title and death screens) and
// routes input to whichever one is open. The game pauses while any is open.
export class UI {
  constructor(g) {
    this.g = g;
    this.menus = new Menus(g);
    this.mode = null; // 'menu' | 'map' | 'dialog' | 'title' | 'death'
    this.mapCtx = $('map-canvas').getContext('2d');
    this.mapSel = null;
    this.dialog = null;
    this.titleOptions = [];
    this.titleFocus = 0;

    $('map-canvas').addEventListener('click', (e) => {
      const r = e.target.getBoundingClientRect();
      const scale = e.target.width / (HALF * 2);
      const x = ((e.clientX - r.left) / r.width) * e.target.width / scale - HALF;
      const z = ((e.clientY - r.top) / r.height) * e.target.height / scale - HALF;
      let best = null, bd = 10;
      for (const w of this.g.world.waypoints) {
        const d = Math.hypot(w.x - x, w.z - z);
        if (w.discovered && d < bd) { bd = d; best = w; }
      }
      if (best) { this.mapSel = best; this.travel(); }
    });
    $('dialog').addEventListener('click', (e) => {
      const el = e.target.closest('[data-opt]');
      if (el) { this.dialog.focus = +el.dataset.opt; this.chooseOption(); }
    });
    $('title-options').addEventListener('click', (e) => {
      const el = e.target.closest('[data-opt]');
      if (el) { this.titleFocus = +el.dataset.opt; this.titleOptions[this.titleFocus].run(); }
    });
    $('death').addEventListener('click', () => { if (this.mode === 'death') this.respawn(); });
  }

  get open() { return this.mode !== null; }

  closed() { this.mode = null; this.g.suppressInput = true; }

  update(dt) {
    const g = this.g, input = g.input;
    if (this.mode === null) {
      if (g.player.dead) return;
      if (input.pressed.menu) this.openMenu('inventory');
      else if (input.pressed.skillsMenu) this.openMenu('skills');
      else if (input.pressed.questsMenu) this.openMenu('quests');
      else if (input.pressed.map) this.openMap();
      return;
    }
    if (this.mode === 'menu') { this.menus.update(); if (!this.menus.open) this.mode = null; return; }
    if (this.mode === 'map') return this.updateMap();
    if (this.mode === 'dialog') return this.updateDialog();
    if (this.mode === 'title') return this.updateTitle();
    if (this.mode === 'death' && (input.pressed.confirm || input.pressed.skill1)) this.respawn();
  }

  // ---- menus ------------------------------------------------------------------
  openMenu(tab, opts) { this.mode = 'menu'; this.menus.show(tab, opts); }

  // ---- map + fast travel ----------------------------------------------------------
  openMap() {
    if (this.g.inDungeon) { this.g.hud.notify('The map does not reach into the Ganzir Stair', 'warn'); return; }
    this.mode = 'map';
    $('map').hidden = false;
    const discovered = this.g.world.waypoints.filter((w) => w.discovered);
    this.mapSel = discovered.reduce((best, w) => (!best || dist(w, this.g.player.pos) < dist(best, this.g.player.pos) ? w : best), null);
    this.drawMap();
  }

  updateMap() {
    const input = this.g.input;
    if (input.pressed.back || input.pressed.map) { $('map').hidden = true; this.closed(); return; }
    if ((input.nav.x || input.nav.y) && this.mapSel) {
      // Pick the nearest discovered waypoint in the pushed direction.
      let best = null, bs = Infinity;
      for (const w of this.g.world.waypoints) {
        if (!w.discovered || w === this.mapSel) continue;
        const dx = w.x - this.mapSel.x, dz = w.z - this.mapSel.z;
        const along = dx * input.nav.x + dz * input.nav.y;
        if (along <= 0) continue;
        const score = along + Math.abs(input.nav.x ? dz : dx) * 2;
        if (score < bs) { bs = score; best = w; }
      }
      if (best) this.mapSel = best;
    }
    if (input.pressed.confirm && this.mapSel) { this.travel(); return; }
    this.drawMap();
  }

  drawMap() {
    const c = $('map-canvas');
    drawMap(this.mapCtx, this.g, { cx: 0, cz: 0, scale: c.width / (HALF * 2), width: c.width, height: c.height, full: true, selected: this.mapSel });
    const pad = this.g.input.device === 'pad';
    $('map-help').textContent = pad ? 'D-pad: choose waypoint · A: travel · B: close' : 'Click a waypoint to travel · M / Esc: close';
    $('map-info').textContent = this.mapSel ? `Travel to ${this.mapSel.name}` : 'Discover waypoints by walking near them.';
  }

  travel() {
    const w = this.mapSel;
    $('map').hidden = true;
    this.closed();
    this.g.teleport(w.x, w.z + 3);
    this.g.hud.banner(w.name, 'waypoint');
  }

  // ---- dialogue --------------------------------------------------------------------
  talk(npc) {
    const g = this.g, p = g.player, q = g.quests;
    let text, options;
    if (npc.id === 'ninsun') {
      p.potions = p.maxPotions;
      if (!q.accepted && !q.done) {
        text = QUESTS[0].intro;
        options = [
          { label: `Accept: ${QUESTS[0].title}`, run: () => { q.accept(); g.hud.banner(`Quest: ${QUESTS[0].title}`, 'quest', QUESTS[0].objective.text); g.save(); } },
          { label: 'Not yet', run: () => {} },
        ];
      } else {
        text = q.active ? `${q.active.intro}\n\nYour potions are restored.` : 'Neti has fallen and the First Gate stands open. The other six will not wait forever, Gatewalker. Your potions are restored.';
        const cost = 150 + p.potionLevel * 250;
        options = [];
        if (p.potionLevel < 3) {
          options.push({
            label: `Blessing of Ninsun: +1 potion and +10% healing (${cost} gold)`,
            disabled: p.gold < cost,
            run: () => { p.gold -= cost; p.potionLevel++; p.potions = p.maxPotions; g.hud.notify('Your potions grow stronger', 'good'); g.save(); },
          });
        }
        options.push({ label: 'Farewell', run: () => {} });
      }
    } else if (npc.id === 'ubar') {
      text = 'Bronze from Dilmun, lapis from the far mountains, and whatever the scorpion-men leave behind. I buy what you carry and sell what I find. No refunds, Gatewalker.';
      options = [
        { label: 'Trade (sell items, buy mystery gear)', run: () => this.openMenu('inventory', { merchant: true }), keepOpen: true },
        { label: 'Farewell', run: () => {} },
      ];
    } else {
      text = 'The gate guard leans on his spear. "North road leads to the Sunfields. Past them, nothing good. If you find a blue stone humming in the grass, touch it. The priests say the old waypoints remember you."';
      options = [{ label: 'Farewell', run: () => {} }];
    }
    this.dialog = { npc, options, focus: 0 };
    this.mode = 'dialog';
    const el = $('dialog');
    el.hidden = false;
    el.querySelector('.d-name').textContent = npc.name;
    el.querySelector('.d-text').innerHTML = escapeHtml(text).replace(/\n/g, '<br>');
    this.renderDialog();
  }

  renderDialog() {
    $('dialog').querySelector('.d-options').innerHTML = this.dialog.options.map((o, i) =>
      `<div class="opt ${i === this.dialog.focus ? 'focus' : ''} ${o.disabled ? 'disabled' : ''}" data-opt="${i}">${escapeHtml(o.label)}</div>`).join('');
  }

  updateDialog() {
    const input = this.g.input;
    if (input.pressed.back) { this.closeDialog(); return; }
    if (input.nav.y) {
      const n = this.dialog.options.length;
      this.dialog.focus = (this.dialog.focus + input.nav.y + n) % n;
      this.renderDialog();
    }
    if (input.pressed.confirm) this.chooseOption();
  }

  chooseOption() {
    const o = this.dialog.options[this.dialog.focus];
    if (o.disabled) { this.g.hud.notify('Not enough gold', 'warn'); return; }
    $('dialog').hidden = true;
    this.mode = null;
    o.run();
    if (!o.keepOpen) this.closed();
  }

  closeDialog() { $('dialog').hidden = true; this.closed(); }

  // ---- title + death ---------------------------------------------------------------
  showTitle(hasSave) {
    this.mode = 'title';
    $('title').hidden = false;
    this.titleOptions = [];
    if (hasSave) this.titleOptions.push({ label: 'Continue', run: () => this.startGame(false) });
    this.titleOptions.push({ label: hasSave ? 'New game (erases your hero)' : 'Begin', run: () => this.startGame(true) });
    this.titleFocus = 0;
    this.renderTitle();
  }

  renderTitle() {
    $('title-options').innerHTML = this.titleOptions.map((o, i) => `<div class="btn ${i === this.titleFocus ? 'focus' : ''}" data-opt="${i}">${o.label}</div>`).join('');
  }

  updateTitle() {
    const input = this.g.input;
    if (input.nav.y) { this.titleFocus = (this.titleFocus + input.nav.y + this.titleOptions.length) % this.titleOptions.length; this.renderTitle(); }
    if (input.pressed.confirm) this.titleOptions[this.titleFocus].run();
  }

  startGame(fresh) {
    $('title').hidden = true;
    this.closed();
    this.g.start(fresh);
  }

  showDeath() { this.mode = 'death'; $('death').hidden = false; }

  respawn() {
    $('death').hidden = true;
    this.closed();
    this.g.respawn();
  }
}

const dist = (w, p) => Math.hypot(w.x - p.x, w.z - p.z);
