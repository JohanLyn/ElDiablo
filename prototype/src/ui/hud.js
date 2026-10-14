import { SKILLS, SLOT_BUTTONS, ASPECTS } from '../game/skills.js';
import { xpToNext, MAX_LEVEL } from '../game/stats.js';
import { ELITE_AFFIXES } from '../entities/enemies.js';
import { skillIcon, itemIcon } from './icons.js';
import { drawMap } from './mapdraw.js';
import { padGlyph, keyGlyph, styleKbd, watchKbd } from './glyphs.js';

const $ = (id) => document.getElementById(id);
const clamp01 = (v) => Math.max(0, Math.min(1, v));

const COIN = '<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="16" cy="16" r="10"/><path d="M16 9 V23 M11 13 H21 M11 19 H21" stroke-width="2"/></svg>';

// A lagging "ghost" value: drops slowly after damage, snaps up on healing.
class Ghost {
  constructor() { this.value = 1; this.prev = 1; this.delay = 0; }
  step(v, dt) {
    if (v > this.value) { this.value = v; this.delay = 0; }
    else {
      if (v < this.prev - 0.002) this.delay = 0.5;
      if (this.delay > 0) this.delay -= dt;
      else this.value = Math.max(v, this.value - dt * 0.25);
    }
    this.prev = v;
    return this.value;
  }
}

// In-game HUD: orbs, skill bar, minimap, quest tracker, target frame and messages.
export class Hud {
  constructor() {
    this.root = $('hud');
    this.lifeOrb = $('life-orb');
    this.animaOrb = $('anima-orb');
    this.slotsEl = $('skill-slots');
    this.minimap = $('minimap').getContext('2d');
    this.target = null;
    this.targetTime = 0;
    this._timers = {};
    this._slotKey = '';
    this._lastRegion = null;
    this._cache = new WeakMap();
    this._ghosts = { life: new Ghost(), anima: new Ghost(), target: new Ghost(), boss: new Ghost() };
    this._prevLeft = [];
    this._lastItem = null;
    this._trackerKey = null;
    this.slotsEl.innerHTML = SLOT_BUTTONS.map((b, i) => `<div class="slot" data-i="${i}"><div class="icon"></div><div class="cdwrap"><div class="cd"></div></div><div class="cdt"></div><span class="charges"></span>${padGlyph(b.pad)}${keyGlyph(b.kbm)}</div>`).join('');
    this.slotEls = [...this.slotsEl.children];
    this.slotRefs = this.slotEls.map((el) => ({ el, icon: el.querySelector('.icon'), cd: el.querySelector('.cd'), cdt: el.querySelector('.cdt'), charges: el.querySelector('.charges') }));
    $('potion').querySelector('.icon').innerHTML = skillIcon('potion', '#ff8a6a');
    watchKbd($('tutorial'));
    this.refs = {
      lifeFill: this.lifeOrb.querySelector('.fill'), lifeText: this.lifeOrb.querySelector('span'),
      animaText: this.animaOrb.querySelector('span'),
      xpFill: $('xp').querySelector('i'), xpText: $('xp-text'), xpLvl: $('xp-lvl'),
      potionCount: $('potion').querySelector('.count'),
      gem: $('aspect').querySelector('.gem'),
    };
  }

  // Wire to the event bus (called once the game context exists).
  bind(g) {
    g.events.on('pickup', (e) => { if (e.kind === 'item') this._lastItem = e.item; });
    g.events.on('levelUp', () => {
      const bar = $('bar');
      bar.classList.remove('lvlup'); void bar.offsetWidth; bar.classList.add('lvlup');
    });
  }

  show(v) { this.root.hidden = !v; }

  // Only touch the DOM when a value actually changes.
  _set(el, key, value, apply) {
    let m = this._cache.get(el);
    if (!m) { m = {}; this._cache.set(el, m); }
    if (m[key] === value) return;
    m[key] = value;
    apply(value);
  }

  banner(text, kind = '', sub = '') {
    const el = $('banner');
    el.className = kind;
    el.innerHTML = `<div class="bn-ring"></div><div class="bn-row"><span class="bn-line l"></span><i class="bn-gem"></i><div class="bn-main"><div class="bn-title">${escapeHtml(text)}</div>${sub ? `<div class="bn-sub">${escapeHtml(sub)}</div>` : ''}</div><i class="bn-gem"></i><span class="bn-line r"></span></div>`;
    void el.offsetWidth; // restart the CSS animation
    el.classList.add('show');
  }

  toast(title, desc) { this.banner(title, '', desc); }

  notify(msg, kind = '') {
    const box = $('notify');
    const el = document.createElement('div');
    el.className = kind;
    el.textContent = msg;
    box.appendChild(el);
    while (box.children.length > 4) box.firstChild.remove();
    setTimeout(() => el.remove(), 2600);
    if (kind === 'legendary' && msg.startsWith('Legendary: ')) this.banner(msg.slice(11), 'legendary', 'Legendary item');
  }

  feed(text, cls = '') {
    const box = $('feed');
    const el = document.createElement('div');
    el.className = cls;
    let icon = '';
    if (cls.startsWith('r-') && this._lastItem?.name === text) icon = `<span class="fi r-${this._lastItem.rarity}">${itemIcon(this._lastItem.kind, 'currentColor')}</span>`;
    else if (cls === 'gold') icon = `<span class="fi">${COIN}</span>`;
    else if (cls === 'ash') icon = '<span class="fi ash-fi">\u25C8</span>';
    else if (cls === 'potion') icon = `<span class="fi">${skillIcon('potion', 'currentColor')}</span>`;
    el.innerHTML = `${icon}<span class="ft${cls.startsWith('r-') ? ' rmark ' + cls : ''}">${escapeHtml(text)}</span>`;
    box.appendChild(el);
    while (box.children.length > 6) box.firstChild.remove();
    setTimeout(() => el.remove(), 3200);
  }

  // Ghost-ash counter flashes when ash is gained (Night of the Gidim).
  pulseAsh() { const el = $('ash'); el.classList.remove('gain'); void el.offsetWidth; el.classList.add('gain'); }

  setTarget(e) { this.target = e; this.targetTime = 4; }

  setEvent(ev) {
    const el = $('event');
    if (!ev) { el.hidden = true; return; }
    el.hidden = false;
    el.innerHTML = `<b>${escapeHtml(ev.name)}</b><span>${escapeHtml(ev.text)} · ${Math.max(0, Math.ceil(ev.time))}s</span><div class="ev-bar"><i style="width:${Math.max(0, ev.time / 50) * 100}%"></i></div>`;
  }

  update(dt, g) {
    const p = g.player;
    const s = p.stats;
    const R = this.refs;

    // Orbs: liquid level, ghost drain, barrier shell, low-life pulse.
    const lifeF = clamp01(p.life / s.maxLife);
    this.lifeOrb.style.setProperty('--f', lifeF.toFixed(3));
    this.lifeOrb.style.setProperty('--g', this._ghosts.life.step(lifeF, dt).toFixed(3));
    this.lifeOrb.classList.toggle('low', lifeF < 0.3 && !p.dead);
    this.lifeOrb.classList.toggle('shielded', p.barrier > 0);
    this.lifeOrb.style.setProperty('--b', clamp01(p.barrier / (s.maxLife * 0.35)).toFixed(2));
    this._set(R.lifeText, 'v', Math.ceil(p.life), (v) => { R.lifeText.textContent = v; });
    const animaF = clamp01(p.anima / s.maxAnima);
    this.animaOrb.style.setProperty('--f', animaF.toFixed(3));
    this.animaOrb.style.setProperty('--g', this._ghosts.anima.step(animaF, dt).toFixed(3));
    this._set(R.animaText, 'v', Math.floor(p.anima), (v) => { R.animaText.textContent = v; });
    this._set(R.potionCount, 'v', p.potions, (v) => { R.potionCount.textContent = v; });
    $('potion').classList.toggle('nores', p.potions === 0);

    // Skill slots (rebuild icons only when bindings change)
    const key = p.slots.join(',') + JSON.stringify(p.skillRanks);
    if (key !== this._slotKey) {
      this._slotKey = key;
      this.slotRefs.forEach(({ el, icon }, i) => {
        const id = p.slots[i];
        el.classList.toggle('empty', !id);
        icon.innerHTML = id ? skillIcon(id, SKILLS[id].color) : '';
        el.title = id ? SKILLS[id].name : 'Empty slot';
      });
    }
    this.slotRefs.forEach(({ el, cd, cdt, charges }, i) => {
      const id = p.slots[i];
      if (!id) return;
      const total = g.abilities.cooldownTotal(id, s);
      const left = g.abilities.cooldownLeft(id, s);
      const onCd = total > 0 && left > 0.02;
      cd.style.setProperty('--p', onCd ? (left / total).toFixed(3) : '0');
      cd.style.opacity = onCd ? 1 : 0;
      el.classList.toggle('oncd', onCd);
      const txt = left > 0.05 ? (left >= 1 ? Math.ceil(left) : left.toFixed(1)) : '';
      if (cdt.textContent !== String(txt)) cdt.textContent = txt;
      if (this._prevLeft[i] > 0.05 && left <= 0.05) {
        el.classList.remove('ready'); void el.offsetWidth; el.classList.add('ready');
      }
      this._prevLeft[i] = left;
      el.classList.toggle('nores', !!SKILLS[id].cost && p.anima < SKILLS[id].cost);
      const c = id === 'wings' && g.abilities.maxWingCharges(s) > 1 ? g.abilities.charges.wings : '';
      if (charges.textContent !== String(c)) charges.textContent = c;
    });
    const aspect = ASPECTS[p.aspectIndex];
    R.gem.style.background = aspect.css;
    R.gem.style.boxShadow = `0 0 12px ${aspect.css}`;
    $('aspect').title = aspect.name;

    // XP
    const need = xpToNext(p.level);
    R.xpFill.style.width = p.level >= MAX_LEVEL ? '100%' : `${clamp01(p.xp / need) * 100}%`;
    this._set(R.xpLvl, 'v', p.level, (v) => { R.xpLvl.textContent = v; });
    const pts = p.skillPoints ? ` · <b>${p.skillPoints} skill point${p.skillPoints > 1 ? 's' : ''}: ${padGlyph('Start')}${keyGlyph('K')}</b>` : '';
    const xpHtml = p.level >= MAX_LEVEL ? `Level ${p.level} (max)` : `${Math.floor(p.xp)} / ${need} XP${pts}`;
    this._set(R.xpText, 'h', xpHtml, (v) => { R.xpText.innerHTML = v; });

    // Buffs
    const buffs = p.buffs.map((b) => `<div>${escapeHtml(b.label.split(':')[0])} · ${Math.ceil(b.time)}s</div>`);
    if (g.abilities.pyreActive) buffs.push(`<div>Gibil's Pyre · ${Math.ceil(g.abilities.pyre)}s</div>`);
    const blessing = g.gidim?.blessingLabel();
    if (blessing) buffs.push(`<div class="bless">${escapeHtml(blessing)}</div>`);
    const buffHtml = buffs.join('');
    this._set($('buffs'), 'h', buffHtml, (v) => { $('buffs').innerHTML = v; });

    // Ghost-ash ◈ (Night of the Gidim): shown once the first night has fallen or any ash is held
    const ash = p.ghostAsh ?? 0;
    const ashEl = $('ash');
    ashEl.hidden = !(g.settings.get('gidim') !== false && (ash > 0 || g.flags.gidimSeen));
    this._set(ashEl, 'n', ash, (v) => { ashEl.querySelector('b').textContent = v; });

    // Region
    const info = g.world.regionInfo(p.pos.x, p.pos.z);
    if (info.id !== this._lastRegion) {
      if (this._lastRegion !== null) this.banner(info.name, 'region', info.safe ? 'Safe zone' : `Monster level ${Math.max(info.level, p.level)}+`);
      this._lastRegion = info.id;
      g.events.emit('regionEnter', { id: info.id });
      $('region-name').textContent = info.name;
    }
    const lvlText = info.safe ? 'Safe zone' : `Level ${Math.max(info.level, p.level)}`;
    this._set($('region-level'), 'v', lvlText, (v) => { $('region-level').textContent = v; });
    $('region').classList.toggle('safe', !!info.safe);

    // Quest tracker
    const q = g.quests.active;
    const pend = g.quests.pending;
    let title, obj;
    if (pend) { title = pend.title; obj = 'Speak with Ninsun in Eridu Outpost'; }
    else if (q) { title = q.title; obj = g.quests.objectiveText(); }
    else { title = 'The First Gate is open'; obj = 'Six gates remain. Explore, hunt elites and gather loot.'; }
    const tkey = `${title}|${obj}`;
    if (tkey !== this._trackerKey) {
      const first = this._trackerKey === null;
      const sameQuest = this._trackerKey?.split('|')[0] === title;
      this._trackerKey = tkey;
      const m = /\((\d+)\/(\d+)\)\s*$/.exec(obj ?? '');
      const bar = m ? `<div class="q-prog"><i style="width:${clamp01(+m[1] / +m[2]) * 100}%"></i></div>` : '';
      const tr = $('tracker');
      tr.innerHTML = `<div class="q-head"><span class="q-kicker">${pend ? 'New quest' : q ? 'Quest' : 'Journey'}</span><div class="q-title">${escapeHtml(title)}</div></div><div class="q-obj"><span class="q-text">${escapeHtml(obj ?? '')}</span></div>${bar}`;
      if (!first) { tr.classList.remove('updated', 'fresh'); void tr.offsetWidth; tr.classList.add(sameQuest ? 'updated' : 'fresh'); }
    }

    // Interaction prompt
    const prompt = $('prompt');
    if (g.interactTarget && !g.uiOpen && !p.dead) {
      prompt.hidden = false;
      const kbd = prompt.querySelector('kbd');
      const k = g.input.device === 'pad' ? 'A' : 'E';
      if (kbd.textContent !== k) { kbd.textContent = k; styleKbd(kbd); }
      const label = g.interactTarget.label;
      const sp = prompt.querySelector('span');
      if (sp.textContent !== label) sp.textContent = label;
    } else prompt.hidden = true;

    // Town portal channel
    const ch = $('channel');
    ch.hidden = !g.abilities.channel;
    if (g.abilities.channel) ch.querySelector('i').style.width = `${(g.abilities.channel.t / 1.5) * 100}%`;

    // Target frame / boss bar
    this.targetTime -= dt;
    const t = this.target;
    const boss = g.enemies.list.find((e) => e.boss && e.alive && e.aggro);
    const bb = $('bossbar');
    bb.hidden = !boss;
    if (boss) {
      const [main, ...rest] = boss.name.split(',');
      this._set(bb, 'n', boss.name, () => { bb.querySelector('.b-name').textContent = main; bb.querySelector('.b-sub').textContent = rest.join(',').trim(); });
      const f = clamp01(boss.hp / boss.maxHp);
      const bar = bb.querySelector('.b-bar');
      bar.querySelector('i').style.width = `${f * 100}%`;
      bar.querySelector('.ghost').style.width = `${this._ghosts.boss.step(f, dt) * 100}%`;
      bar.querySelector('.m60').classList.toggle('passed', f < 0.6);
      bar.querySelector('.m30').classList.toggle('passed', f < 0.3);
      bb.classList.toggle('shielded', !!boss.shielded);
      bb.classList.toggle('enraged', f < 0.3);
      const txt = boss.shielded ? 'Sealed: slay the Gallu!' : `${Math.ceil(boss.hp)} / ${boss.maxHp}`;
      this._set(bar, 't', txt, (v) => { bar.querySelector('span').textContent = v; });
    } else this._ghosts.boss.value = 1;
    const showT = !boss && t && t.alive && this.targetTime > 0;
    $('target').hidden = !showT;
    if (showT) {
      const el = $('target');
      const nm = el.querySelector('.t-name');
      this._set(nm, 'n', `${t.name}|${t.level}|${!!(t.elite || t.named)}`, () => {
        nm.textContent = `${t.name} · Lv ${t.level}`;
        nm.classList.toggle('elite', !!(t.elite || t.named));
        el.classList.toggle('elite', !!(t.elite || t.named));
        const affixes = t.named?.affixes ?? t.elite ?? [];
        el.querySelector('.t-affixes').innerHTML = affixes.map((a) => `<span style="color:${ELITE_AFFIXES[a].color}">${ELITE_AFFIXES[a].name}</span>`).join(' · ');
      });
      const f = clamp01(t.hp / t.maxHp);
      el.querySelector('i').style.width = `${f * 100}%`;
      el.querySelector('b').style.width = `${this._ghosts.target.step(f, dt) * 100}%`;
    } else this._ghosts.target.value = 1;

    // Minimap
    drawMap(this.minimap, g, { cx: p.pos.x, cz: p.pos.z, scale: 2.2, width: 200, height: 200 });
  }
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
