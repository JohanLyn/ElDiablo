// Player settings, saved per browser. Storage may be unavailable, so every
// access is guarded and defaults always work.
const KEY = 'eldiablo-kur-settings-v1';

export const QUALITY = {
  low: { label: 'Low', pixelRatio: 1, shadows: false, shadowSize: 1024, bloom: false, ao: false, aa: 'fxaa', grass: 0, particles: 0.5 },
  medium: { label: 'Medium', pixelRatio: 1.25, shadows: true, shadowSize: 1024, bloom: true, ao: false, aa: 'fxaa', grass: 0.5, particles: 0.75 },
  high: { label: 'High', pixelRatio: 1.5, shadows: true, shadowSize: 2048, bloom: true, ao: false, aa: 'smaa', grass: 1, particles: 1 },
  ultra: { label: 'Ultra', pixelRatio: 2, shadows: true, shadowSize: 4096, bloom: true, ao: true, aa: 'smaa', grass: 1.5, particles: 1 },
};

export const DEFAULTS = {
  quality: 'high',
  master: 0.8,
  music: 0.6,
  sfx: 0.8,
  screenShake: true,
  damageNumbers: true,
  rumble: true,
  colorblind: false,
  uiScale: 1,
  tutorials: true,
};

export class Settings {
  constructor() {
    this.values = { ...DEFAULTS };
    this.listeners = [];
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) Object.assign(this.values, JSON.parse(raw));
    } catch { /* storage unavailable: keep defaults */ }
    // ?low / ?quality=medium in the URL override the saved preset (handy for tests).
    try {
      const p = new URLSearchParams(location.search);
      if (p.has('low')) this.values.quality = 'low';
      if (QUALITY[p.get('quality')]) this.values.quality = p.get('quality');
    } catch { /* no location (tests) */ }
    if (!QUALITY[this.values.quality]) this.values.quality = DEFAULTS.quality;
  }

  get(key) { return this.values[key]; }
  get quality() { return QUALITY[this.values.quality]; }

  set(key, value) {
    this.values[key] = value;
    try { localStorage.setItem(KEY, JSON.stringify(this.values)); } catch { /* ignore */ }
    for (const fn of this.listeners) fn(key, value);
  }

  onChange(fn) { this.listeners.push(fn); }
}
