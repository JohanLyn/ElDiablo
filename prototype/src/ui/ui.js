import { Menus } from './menus.js';
import { drawMap } from './mapdraw.js';
import { escapeHtml } from './hud.js';
import { HALF } from '../world/layout.js';
import { portrait } from './portraits.js';
import { btn, padGlyph, keyGlyph } from './glyphs.js';

const $ = (id) => document.getElementById(id);

// Owns every overlay (menus, map, dialogue, title, pause and death screens) and
// routes input to whichever one is open. The game pauses while any is open.
export class UI {
  constructor(g) {
    this.g = g;
    this.menus = new Menus(g);
    this.mode = null; // 'menu' | 'map' | 'dialog' | 'title' | 'intro' | 'death' | 'pause' | 'credits'
    this.mapCtx = $('map-canvas').getContext('2d');
    this.mapSel = null;
    this.mapParent = null;
    this.menuParent = null;
    this.dialog = null;
    this.titleOptions = [];
    this.titleFocus = 0;
    this.pauseOptions = [];
    this.pauseFocus = 0;
    this.pauseView = 'main';
    this._frameKeys = new Set();
    g.hud.bind?.(g);

    window.addEventListener('keydown', (e) => this._frameKeys.add(e.code));

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
      if (!this.dialog) return;
      if (this.dialog.typing) { this.completeDialogText(); return; }
      if (el) { this.dialog.focus = +el.dataset.opt; this.chooseOption(); }
    });
    $('dialog').addEventListener('mousemove', (e) => {
      const el = e.target.closest('[data-opt]');
      if (el && this.dialog && !this.dialog.typing && this.dialog.focus !== +el.dataset.opt) { this.dialog.focus = +el.dataset.opt; this.renderDialog(); }
    });
    this._wireList('title-options', () => this.titleOptions, (i) => { this.titleFocus = i; this.renderTitle(); }, (i) => this.titleOptions[i].run());
    this._wireList('pause-options', () => this.pauseOptions, (i) => { this.pauseFocus = i; this.renderPause(); }, (i) => this.pauseOptions[i].run());
    $('death').addEventListener('click', () => { if (this.mode === 'death') this.respawn(); });
    $('credits-close').addEventListener('click', () => this.closeCredits());
    $('t-version').textContent = `v${g.version ?? ''}`;
    document.querySelector('.cr-ver').textContent = `The Seven Gates of Kur · v${g.version ?? ''}`;
  }

  _wireList(id, list, onHover, onClick) {
    const box = $(id);
    box.addEventListener('mousemove', (e) => {
      const el = e.target.closest('[data-opt]');
      if (el && !el.classList.contains('focus')) onHover(+el.dataset.opt);
    });
    box.addEventListener('click', (e) => {
      const el = e.target.closest('[data-opt]');
      if (el) onClick(+el.dataset.opt);
    });
  }

  get open() { return this.mode !== null; }

  closed() { this.mode = null; this.menuParent = null; this.mapParent = null; this.g.suppressInput = true; }

  update(dt) {
    const g = this.g, input = g.input;
    const keys = this._frameKeys;
    this._frameKeys = new Set();
    this._keysThisFrame = keys;
    document.body.classList.toggle('ui-open', this.mode !== null && this.mode !== 'title');
    if (this.mode !== null) {
      if (input.nav.x || input.nav.y) g.events.emit('uiMove', {});
      if (input.pressed.confirm) g.events.emit('uiConfirm', {});
      if (input.pressed.back) g.events.emit('uiBack', {});
    }
    if (this.mode === null) {
      if (g.player.dead) return;
      if (input.pressed.menu) {
        // Esc and Start pause; I opens the inventory directly.
        if (input.device === 'pad' || keys.has('Escape')) this.openPause();
        else this.openMenu('inventory');
      } else if (input.pressed.skillsMenu) this.openMenu('skills');
      else if (input.pressed.questsMenu) this.openMenu('quests');
      else if (input.pressed.map) this.openMap();
      return;
    }
    if (this.mode === 'menu') { this.menus.update(); if (this.mode === 'menu' && !this.menus.open) this.closed(); return; }
    if (this.mode === 'map') return this.updateMap();
    if (this.mode === 'dialog') return this.updateDialog(dt);
    if (this.mode === 'title') return this.updateTitle();
    if (this.mode === 'pause') return this.updatePause();
    if (this.mode === 'credits') { if (input.pressed.back || input.pressed.confirm) this.closeCredits(); return; }
    if (this.mode === 'intro') { this.updateIntro(dt); return; }
    if (this.mode === 'death' && (input.pressed.confirm || input.pressed.skill1)) this.respawn();
  }

  // ---- menus ------------------------------------------------------------------
  // opts: { merchant, from: 'pause' | 'title', only: [tab ids] }
  openMenu(tab, opts = {}) {
    this.mode = 'menu';
    this.menuParent = opts.from ?? null;
    if (opts.from === 'pause') $('pause').hidden = true;
    this.menus.show(tab, opts);
    this.g.events.emit('uiOpen', { kind: 'menu' });
  }

  // Close the menu and return to whatever opened it (pause, title or the game).
  closeMenu() {
    this.menus.hide();
    const parent = this.menuParent;
    this.menuParent = null;
    if (parent === 'pause') { this.mode = 'pause'; $('pause').hidden = false; this.g.suppressInput = true; this.renderPause(); }
    else if (parent === 'title') { this.mode = 'title'; this.g.suppressInput = true; }
    else this.closed();
  }

  // ---- pause ---------------------------------------------------------------------
  openPause({ reason = null } = {}) {
    const g = this.g;
    this.mode = 'pause';
    this.pauseView = 'main';
    this.pauseFocus = 0;
    $('pause').hidden = false;
    const msg = { blur: 'The game paused because the window lost focus.', pad: 'Controller disconnected. Reconnect it, or press any key to carry on with keyboard and mouse.' }[reason];
    const r = $('pause-reason');
    r.hidden = !msg;
    r.textContent = msg ?? '';
    const p = g.player;
    const info = g.world.regionInfo(p.pos.x, p.pos.z);
    $('pause-sub').textContent = `Level ${p.level} Gatewalker · ${g.instance?.name ?? info.name}`;
    this.buildPauseOptions();
    this.renderPause();
    g.events.emit('uiOpen', { kind: 'pause' });
  }

  buildPauseOptions() {
    const via = (tab) => () => this.openMenu(tab, { from: 'pause' });
    if (this.pauseView === 'confirm') {
      $('pause-title').textContent = 'Quit to Title?';
      this.pauseOptions = [
        { label: 'Save and quit', danger: true, run: () => this.quitToTitle() },
        { label: 'Cancel', run: () => { this.pauseView = 'main'; this.pauseFocus = 0; $('pause-title').textContent = 'Paused'; this.buildPauseOptions(); this.renderPause(); } },
      ];
      this.pauseFocus = 1;
      return;
    }
    $('pause-title').textContent = 'Paused';
    this.pauseOptions = [
      { label: 'Resume', run: () => this.closePause() },
      { label: 'Inventory', hint: btn('', 'I'), run: via('inventory') },
      { label: 'Skills', hint: btn('', 'K'), run: via('skills') },
      { label: 'Quests', hint: btn('', 'J'), run: via('quests') },
      { label: 'Map', hint: btn('Back', 'M'), run: () => { if (this.g.inDungeon) { this.g.hud.notify(`The map does not reach into the ${this.g.instance.name.replace(/^The /, '')}`, 'warn'); return; } $('pause').hidden = true; this.openMap({ from: 'pause' }); } },
      { label: 'Settings', run: via('settings') },
      { label: 'Controls', run: via('system') },
      { label: 'Quit to Title', run: () => { this.pauseView = 'confirm'; this.buildPauseOptions(); this.renderPause(); } },
    ];
  }

  renderPause() {
    $('pause-options').innerHTML = this.pauseOptions.map((o, i) =>
      `<div class="btn plaque ${i === this.pauseFocus ? 'focus' : ''} ${o.danger ? 'danger' : ''}" data-opt="${i}"><span>${o.label}</span>${o.hint ? `<em class="hk">${o.hint.replace(/<kbd class="pad[^>]*>\s*<\/kbd>/, '')}</em>` : ''}</div>`).join('');
    $('pause-help').innerHTML = `<span class="pad">${padGlyph('A')} select · ${padGlyph('B')} resume</span><span class="kbm">${keyGlyph('Enter')} select · ${keyGlyph('Esc')} resume</span>`;
  }

  updatePause() {
    const input = this.g.input;
    if (input.pressed.back || input.pressed.menu) {
      if (this.pauseView === 'confirm') { this.pauseOptions[1].run(); return; }
      this.closePause();
      return;
    }
    if (input.nav.y) {
      const n = this.pauseOptions.length;
      this.pauseFocus = (this.pauseFocus + input.nav.y + n) % n;
      this.renderPause();
    }
    if (input.pressed.confirm) this.pauseOptions[this.pauseFocus].run();
  }

  closePause() { $('pause').hidden = true; $('pad-lost').hidden = true; this.closed(); }

  quitToTitle() {
    try { this.g.save(); } catch { /* saving must not block quitting */ }
    location.reload();
  }

  // ---- map + fast travel ----------------------------------------------------------
  openMap({ from = null } = {}) {
    if (this.g.inDungeon) { this.g.hud.notify(`The map does not reach into the ${this.g.instance.name.replace(/^The /, '')}`, 'warn'); return; }
    this.mode = 'map';
    this.mapParent = from;
    $('map').hidden = false;
    this.g.events.emit('uiOpen', { kind: 'map' });
    const discovered = this.g.world.waypoints.filter((w) => w.discovered);
    this.mapSel = discovered.reduce((best, w) => (!best || dist(w, this.g.player.pos) < dist(best, this.g.player.pos) ? w : best), null);
    this.drawMap();
  }

  closeMap() {
    $('map').hidden = true;
    const parent = this.mapParent;
    this.mapParent = null;
    if (parent === 'pause') { this.mode = 'pause'; $('pause').hidden = false; this.g.suppressInput = true; this.renderPause(); } else this.closed();
  }

  updateMap() {
    const input = this.g.input;
    if (input.pressed.back || input.pressed.map || input.pressed.menu) { this.closeMap(); return; }
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
    $('map-help').innerHTML = `<span class="pad">${padGlyph('A')} travel · D-pad choose waypoint · ${padGlyph('B')} close</span><span class="kbm">Click a waypoint to travel · ${keyGlyph('M')} ${keyGlyph('Esc')} close</span>`;
    $('map-info').textContent = this.mapSel ? `Travel to ${this.mapSel.name}` : 'Discover waypoints by walking near them.';
  }

  travel() {
    const w = this.mapSel;
    $('map').hidden = true;
    $('pause').hidden = true;
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
      const pend = q.pending;
      if (pend && pend.giver === 'ninsun') {
        text = pend.intro;
        options = [
          { label: `Accept: ${pend.title}`, run: () => { q.accept(); g.save(); } },
          { label: 'Not yet', run: () => {} },
        ];
      } else {
        text = q.active?.id === 'q0' ? 'A stranger with a bound spirit? The gods are not finished with us, then. The caravan on the north road is still under attack. Help them, Gatewalker, then come back to me.'
          : q.active ? `${q.active.intro}\n\nYour potions are restored.` : 'Neti has fallen and the First Gate stands open. The other six will not wait forever, Gatewalker. Your potions are restored.';
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
    this.dialog = { npc, options, focus: 0, text, shown: 0, typing: true };
    g.events.emit('uiOpen', { kind: 'dialog', npc: npc.id });
    this.mode = 'dialog';
    const el = $('dialog');
    el.hidden = false;
    el.classList.remove('done');
    el.classList.add('typing');
    el.querySelector('.d-name').textContent = npc.name;
    const pf = el.querySelector('.d-portrait');
    pf.replaceChildren(portrait(npc.id));
    this.paintDialogText(0);
    el.querySelector('.d-more').innerHTML = `${btn('A', 'Enter')} <span>skip</span>`;
    this.renderDialog();
  }

  renderDialog() {
    const d = this.dialog;
    $('dialog').querySelector('.d-options').innerHTML = d.options.map((o, i) =>
      `<div class="opt ${i === d.focus ? 'focus' : ''} ${o.disabled ? 'disabled' : ''}" data-opt="${i}"><span class="o-n">${i + 1}</span><span class="o-t">${escapeHtml(o.label)}</span>${i === d.focus && !d.typing ? `<span class="o-k">${btn('A', 'Enter')}</span>` : ''}</div>`).join('');
  }

  // The unrevealed rest stays in the layout (hidden), so the box never changes size while typing.
  paintDialogText(n) {
    const t = this.dialog.text;
    $('dialog').querySelector('.d-text').innerHTML = `${escapeHtml(t.slice(0, n))}<span class="rest">${escapeHtml(t.slice(n))}</span>`;
  }

  completeDialogText() {
    const d = this.dialog;
    if (!d || !d.typing) return;
    d.typing = false;
    d.shown = d.text.length;
    const el = $('dialog');
    this.paintDialogText(d.text.length);
    el.classList.remove('typing');
    el.classList.add('done');
    this.renderDialog();
  }

  updateDialog(dt = 0) {
    const input = this.g.input;
    const d = this.dialog;
    if (!d) return;
    if (input.pressed.back) { this.closeDialog(); return; }
    if (d.typing) {
      d.shown += dt * 62;
      const n = Math.min(d.text.length, Math.floor(d.shown));
      if (n !== d.lastN) { d.lastN = n; this.paintDialogText(n); }
      if (n >= d.text.length) this.completeDialogText();
      else if (input.pressed.confirm) this.completeDialogText();
      return;
    }
    if (input.nav.y) {
      const n = d.options.length;
      d.focus = (d.focus + input.nav.y + n) % n;
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
    this.titleOptions.push({ label: hasSave ? 'New Game' : 'Begin', sub: hasSave ? 'erases your hero' : '', run: () => this.startGame(true) });
    this.titleOptions.push({ label: 'Settings', run: () => this.openMenu('settings', { from: 'title', only: ['settings'] }) });
    this.titleOptions.push({ label: 'Controls', run: () => this.openMenu('system', { from: 'title', only: ['system'] }) });
    this.titleOptions.push({ label: 'Credits', run: () => this.openCredits() });
    this.titleFocus = 0;
    this.renderTitle();
    this.spawnEmbers();
  }

  spawnEmbers() {
    const box = $('title-embers');
    if (box.childElementCount) return;
    let html = '';
    for (let i = 0; i < 26; i++) {
      const left = Math.random() * 100, size = 2 + Math.random() * 3.5, dur = 9 + Math.random() * 12, delay = -Math.random() * 20, drift = (Math.random() - 0.5) * 120;
      html += `<i style="left:${left.toFixed(1)}%;width:${size.toFixed(1)}px;height:${size.toFixed(1)}px;animation-duration:${dur.toFixed(1)}s;animation-delay:${delay.toFixed(1)}s;--dx:${drift.toFixed(0)}px"></i>`;
    }
    box.innerHTML = html;
  }

  renderTitle() {
    $('title-options').innerHTML = this.titleOptions.map((o, i) =>
      `<div class="btn plaque ${i === this.titleFocus ? 'focus' : ''}" data-opt="${i}"><span>${o.label}</span>${o.sub ? `<small>${o.sub}</small>` : ''}</div>`).join('');
  }

  updateTitle() {
    const input = this.g.input;
    if (input.nav.y) { this.titleFocus = (this.titleFocus + input.nav.y + this.titleOptions.length) % this.titleOptions.length; this.renderTitle(); }
    if (input.pressed.confirm) this.titleOptions[this.titleFocus].run();
  }

  openCredits() {
    this.mode = 'credits';
    $('credits').hidden = false;
    this.g.suppressInput = true;
  }

  closeCredits() {
    $('credits').hidden = true;
    this.mode = 'title';
    this.g.suppressInput = true;
  }

  startGame(fresh) {
    $('title').hidden = true;
    $('credits').hidden = true;
    this.closed();
    this.g.start(fresh);
  }

  // Cold open: story cards over the flyover, then hand control to the hero.
  playIntro(onDone) {
    const lines = [
      ['In the days when the gods still walked the land between the rivers…', ''],
      ['the First of the Seven Gates of Kur cracked open.', ''],
      ['Its servants pour across the plains of Eridu, and the caravans burn.', ''],
      ['The Seven Gates of Kur', 'title'],
    ];
    const box = $('intro').querySelector('.intro-lines');
    box.innerHTML = lines.map(([t, c]) => `<p class="${c}">${t}</p>`).join('');
    const intro = $('intro');
    intro.hidden = false;
    intro.classList.remove('run');
    void intro.offsetWidth;
    intro.classList.add('run');
    this.mode = 'intro';
    this.intro = { t: 0, onDone, els: [...box.children] };
  }

  updateIntro(dt) {
    const I = this.intro;
    I.t += dt;
    I.els.forEach((el, i) => {
      const on = I.t > 0.9 + i * 2.7;
      const off = i < I.els.length - 1 && I.t > 0.9 + i * 2.7 + 2.5;
      el.classList.toggle('on', on && !off);
      el.classList.toggle('past', off);
    });
    const input = this.g.input;
    if (I.t > 13 || input.pressed.confirm || input.pressed.back || input.pressed.skill1) this.finishIntro();
  }

  finishIntro() {
    if (this.mode !== 'intro') return;
    $('intro').hidden = true;
    this.closed();
    const done = this.intro.onDone;
    this.intro = null;
    done?.();
  }

  showDeath() { this.mode = 'death'; $('death').hidden = false; }

  respawn() {
    $('death').hidden = true;
    this.closed();
    this.g.respawn();
  }
}

const dist = (w, p) => Math.hypot(w.x - p.x, w.z - p.z);
