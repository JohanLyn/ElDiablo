import * as THREE from 'three';
import { ParticleSystem } from '../fx/particles.js';
import { F } from '../fx/atlas.js';
import { SlowMo } from './slowmo.js';

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
    // Slow-motion: a game-time scale (main.js multiplies simulate's dt by it). It is driven by the
    // real dt passed to update(), so it always expires, even if a harness steps simulate by hand.
    this.slowState = new SlowMo();
    this.timeScale = 1;
    // Directional camera kick (springs back) and a brief field-of-view punch.
    this.kx = 0; this.kz = 0; this.kvx = 0; this.kvz = 0;
    this.punchV = 0; this.punch = 0; this.baseFov = camera.fov;
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

  // Push the camera along (dx, dz) (a world direction); it springs back. Respects the screen-shake setting.
  kick(dx, dz, amount) {
    if (this.settings?.get('screenShake') === false) return;
    const l = Math.hypot(dx, dz) || 1;
    this.kvx += (dx / l) * amount; this.kvz += (dz / l) * amount;
  }

  // Short field-of-view squeeze (positive = zoom in) for big impacts.
  fovPunch(amount) {
    if (this.settings?.get('screenShake') === false) return;
    this.punchV += amount;
  }

  // Game-time slow motion: `scale` (0.2..1) held for `seconds` of real time with eased edges.
  // A stronger or longer request wins; they never stack into a long freeze.
  slowmo(scale, seconds) { this.slowState.request(scale, seconds); }
  rumble(strong, weak, ms) { this.input.rumble(strong, weak, ms); }

  // Called with real (unscaled) dt so effects keep animating during hit-stop.
  update(dt) {
    this.ps.q = this.settings?.quality.particles ?? 1;

    this.timeScale = this.slowState.update(dt);
    // Sparks and dust linger a little in slow motion, but never freeze.
    this.ps.update(dt * (0.35 + 0.65 * this.timeScale));

    // Camera kick spring (critically damped with a touch of overshoot) and FOV punch.
    this.kvx -= (this.kx * 260 + this.kvx * 17) * dt; this.kvz -= (this.kz * 260 + this.kvz * 17) * dt;
    this.kx += this.kvx * dt; this.kz += this.kvz * dt;
    this.punchV -= (this.punch * 300 + this.punchV * 19) * dt;
    this.punch += this.punchV * dt;
    if (Math.abs(this.punch) > 0.002 || Math.abs(this.punchV) > 0.01) {
      this.camera.fov = this.baseFov - Math.max(-3, Math.min(5, this.punch));
      this.camera.updateProjectionMatrix();
      this.fovDirty = true;
    } else if (this.fovDirty) { this.camera.fov = this.baseFov; this.camera.updateProjectionMatrix(); this.fovDirty = false; }

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
    return out.set((Math.random() - 0.5) * s + this.kx, (Math.random() - 0.5) * s, (Math.random() - 0.5) * s + this.kz);
  }
}
