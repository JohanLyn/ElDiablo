import * as THREE from 'three';

const MAX_PARTICLES = 600;

// Juice: particles, floating damage numbers, screen shake, hit-stop and rumble.
export class Fx {
  constructor(scene, camera, input, overlay) {
    this.camera = camera;
    this.input = input;
    this.overlay = overlay;
    this.trauma = 0;
    this.hitstop = 0;

    // One Points cloud for all particles (cheap, additive, colored per particle).
    this.pPos = new Float32Array(MAX_PARTICLES * 3);
    this.pCol = new Float32Array(MAX_PARTICLES * 3);
    this.pVel = new Float32Array(MAX_PARTICLES * 3);
    this.pLife = new Float32Array(MAX_PARTICLES);
    this.pMaxLife = new Float32Array(MAX_PARTICLES);
    this.pGravity = new Float32Array(MAX_PARTICLES);
    this.pBase = new Float32Array(MAX_PARTICLES * 3);
    this.pNext = 0;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.pCol, 3).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.PointsMaterial({
      size: 0.28, vertexColors: true, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, map: makeDotTexture(),
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    for (let i = 0; i < MAX_PARTICLES; i++) this.pPos[i * 3 + 1] = -100;
    scene.add(this.points);

    this.numbers = [];
    this._v = new THREE.Vector3();
    this._c = new THREE.Color();
  }

  burst(pos, color, count = 12, speed = 5, { up = 2, life = 0.5, gravity = 9, spread = 1 } = {}) {
    this._c.set(color);
    for (let n = 0; n < count; n++) {
      const i = this.pNext;
      this.pNext = (this.pNext + 1) % MAX_PARTICLES;
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.4 + Math.random() * 0.6);
      this.pPos[i * 3] = pos.x + (Math.random() - 0.5) * 0.3 * spread;
      this.pPos[i * 3 + 1] = pos.y + (Math.random() - 0.5) * 0.3 * spread;
      this.pPos[i * 3 + 2] = pos.z + (Math.random() - 0.5) * 0.3 * spread;
      this.pVel[i * 3] = Math.cos(a) * s;
      this.pVel[i * 3 + 1] = up * (0.5 + Math.random());
      this.pVel[i * 3 + 2] = Math.sin(a) * s;
      this.pBase[i * 3] = this._c.r; this.pBase[i * 3 + 1] = this._c.g; this.pBase[i * 3 + 2] = this._c.b;
      this.pLife[i] = this.pMaxLife[i] = life * (0.6 + Math.random() * 0.6);
      this.pGravity[i] = gravity;
    }
  }

  number(pos, value, { color = '#fff', big = false } = {}) {
    const el = document.createElement('div');
    el.className = 'dmg' + (big ? ' big' : '');
    el.textContent = Math.round(value);
    el.style.color = color;
    this.overlay.appendChild(el);
    this.numbers.push({ el, pos: pos.clone().add(new THREE.Vector3(0, 1.8, 0)), t: 0, drift: (Math.random() - 0.5) * 0.8 });
  }

  shake(amount) { this.trauma = Math.min(1, this.trauma + amount); }
  stop(seconds) { this.hitstop = Math.max(this.hitstop, seconds); }
  rumble(strong, weak, ms) { this.input.rumble(strong, weak, ms); }

  // Called with real (unscaled) dt so effects keep animating during hit-stop.
  update(dt) {
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (this.pLife[i] <= 0) continue;
      this.pLife[i] -= dt;
      const k = Math.max(0, this.pLife[i] / this.pMaxLife[i]);
      this.pVel[i * 3 + 1] -= this.pGravity[i] * dt;
      this.pPos[i * 3] += this.pVel[i * 3] * dt;
      this.pPos[i * 3 + 1] += this.pVel[i * 3 + 1] * dt;
      this.pPos[i * 3 + 2] += this.pVel[i * 3 + 2] * dt;
      if (this.pPos[i * 3 + 1] < 0.05) { this.pPos[i * 3 + 1] = 0.05; this.pVel[i * 3 + 1] *= -0.3; }
      this.pCol[i * 3] = this.pBase[i * 3] * k;
      this.pCol[i * 3 + 1] = this.pBase[i * 3 + 1] * k;
      this.pCol[i * 3 + 2] = this.pBase[i * 3 + 2] * k;
      if (this.pLife[i] <= 0) this.pPos[i * 3 + 1] = -100;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;

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

function makeDotTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.6)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
}
