// Player settings, saved per browser. Storage may be unavailable, so every
// access is guarded and defaults always work.
const KEY = 'eldiablo-kur-settings-v1';

// Per-preset fields (everything that is not a plain number is read where it is used):
//   pixelRatio  cap on devicePixelRatio (dynamic resolution may go lower on Mobile / Low)
//   lights      size of the pooled point-light pool; fixed when the world is built (reload to change)
//   post        false: no EffectComposer, the scene renders straight to the canvas
//   cheapShaders  simpler fog / terrain / water shaders; fixed when the world is built (reload to change)
//   shafts / life / grass / particles  density multipliers (0 = off)
//   envBake     false: no live PMREM re-bakes, a fixed small environment map instead
//   dynRes      adapt the pixel ratio to the measured frame time
export const QUALITY = {
  mobile: { label: 'Mobile', pixelRatio: 1, shadows: false, shadowSize: 1024, bloom: false, ao: false, aa: 'msaa', grass: 0, particles: 0.35, shafts: 0, lens: false, envBake: false, lights: 4, post: false, cheapShaders: true, life: 0.4, dynRes: true },
  low: { label: 'Low', pixelRatio: 1, shadows: false, shadowSize: 1024, bloom: false, ao: false, aa: 'fxaa', grass: 0, particles: 0.5, shafts: 0.3, lens: false, envBake: true, lights: 12, post: true, cheapShaders: false, life: 1, dynRes: false },
  medium: { label: 'Medium', pixelRatio: 1.25, shadows: true, shadowSize: 1024, bloom: true, ao: false, aa: 'fxaa', grass: 0.5, particles: 0.75, shafts: 0.6, lens: false, envBake: true, lights: 12, post: true, cheapShaders: false, life: 1, dynRes: false },
  high: { label: 'High', pixelRatio: 1.5, shadows: true, shadowSize: 2048, bloom: true, ao: false, aa: 'smaa', grass: 1, particles: 1, shafts: 1, lens: true, envBake: true, lights: 12, post: true, cheapShaders: false, life: 1, dynRes: false },
  ultra: { label: 'Ultra', pixelRatio: 2, shadows: true, shadowSize: 4096, bloom: true, ao: true, aa: 'smaa', grass: 1.5, particles: 1, shafts: 1, lens: true, envBake: true, lights: 12, post: true, cheapShaders: false, life: 1, dynRes: false },
};

// A phone: touch-first pointer and a small screen. Used to pick Mobile on a first visit.
export function looksLikePhone() {
  try {
    const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    const s = typeof screen !== 'undefined' ? Math.min(screen.width || 9999, screen.height || 9999) : 9999;
    return coarse && s < 600;
  } catch { return false; }
}

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
  gidim: true, // Night of the Gidim: the day's dead rise at night
  touchScale: 1, // touch layout size, 0.8 to 1.3 (src/ui/touch.js)
  touchLefty: false, // mirror the touch layout for left-handed play
  touchOpacity: 0.8, // stick and button opacity
  timeOfDay: 'cycle', // or a world/timeofday.js preset: dawn, noon, golden, dusk, night
  showFps: false, // corner readout: fps, frame ms, resolution scale, preset (also ?fps)
};

export class Settings {
  constructor() {
    this.values = { ...DEFAULTS };
    this.listeners = [];
    let saved = false;
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) { Object.assign(this.values, JSON.parse(raw)); saved = true; }
    } catch { /* storage unavailable: keep defaults */ }
    // First run on a phone: start on the Mobile preset (the player can still change it).
    if (!saved && looksLikePhone()) this.values.quality = 'mobile';
    // ?low / ?quality=medium in the URL override the saved preset (handy for tests).
    try {
      const p = new URLSearchParams(location.search);
      if (p.has('low')) this.values.quality = 'low';
      if (QUALITY[p.get('quality')]) this.values.quality = p.get('quality');
      // ?time=dusk holds the time of day for this visit only (deterministic screenshots).
      this.timeOverride = p.get('time');
      if (p.has('fps')) this.fpsFlag = p.get('fps') !== '0';
      this.dynResOff = p.get('dynres') === '0'; // ?dynres=0 pins the pixel ratio (measuring)
      this.msaaOff = p.get('msaa') === '0'; // ?msaa=0: no hardware MSAA on the Mobile canvas (A/B on a device)
    } catch { /* no location (tests) */ }
    if (!QUALITY[this.values.quality]) this.values.quality = DEFAULTS.quality;
    // Preset fields that are baked into the world when it is built (light pool size,
    // shader variants): changing the preset later needs a reload to take full effect.
    this.built = { lights: this.quality.lights, cheapShaders: this.quality.cheapShaders, post: this.quality.post };
  }

  get showFps() { return this.fpsFlag ?? !!this.values.showFps; }

  // True when the current preset wants a different light pool / shader set / output path than the world was built with.
  get needsReload() {
    const q = this.quality;
    return q.lights !== this.built.lights || q.cheapShaders !== this.built.cheapShaders || q.post !== this.built.post;
  }

  // The preset as the renderer can honour it right now: the parts baked in at build time
  // (post chain vs direct output, shader set, light pool) stay as built until a reload.
  get effective() {
    const q = this.quality, b = this.built;
    if (q.post === b.post && q.cheapShaders === b.cheapShaders && q.lights === b.lights) return q;
    const out = { ...q, post: b.post, cheapShaders: b.cheapShaders, lights: b.lights };
    if (out.post && out.aa === 'msaa') out.aa = 'fxaa';
    return out;
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
