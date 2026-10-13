import * as THREE from 'three';
import { ParticleSystem } from '../fx/particles.js';
import { F } from '../fx/atlas.js';

const _c = new THREE.Color();

// Juice: soft GPU particles, floating damage numbers, screen shake, hit-stop and rumble.
// The particle system (src/fx/particles.js) is shared with the VFX layer via `fx.ps`.
export class Fx {
  constructor(scene, camera, input, overlay) {
    this.camera = camera;
    this.input = input;
    this.overlay = overlay;
    this.trauma = 0;
    this.hitstop = 0;
    this.ps = new ParticleSystem(scene);
    this.numbers = [];
    this._v = new THREE.Vector3();
  }

  // Generic burst used all over the game: hot-centred glowing sparks and motes.
  burst(pos, color, count = 12, speed = 5, { up = 2, life = 0.5, gravity = 9, spread = 1 } = {}) {
    const ps = this.ps;
    const n = ps.n(count);
    if (!n) return;
    _c.set(color);
    const L = ps.add;
    const hr = _c.r + (1 - _c.r) * 0.45, hg = _c.g + (1 - _c.g) * 0.45, hb = _c.b + (1 - _c.b) * 0.45;
    for (let k = 0; k < n; k++) {
      const t = L.begin(Math.random() < 0.45 ? F.STREAK : Math.random() < 0.5 ? F.DOT : F.SHARD);
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.4 + Math.random() * 0.6);
      t.x = pos.x + (Math.random() - 0.5) * 0.3 * spread;
      t.y = pos.y + (Math.random() - 0.5) * 0.3 * spread;
      t.z = pos.z + (Math.random() - 0.5) * 0.3 * spread;
      t.vx = Math.cos(a) * s; t.vz = Math.sin(a) * s;
      t.vy = up * (0.5 + Math.random());
      t.life = life * (0.6 + Math.random() * 0.6);
      const sz = 0.18 + Math.random() * 0.26;
      t.s0 = sz; t.s1 = sz * 0.25;
      t.r0 = hr; t.g0 = hg; t.b0 = hb; t.r1 = _c.r; t.g1 = _c.g; t.b1 = _c.b;
      t.a = 1; t.grav = gravity; t.drag = 0.6;
      if (t.frame === F.STREAK) { t.stretch = 0.14; t.s0 = sz * 1.3; }
      else if (t.frame === F.SHARD) { t.rot = Math.random() * 6.28; t.rotVel = (Math.random() - 0.5) * 12; }
      L.emit();
    }
  }

  number(pos, value, { color = '#fff', big = false } = {}) {
    if (this.settings?.get('damageNumbers') === false) return;
    const el = document.createElement('div');
    el.className = 'dmg' + (big ? ' big' : '');
    el.textContent = Math.round(value);
    el.style.color = color;
    this.overlay.appendChild(el);
    if (this.numbers.length > 40) this.numbers.shift().el.remove();
    this.numbers.push({ el, pos: pos.clone().add(new THREE.Vector3(0, 1.8, 0)), t: 0, drift: (Math.random() - 0.5) * 0.8 });
  }

  shake(amount) { if (this.settings?.get('screenShake') === false) return; this.trauma = Math.min(1, this.trauma + amount); }
  stop(seconds) { this.hitstop = Math.max(this.hitstop, seconds); }
  rumble(strong, weak, ms) { this.input.rumble(strong, weak, ms); }

  // Called with real (unscaled) dt so effects keep animating during hit-stop.
  update(dt) {
    this.ps.q = this.settings?.quality.particles ?? 1;
    this.ps.update(dt);

    const w = this.overlay.clientWidth, h = this.overlay.clientHeight;
    for (let i = this.numbers.length - 1; i >= 0; i--) {
      const n = this.numbers[i];
      n.t += dt;
      if (n.t > 0.8) { n.el.remove(); this.numbers.splice(i, 1); continue; }
      this._v.copy(n.pos);
      this._v.y += n.t * 1.6;
      this._v.x += n.drift * n.t;
      this._v.project(this.camera);
      n.el.style.transform = `translate(${(this._v.x * 0.5 + 0.5) * w}px, ${(-this._v.y * 0.5 + 0.5) * h}px) translate(-50%, -50%) scale(${n.t < 0.1 ? 1.4 : 1})`;
      n.el.style.opacity = String(Math.min(1, (0.8 - n.t) * 4));
    }

    this.trauma = Math.max(0, this.trauma - dt * 1.8);
    this.hitstop = Math.max(0, this.hitstop - dt);
  }

  // Random camera offset from trauma (squared so small hits stay subtle).
  shakeOffset(out) {
    const s = this.trauma * this.trauma * 0.6;
    return out.set((Math.random() - 0.5) * s, (Math.random() - 0.5) * s, (Math.random() - 0.5) * s);
  }
}
