import { MODES } from './tether.js';

// DOM overlay: health, dodge charges, tether mode wheel, snap cooldown, wave,
// banners, toasts, help/pause panel and the death screen.
export class Hud {
  constructor() {
    this.el = (id) => document.getElementById(id);
    this.hpFill = this.el('hp-fill');
    this.hpText = this.el('hp-text');
    this.dodge = this.el('dodge');
    this.modes = this.el('modes');
    this.snapFill = this.el('snap-fill');
    this.snapLabel = this.el('snap');
    this.waveEl = this.el('wave');
    this.killsEl = this.el('kills');
    this.bannerEl = this.el('banner');
    this.toastEl = this.el('toast');
    this.helpEl = this.el('help');
    this.deathEl = this.el('death');
    this.deviceEl = this.el('device');
    this.sweepEl = this.el('sweep-fill');
    this._timers = {};

    this.modes.innerHTML = MODES.map((m, i) =>
      `<div class="mode" data-i="${i}" style="--c:${m.css}"><span class="gem"></span><span class="name">${m.name}</span></div>`,
    ).join('');
    this.modeEls = [...this.modes.children];
    this._lastDevice = null;
  }

  banner(text) { this.flash(this.bannerEl, text, 2200); }

  toast(title, body, color) {
    this.toastEl.innerHTML = `<b style="color:${color}">${title}</b><span>${body}</span>`;
    this.flash(this.toastEl, null, 2600);
  }

  flash(el, text, ms) {
    if (text !== null) el.textContent = text;
    el.classList.add('show');
    clearTimeout(this._timers[el.id]);
    this._timers[el.id] = setTimeout(() => el.classList.remove('show'), ms);
  }

  setHelp(visible) { this.helpEl.classList.toggle('show', visible); }
  setDeath(visible, wave = 0, kills = 0) {
    this.deathEl.classList.toggle('show', visible);
    if (visible) this.el('death-stats').textContent = `You fell at wave ${wave} after slaying ${kills} servants of Kur.`;
  }

  update(g) {
    const p = g.player;
    const hpPct = (p.hp / p.maxHp) * 100;
    this.hpFill.style.width = `${hpPct}%`;
    this.hpText.textContent = `${Math.ceil(p.hp)} / ${p.maxHp}`;
    this.dodge.innerHTML = Array.from({ length: 2 }, (_, i) => `<i class="${i < p.dodgeCharges ? 'on' : ''}"></i>`).join('');
    this.modeEls.forEach((el, i) => el.classList.toggle('active', i === g.tether.modeIndex));
    this.snapFill.style.height = `${(1 - g.tether.snapCd / 3.5) * 100}%`;
    this.snapLabel.classList.toggle('ready', g.tether.snapCd <= 0);
    this.snapLabel.style.setProperty('--c', g.tether.mode.css);
    this.sweepEl.style.width = `${(g.tether.sweep / 1.5) * 100}%`;
    this.sweepEl.style.background = g.tether.mode.css;
    this.waveEl.textContent = `Wave ${g.enemies.wave}`;
    this.killsEl.textContent = `${g.kills} slain`;
    if (g.input.device !== this._lastDevice) {
      this._lastDevice = g.input.device;
      document.body.dataset.device = g.input.device;
      this.deviceEl.textContent = g.input.device === 'pad' ? '🎮 Controller' : '⌨️ Keyboard & mouse';
    }
  }
}
