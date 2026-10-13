import { SKILLS, SLOT_BUTTONS, ASPECTS } from '../game/skills.js';
import { xpToNext, MAX_LEVEL } from '../game/stats.js';
import { ELITE_AFFIXES } from '../entities/enemies.js';
import { skillIcon } from './icons.js';
import { drawMap } from './mapdraw.js';

const $ = (id) => document.getElementById(id);

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
    this.slotsEl.innerHTML = SLOT_BUTTONS.map((b, i) => `<div class="slot" data-i="${i}"><div class="icon"></div><div class="cd"></div><div class="cdt"></div><span class="charges"></span><kbd class="pad">${b.pad}</kbd><kbd class="kbm">${b.kbm}</kbd></div>`).join('');
    this.slotEls = [...this.slotsEl.children];
    $('potion').querySelector('.icon').innerHTML = skillIcon('potion', '#ff6a7a');
  }

  show(v) { this.root.hidden = !v; }

  banner(text, kind = '', sub = '') {
    const el = $('banner');
    el.className = kind;
    el.innerHTML = `${escapeHtml(text)}${sub ? `<small>${escapeHtml(sub)}</small>` : ''}`;
    requestAnimationFrame(() => el.classList.add('show'));
    clearTimeout(this._timers.banner);
    this._timers.banner = setTimeout(() => el.classList.remove('show'), 2600);
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
  }

  feed(text, cls = '') {
    const box = $('feed');
    const el = document.createElement('div');
    el.className = cls;
    el.textContent = text;
    box.appendChild(el);
    while (box.children.length > 6) box.firstChild.remove();
    setTimeout(() => el.remove(), 3000);
  }

  setTarget(e) { this.target = e; this.targetTime = 4; }

  setEvent(ev) {
    const el = $('event');
    if (!ev) { el.hidden = true; return; }
    el.hidden = false;
    el.innerHTML = `<b>${escapeHtml(ev.name)}</b><span>${escapeHtml(ev.text)} · ${Math.max(0, Math.ceil(ev.time))}s</span><i style="width:${Math.max(0, ev.time / 50) * 100}%"></i>`;
  }

  update(dt, g) {
    const p = g.player;
    const s = p.stats;
    // Orbs
    this.lifeOrb.querySelector('.fill').style.height = `${(p.life / s.maxLife) * 100}%`;
    this.lifeOrb.querySelector('.barrier').style.opacity = p.barrier > 0 ? 1 : 0;
    this.lifeOrb.querySelector('span').textContent = `${Math.ceil(p.life)}`;
    this.animaOrb.querySelector('.fill').style.height = `${(p.anima / s.maxAnima) * 100}%`;
    this.animaOrb.querySelector('span').textContent = `${Math.floor(p.anima)}`;
    $('potion').querySelector('.count').textContent = `${p.potions}`;
    $('potion').classList.toggle('nores', p.potions === 0);

    // Skill slots (rebuild icons only when bindings change)
    const key = p.slots.join(',') + JSON.stringify(p.skillRanks);
    if (key !== this._slotKey) {
      this._slotKey = key;
      this.slotEls.forEach((el, i) => {
        const id = p.slots[i];
        el.classList.toggle('empty', !id);
        el.querySelector('.icon').innerHTML = id ? skillIcon(id, SKILLS[id].color) : '';
        el.title = id ? SKILLS[id].name : 'Empty slot';
      });
    }
    this.slotEls.forEach((el, i) => {
      const id = p.slots[i];
      if (!id) return;
      const total = g.abilities.cooldownTotal(id, s);
      const left = g.abilities.cooldownLeft(id, s);
      el.querySelector('.cd').style.height = total > 0 && left > 0 ? `${(left / total) * 100}%` : '0';
      el.querySelector('.cdt').textContent = left > 0.05 ? (left >= 1 ? Math.ceil(left) : left.toFixed(1)) : '';
      el.classList.toggle('nores', !!SKILLS[id].cost && p.anima < SKILLS[id].cost);
      el.querySelector('.charges').textContent = id === 'wings' && g.abilities.maxWingCharges(s) > 1 ? g.abilities.charges.wings : '';
    });
    const aspect = ASPECTS[p.aspectIndex];
    const gem = $('aspect').querySelector('.gem');
    gem.style.background = aspect.css;
    gem.style.boxShadow = `0 0 10px ${aspect.css}`;
    $('aspect').title = aspect.name;

    // XP
    const need = xpToNext(p.level);
    $('xp').querySelector('i').style.width = p.level >= MAX_LEVEL ? '100%' : `${(p.xp / need) * 100}%`;
    const pts = p.skillPoints ? ` · <b>${p.skillPoints} skill point${p.skillPoints > 1 ? 's' : ''}: ${g.input.device === 'pad' ? 'Start' : 'K'}</b>` : '';
    $('xp-text').innerHTML = p.level >= MAX_LEVEL ? `Level ${p.level} (max)` : `Level ${p.level} · ${Math.floor(p.xp)} / ${need} XP${pts}`;

    // Buffs
    const buffs = p.buffs.map((b) => `<div>${escapeHtml(b.label.split(':')[0])} · ${Math.ceil(b.time)}s</div>`);
    if (g.abilities.pyreActive) buffs.push(`<div>Gibil's Pyre · ${Math.ceil(g.abilities.pyre)}s</div>`);
    $('buffs').innerHTML = buffs.join('');

    // Region
    const info = g.world.regionInfo(p.pos.x, p.pos.z);
    if (info.id !== this._lastRegion) {
      if (this._lastRegion !== null) this.banner(info.name, 'region', info.safe ? 'Safe zone' : `Monster level ${Math.max(info.level, p.level)}+`);
      this._lastRegion = info.id;
      $('region-name').textContent = info.name;
    }
    $('region-level').textContent = info.safe ? 'Safe zone' : `Level ${Math.max(info.level, p.level)}`;

    // Quest tracker
    const q = g.quests.active;
    const tracker = $('tracker');
    if (!g.quests.accepted && !g.quests.done) tracker.innerHTML = `<div class="q-title">The First Gate</div><div class="q-obj">Speak with Ninsun in Eridu Outpost</div>`;
    else if (q) tracker.innerHTML = `<div class="q-title">${escapeHtml(q.title)}</div><div class="q-obj">${escapeHtml(g.quests.objectiveText())}</div>`;
    else tracker.innerHTML = `<div class="q-title">The First Gate is open</div><div class="q-obj">Six gates remain. Explore, hunt elites and gather loot.</div>`;

    // Interaction prompt
    const prompt = $('prompt');
    if (g.interactTarget && !g.uiOpen && !p.dead) {
      prompt.hidden = false;
      prompt.querySelector('kbd').textContent = g.input.device === 'pad' ? 'A' : 'E';
      prompt.querySelector('span').textContent = g.interactTarget.label;
    } else prompt.hidden = true;

    // Town portal channel
    const ch = $('channel');
    ch.hidden = !g.abilities.channel;
    if (g.abilities.channel) ch.querySelector('i').style.width = `${(g.abilities.channel.t / 1.5) * 100}%`;

    // Target frame / boss bar
    this.targetTime -= dt;
    const t = this.target;
    const boss = g.enemies.list.find((e) => e.boss && e.alive && e.aggro);
    $('bossbar').hidden = !boss;
    if (boss) {
      $('bossbar').querySelector('.b-name').textContent = boss.name;
      $('bossbar').querySelector('i').style.width = `${(boss.hp / boss.maxHp) * 100}%`;
      $('bossbar').querySelector('span').textContent = boss.shielded ? 'Sealed: slay the Gallu!' : `${Math.ceil(boss.hp)} / ${boss.maxHp}`;
    }
    const showT = !boss && t && t.alive && this.targetTime > 0;
    $('target').hidden = !showT;
    if (showT) {
      const el = $('target');
      const nm = el.querySelector('.t-name');
      nm.textContent = `${t.name} · Lv ${t.level}`;
      nm.classList.toggle('elite', !!(t.elite || t.named));
      const affixes = t.named?.affixes ?? t.elite ?? [];
      el.querySelector('.t-affixes').innerHTML = affixes.map((a) => `<span style="color:${ELITE_AFFIXES[a].color}">${ELITE_AFFIXES[a].name}</span>`).join(' · ');
      el.querySelector('i').style.width = `${(t.hp / t.maxHp) * 100}%`;
    }

    // Minimap
    drawMap(this.minimap, g, { cx: p.pos.x, cz: p.pos.z, scale: 2.2, width: 200, height: 200 });
  }
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
