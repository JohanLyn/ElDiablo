import * as THREE from 'three';

// Day cycle. `t` runs 0..1 over DAY_LENGTH seconds:
//   0.00 dawn (sun on the eastern horizon) → 0.30 noon → 0.56 golden hour →
//   0.66 sunset/dusk → 0.74..0.94 night (moonlight) → 1.00 dawn again.
// Pure maths so tests, world lighting and gameplay share one clock.
export const DAY_LENGTH = 840; // seconds (14 minutes)

export const TIME_PRESETS = { dawn: 0.02, noon: 0.3, golden: 0.56, dusk: 0.655, night: 0.84 };

const SUNRISE = 0, SUNSET = 0.68;
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export class TimeOfDay {
  constructor(t = TIME_PRESETS.dawn) {
    this.t = t;
    this.locked = null; // preset name, or null to cycle
    this.sunDir = new THREE.Vector3(); // unit vector toward the key light (sun by day, moon by night)
    this.update(0);
  }

  set(name) {
    if (name in TIME_PRESETS) this.t = TIME_PRESETS[name];
  }

  // Lock to a preset ('noon', 'dusk', ...) or pass null/'cycle' to let time run.
  lock(name) {
    this.locked = name in TIME_PRESETS ? name : null;
    if (this.locked) this.t = TIME_PRESETS[this.locked];
    this.update(0);
  }

  update(dt) {
    if (!this.locked) this.t = (this.t + dt / DAY_LENGTH) % 1;
    const t = this.t;
    // Sun arc: rises in the east, peaks around t=0.3 at ~62°, sets in the west at SUNSET.
    const dayK = (t - SUNRISE) / (SUNSET - SUNRISE); // 0..1 across the day
    const up = dayK >= 0 && dayK <= 1;
    const elevSun = Math.sin(Math.PI * Math.min(1, Math.max(0, dayK))) * 1.08; // radians, peak ~62°
    // Night: the moon rides high in the south-east so shadows still read.
    const nightK = up ? 0 : ((t - SUNSET + 1) % 1) / (1 - SUNSET + SUNRISE);
    const elevMoon = 0.55 + Math.sin(Math.PI * nightK) * 0.45;
    const az = up ? Math.PI * (0.15 + dayK * 0.7) : Math.PI * (1.2 + nightK * 0.3);
    const elev = up ? Math.max(0.06, elevSun) : elevMoon;
    this.sunDir.set(-Math.cos(az) * Math.cos(elev), Math.sin(elev), Math.sin(az) * Math.cos(elev) * 0.45 + 0.25).normalize();
    this.elevation = up ? elevSun : -0.2;
    // Blend weights for lighting and gameplay (lanterns, critters, music...).
    this.night = nightWeight(t);
    // Warm low-sun light: golden hour into sunset, and a softer echo at dawn.
    this.dusk = Math.max(smooth(0.5, 0.62, t) * (1 - smooth(0.66, 0.74, t)), t < 0.5 ? (1 - smooth(0.0, 0.08, t)) * 0.7 : 0);
    this.day = Math.max(0, 1 - this.night - this.dusk * 0.6);
    this.phase = t < 0.06 ? 'dawn' : t < 0.5 ? 'day' : t < 0.62 ? 'golden' : t < 0.72 ? 'dusk' : t < 0.97 ? 'night' : 'dawn';
    return this;
  }
}

// 0 by day, 1 in deep night, smooth across sunset (0.66..0.74) and dawn (0.94..1.02).
export function nightWeight(t) {
  const set = smooth(0.66, 0.74, t);
  const rise = 1 - smooth(0.94, 1.0, t);
  const morning = 1 - smooth(0.0, 0.04, t); // tail of the pre-dawn glow after wrap
  return t < 0.5 ? morning * 0.35 : Math.min(set, rise);
}
