import { SKILLS, ASPECTS } from '../game/skills.js';
import { skillIcon } from './icons.js';
import { SKILL_BTNS, clusterLayout } from './touchlayout.js';

// Touch overlay ("Lapis Mosaic" tiles over the scene), shown while body[data-device="touch"] and a
// game is running. It only writes into the shared Input (src/core/input.js): touchMove / touchAim
// stick vectors and touchPress / touchRelease for buttons, so the game reads touch exactly like a pad.
//
//   left 45%   floating move stick (appears under the thumb)
//   rest       empty space is the Tether stick: drag to steer the sedu familiar
//   bottom-right cluster: attack / interact (skill1), arc of skills 2-6, evade, potion, aspect swap
//   top-left   menu, map, town portal, zoom
//
// Positions come from layout() so the touch scale and left-handed settings apply live.

const $ = (id) => document.getElementById(id);
const svg = (body) => `<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

const GLYPH = {
  evade: svg('<path d="M5 9 L12 16 L5 23"/><path d="M14 9 L21 16 L14 23"/><path d="M24 7 V25" stroke-width="2.6"/>'),
  menu: svg('<path d="M6 9 H26 M6 16 H26 M6 23 H26" stroke-width="2.8"/>'),
  map: svg('<path d="M4 8 L11 5 L21 8 L28 5 V24 L21 27 L11 24 L4 27 Z"/><path d="M11 5 V24 M21 8 V27"/>'),
  portal: svg('<ellipse cx="16" cy="16" rx="8" ry="12"/><ellipse cx="16" cy="16" rx="3.5" ry="6.5"/><path d="M4 28 H28" stroke-width="1.6"/>'),
  zoom: svg('<circle cx="14" cy="14" r="8"/><path d="M20 20 L27 27"/><path d="M10.5 14 H17.5 M14 10.5 V17.5"/>'),
  hand: svg('<path d="M10 27 V15 L8 9 Q9 7 11 9 L12 13 V6 Q13 4 15 6 V13 V5 Q16 3 18 5 V13 V7 Q19 5 21 7 V17 L23 14 Q25 14 24 17 L20 27 Z"/>'),
  swap: svg('<path d="M5 12 H25 L20 7 M27 20 H7 L12 25"/>'),
};

// [name, action]. The geometry lives in touchlayout.js: attack in the corner, evade / potion / aspect curled around
// it, then the BOUND skills (s2-s6 mirror slots 2-6) as an outer arc. Unbound slots get no button at all.
const CLUSTER = [
  ['attack', 'skill1'], ['evade', 'evade'], ['potion', 'potion'], ['aspect', 'aspectNext'],
  ['s2', 'skill2'], ['s3', 'skill3'], ['s4', 'skill4'], ['s5', 'skill5'], ['s6', 'skill6'],
];
const TOP_BUTTONS = [['menu', 'menu', 'Menu'], ['map', 'map', 'Map'], ['portal', 'portal', 'Town Portal'], ['zoom', 'zoom', 'Zoom']];

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export class Touch {
  constructor(g, ui) {
    this.g = g;
    this.ui = ui;
    this.input = g.input;
    this.s = g.settings;
    this.btn = {};            // name -> element
    this.pointers = new Map(); // pointerId -> { el, act } for buttons
    this.sticks = { move: null, aim: null }; // { id, ox, oy } while a finger holds the stick
    this.visible = false;
    this.scale = 1;
    this._cache = {};
    this.build();
    this.layout();
    // Re-measure whenever the viewport changes: rotation, the Claude app's viewer header, browser bars sliding away.
    const relayout = () => this.layout();
    addEventListener('resize', relayout);
    addEventListener('orientationchange', relayout);
    window.visualViewport?.addEventListener('resize', relayout);
    this.s.onChange((k) => { if (k.startsWith('touch')) this.layout(); });
  }

  build() {
    const root = document.createElement('div');
    root.id = 'touch';
    root.hidden = true;
    const slot = (name, act, extra = '') => `<div class="t-btn ${extra}" data-act="${act}" data-name="${name}"><div class="icon"></div><div class="cdwrap"><div class="cd"></div></div><div class="cdt"></div><span class="charges"></span><b class="badge"></b></div>`;
    root.innerHTML = `
      <div id="t-pad"></div>
      <div class="t-stick" id="t-move"><i class="t-knob"></i></div>
      <div class="t-stick aim" id="t-aim"><i class="t-knob"></i></div>
      ${CLUSTER.map(([name, act]) => slot(name, act, name === 'attack' ? 't-attack' : name.startsWith('s') ? 't-skill' : `t-${name}`)).join('')}
      ${TOP_BUTTONS.map(([name, act, label]) => `<div class="t-btn t-top t-${name}" data-act="${act}" data-name="${name}" role="button" aria-label="${label}"><div class="icon">${GLYPH[name]}</div><b class="badge"></b></div>`).join('')}`;
    document.body.appendChild(root);
    this.root = root;
    this.pad = $('t-pad');
    this.sticksEl = { move: $('t-move'), aim: $('t-aim') };
    for (const el of root.querySelectorAll('.t-btn')) this.btn[el.dataset.name] = el;
    this.btn.evade.querySelector('.icon').innerHTML = GLYPH.evade;
    this.btn.potion.querySelector('.icon').innerHTML = skillIcon('potion', '#ff9a7a');
    this.btn.aspect.querySelector('.icon').innerHTML = `<i class="gem"></i>${GLYPH.swap}`;

    // Sticks: pointer events work with real touch on iOS Safari (13+) and Android Chrome.
    const pad = this.pad;
    pad.addEventListener('pointerdown', (e) => this.padDown(e));
    pad.addEventListener('pointermove', (e) => this.padMove(e));
    for (const t of ['pointerup', 'pointercancel']) pad.addEventListener(t, (e) => this.padUp(e));
    // Buttons: held while the finger is down, a tap shorter than a frame still registers (Input.tappedTouch).
    for (const el of root.querySelectorAll('.t-btn')) {
      el.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'mouse') return;
        e.preventDefault();
        e.stopPropagation();
        try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
        this.pointers.set(e.pointerId, el);
        el.classList.add('down');
        this.input.touchPress(el.dataset.act);
        this.buzz(8);
      });
      const up = (e) => {
        const b = this.pointers.get(e.pointerId);
        if (!b) return;
        this.pointers.delete(e.pointerId);
        // Still held by another finger? (two fingers on one button)
        if (![...this.pointers.values()].includes(b)) { b.classList.remove('down'); this.input.touchRelease(b.dataset.act); }
      };
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
      el.addEventListener('lostpointercapture', up);
    }
    // No long-press menus, text selection or callouts anywhere on the overlay.
    root.addEventListener('contextmenu', (e) => e.preventDefault());
    // A fresh game or a device switch must never leave a finger "held".
    document.addEventListener('visibilitychange', () => this.releaseAll());
  }

  buzz(ms) { if (this.s.get('rumble') !== false) try { navigator.vibrate?.(ms); } catch { /* ignore */ } }

  // ---- layout ----------------------------------------------------------------------------------
  // Safe-area insets in px (notches), read through a hidden probe because env() is CSS-only.
  safeInsets() {
    let p = this._probe;
    if (!p) {
      p = this._probe = document.createElement('div');
      p.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)';
      document.body.appendChild(p);
    }
    const cs = getComputedStyle(p);
    return { top: parseFloat(cs.paddingTop) || 0, bottom: parseFloat(cs.paddingBottom) || 0 };
  }

  layout() {
    const h = innerHeight, w = innerWidth;
    this.scale = Math.max(0.6, Math.min(1.3, h / 390, w / 740)) * (this.s.get('touchScale') ?? 1);
    this.lefty = !!this.s.get('touchLefty');
    const sc = this.scale;
    const root = this.root;
    root.style.setProperty('--t-op', String(this.s.get('touchOpacity') ?? 0.8));
    root.style.setProperty('--ts', sc.toFixed(3));
    document.body.classList.toggle('t-lefty', this.lefty);
    document.documentElement.style.setProperty('--ts', sc.toFixed(3));
    const side = this.lefty ? 'left' : 'right', other = this.lefty ? 'right' : 'left';
    const inset = (edge) => `env(safe-area-inset-${edge}, 0px)`;
    const place = (el, cx, cy, px) => { // cx, cy: centre in px from the cluster's corner
      el.style.width = el.style.height = `${px.toFixed(1)}px`;
      el.style[other] = 'auto';
      el.style[side] = `calc(${inset(side)} + ${(cx - px / 2).toFixed(1)}px)`;
      el.style.bottom = `calc(${inset('bottom')} + ${(cy - px / 2).toFixed(1)}px)`;
      el.style.top = 'auto';
    };
    // Height budget: the cluster must stay below the top-right block (minimap, with the tracker and ash beside it).
    const safe = this.safeInsets();
    const mm = $('minimap-wrap')?.getBoundingClientRect();
    const topEdge = mm && mm.height > 0 ? mm.bottom : safe.top + 6 + clamp(h * 0.2, 58, 90); // HUD hidden: same maths as the CSS --tm
    const bound = SKILL_BTNS.filter((n, i) => this.g.hud?.slotInfo?.[i + 1]?.id);
    const lay = clusterLayout({ scale: sc, avail: h - topEdge - 6 - safe.bottom, bound, maxWidth: w * 0.28 - 4 });
    this.cluster = lay;
    for (const [name] of CLUSTER) {
      const it = lay.items[name], el = this.btn[name];
      el.classList.toggle('unbound', !it);
      if (it) place(el, it.x, it.y, it.size);
    }
    // top-left buttons stay top-left for either hand; --tlw / --tbh tell the CSS where the message lane and the feed start
    const tpx = Math.max(44, 50 * Math.max(0.85, sc)), tgap = h < 340 ? 6 : 8;
    TOP_BUTTONS.forEach(([name], i) => {
      const el = this.btn[name];
      el.style.width = el.style.height = `${tpx}px`;
      el.style.left = `calc(env(safe-area-inset-left, 0px) + ${10 + i * (tpx + tgap)}px)`;
      el.style.top = `calc(env(safe-area-inset-top, 0px) + 6px)`;
      el.style.right = el.style.bottom = 'auto';
    });
    document.documentElement.style.setProperty('--tlw', `${(10 + TOP_BUTTONS.length * tpx + (TOP_BUTTONS.length - 1) * tgap).toFixed(1)}px`);
    document.documentElement.style.setProperty('--tbh', `${tpx.toFixed(1)}px`);
    const sz = { move: 120 * sc, aim: 132 * sc };
    for (const k of ['move', 'aim']) this.sticksEl[k].style.setProperty('--sz', `${sz[k]}px`);
    this.stickR = { move: 54 * sc, aim: 60 * sc };
  }

  // ---- sticks ----------------------------------------------------------------------------------
  zoneOf(x) {
    const leftZone = this.lefty ? x > innerWidth * 0.55 : x < innerWidth * 0.45;
    return leftZone ? 'move' : 'aim';
  }

  padDown(e) {
    if (e.pointerType === 'mouse') return;
    e.preventDefault();
    // Tapping the pick-up prompt interacts, like the attack button does.
    const pr = $('prompt');
    if (pr && !pr.hidden) {
      const r = pr.getBoundingClientRect();
      if (e.clientX >= r.left - 8 && e.clientX <= r.right + 8 && e.clientY >= r.top - 12 && e.clientY <= r.bottom + 12) {
        this.input.touchPress('interact');
        setTimeout(() => this.input.touchRelease('interact'), 90);
        return;
      }
    }
    // Tapping the tutorial card dismisses it; tapping the quest line opens the Quests tab.
    const hit = (el, pad) => {
      if (!el || el.hidden) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && getComputedStyle(el).visibility !== 'hidden' && e.clientX >= r.left - pad && e.clientX <= r.right + pad && e.clientY >= r.top - pad && e.clientY <= r.bottom + pad;
    };
    if (hit($('tutorial'), 6)) { this.g.tutorial?.dismiss(); return; }
    if (hit($('tr-info').classList.contains('ev') ? $('event') : $('tracker'), 8)) { if (this.ui.mode === null) this.ui.openMenu('quests'); return; }
    const which = this.zoneOf(e.clientX);
    if (this.sticks[which]) return; // that thumb is already on the glass
    try { this.pad.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    const R = this.stickR[which];
    // Keep the whole base on screen so a thumb at the very edge still has room to push.
    const ox = Math.max(R + 6, Math.min(innerWidth - R - 6, e.clientX));
    const oy = Math.max(R + 6, Math.min(innerHeight - R - 6, e.clientY));
    this.sticks[which] = { id: e.pointerId, ox, oy };
    const el = this.sticksEl[which];
    el.style.transform = `translate(${ox}px, ${oy}px)`;
    el.classList.add('on');
    this.drive(which, e.clientX, e.clientY);
  }

  padMove(e) {
    for (const which of ['move', 'aim']) {
      const st = this.sticks[which];
      if (st && st.id === e.pointerId) { e.preventDefault(); this.drive(which, e.clientX, e.clientY); }
    }
  }

  padUp(e) {
    for (const which of ['move', 'aim']) {
      const st = this.sticks[which];
      if (!st || st.id !== e.pointerId) continue;
      this.sticks[which] = null;
      this.sticksEl[which].classList.remove('on');
      if (which === 'move') { this.input.touchMove.x = 0; this.input.touchMove.y = 0; } else this.input.touchAim.held = false;
    }
  }

  // Move the knob and publish the stick vector (-1..1, y down, like a pad stick).
  drive(which, x, y) {
    const st = this.sticks[which];
    const R = this.stickR[which];
    let dx = x - st.ox, dy = y - st.oy;
    const len = Math.hypot(dx, dy);
    if (len > R) {
      if (which === 'move') { // the base follows a thumb that drifts past the rim
        const k = (len - R) / len;
        st.ox += dx * k; st.oy += dy * k;
        this.sticksEl.move.style.transform = `translate(${st.ox}px, ${st.oy}px)`;
      }
      dx *= R / len; dy *= R / len;
    }
    this.sticksEl[which].firstElementChild.style.transform = `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px)`;
    const v = which === 'move' ? this.input.touchMove : this.input.touchAim;
    v.x = dx / R; v.y = dy / R;
    if (which === 'aim') this.input.touchAim.held = true;
  }

  releaseAll() {
    for (const [, el] of this.pointers) el.classList.remove('down');
    this.pointers.clear();
    this.sticks.move = this.sticks.aim = null;
    this.sticksEl.move.classList.remove('on');
    this.sticksEl.aim.classList.remove('on');
    this.input.releaseTouch();
  }

  // ---- per-frame state ---------------------------------------------------------------------------
  update() {
    const g = this.g;
    const on = this.input.device === 'touch' && g.started && !this.ui.open && !g.player.dead;
    if (on !== this.visible) {
      this.visible = on;
      this.root.hidden = !on;
      if (!on) this.releaseAll(); else this.layout(); // the HUD is measurable now
    }
    if (!on) return;
    const p = g.player, hud = g.hud;
    // Only bound skills get a button: pack the arc again whenever a binding changes.
    const boundKey = SKILL_BTNS.map((n, i) => (hud.slotInfo[i + 1]?.id ? 1 : 0)).join('');
    if (boundKey !== this._boundKey) { this._boundKey = boundKey; this.layout(); }
    // cheap DOM writes: only when a value changes
    const cache = this._cache;
    const put = (key, v, apply) => { if (cache[key] !== v) { cache[key] = v; apply(v); } };

    // Attack / interact (slot 1) and the skill arc (slots 2-6).
    const interact = !!g.interactTarget && !g.combatNearby;
    const slotBtn = [this.btn.attack, this.btn.s2, this.btn.s3, this.btn.s4, this.btn.s5, this.btn.s6];
    slotBtn.forEach((el, i) => {
      const info = hud.slotInfo[i] ?? { id: null };
      const k = `s${i}`;
      const id = info.id;
      const showHand = i === 0 && interact;
      put(`${k}-icon`, `${id}|${showHand}`, () => {
        el.querySelector('.icon').innerHTML = showHand ? GLYPH.hand : id ? skillIcon(id, SKILLS[id].color) : '';
      });
      put(`${k}-empty`, !id, (v) => el.classList.toggle('empty', v));
      put(`${k}-int`, showHand, (v) => el.classList.toggle('interact', v));
      put(`${k}-p`, info.p?.toFixed(2) ?? '0', () => {
        const cd = el.querySelector('.cd');
        cd.style.setProperty('--p', (info.p ?? 0).toFixed(3));
        cd.style.opacity = info.p > 0 ? 1 : 0;
        el.classList.toggle('oncd', info.p > 0);
      });
      put(`${k}-t`, info.txt ?? '', (v) => { el.querySelector('.cdt').textContent = v; });
      put(`${k}-nr`, !!info.nores, (v) => el.classList.toggle('nores', v));
      put(`${k}-c`, String(info.charges ?? ''), (v) => { el.querySelector('.charges').textContent = v; });
      put(`${k}-rd`, info.ready ?? 0, () => { el.classList.remove('ready'); void el.offsetWidth; el.classList.add('ready'); });
    });

    // Potion count, evade charges, aspect gem, skill-point badge.
    put('pot', p.potions, (v) => { this.btn.potion.querySelector('.badge').textContent = v; this.btn.potion.classList.toggle('nores', v === 0); });
    put('evd', p.evadeCharges, (v) => { this.btn.evade.querySelector('.badge').textContent = v; this.btn.evade.classList.toggle('nores', v === 0); });
    const aspect = ASPECTS[p.aspectIndex];
    put('asp', aspect.css, (v) => { this.btn.aspect.querySelector('.gem').style.background = v; this.btn.aspect.style.setProperty('--glow', v); });
    put('sp', p.skillPoints, (v) => { const b = this.btn.menu.querySelector('.badge'); b.textContent = v || ''; b.classList.toggle('on', v > 0); });
    put('safe', !!g.inSafeZone, (v) => this.btn.portal.classList.toggle('dim', v));
  }
}
