import * as THREE from 'three';

// Pooled point lights. Anything that glows (lanterns, braziers, windows, the
// caravan fire, boss rooms) registers an *emitter*; each frame the nearest
// emitters around the hero borrow one of a fixed set of PointLights. The scene's
// light count never changes (no shader recompiles) and the world can hold far
// more light sources than forward rendering could afford.
//
//   const e = lights.add({ x, y, z, color: 0xffa860, intensity: 10, range: 16 });
//   e.intensity = 0;  e.enabled = false;  lights.remove(e);
//
// Emitter fields: x, y, z, color (hex or Color), intensity, range, decay (1.5),
// flicker (0..1, fire-like wobble), night (0..1: 0 = always on, 1 = only lit at
// dusk/night, e.g. lanterns), enabled, priority (bonus metres when ranking).
export const POOL_SIZE = 12;

export class LightManager {
  constructor(scene, size = POOL_SIZE) {
    this.emitters = [];
    this.pool = [];
    for (let i = 0; i < size; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 10, 1.5);
      l.userData.emitter = null;
      scene.add(l);
      this.pool.push(l);
    }
    this._ranked = [];
  }

  add(opts) {
    const e = {
      x: 0, y: 2, z: 0, intensity: 10, range: 14, decay: 1.5, flicker: 0, night: 0, enabled: true, priority: 0,
      ...opts,
      color: new THREE.Color(opts.color ?? 0xffffff),
      seed: Math.random() * 100,
    };
    this.emitters.push(e);
    return e;
  }

  remove(e) {
    const i = this.emitters.indexOf(e);
    if (i >= 0) this.emitters.splice(i, 1);
  }

  // Current brightness of an emitter (also used by meshes that glow with it).
  level(e, t, tod) {
    if (!e.enabled) return 0;
    const dark = tod ? Math.max(tod.night, tod.dusk * 0.55) : 0;
    const timeK = 1 - e.night * (1 - dark);
    const fl = e.flicker ? 1 + (Math.sin(t * 11 + e.seed) * 0.6 + Math.sin(t * 23.7 + e.seed * 2) * 0.4) * 0.12 * e.flicker : 1;
    return e.intensity * timeK * fl;
  }

  update(t, center, tod) {
    const ranked = this._ranked;
    ranked.length = 0;
    for (const e of this.emitters) {
      if (!e.enabled || e.intensity <= 0) continue;
      const d = Math.hypot(e.x - center.x, e.z - center.z) - e.priority;
      if (d > e.range + 36) continue;
      e._d = d;
      ranked.push(e);
    }
    ranked.sort((a, b) => a._d - b._d);
    for (let i = 0; i < this.pool.length; i++) {
      const l = this.pool[i], e = ranked[i];
      if (!e) { l.intensity = 0; l.userData.emitter = null; continue; }
      if (l.userData.emitter !== e) {
        l.userData.emitter = e;
        l.position.set(e.x, e.y, e.z);
        l.color.copy(e.color);
        l.distance = e.range;
        l.decay = e.decay;
      } else {
        l.position.set(e.x, e.y, e.z); // emitters may move
        l.color.copy(e.color);
      }
      l.intensity = this.level(e, t, tod);
    }
  }
}
