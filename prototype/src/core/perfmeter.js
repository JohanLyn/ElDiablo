// Corner performance readout for testing on a real phone: Settings -> Graphics ->
// Show FPS, or add ?fps to the URL (?fps=tr|bl|br picks another corner).
//
//   58 fps  17.2 ms  x0.85
//   Mobile  142 calls  210k tris  6 lights
//
// FPS and frame time are averaged over half a second (the worst frame in the window is
// shown too). The element is created on first use, ignores pointers, and costs one
// textContent write per half second while visible.
const STYLE_ID = 'perf-meter-style';
const CSS = `
#perf-meter { position: fixed; z-index: 90; pointer-events: none; user-select: none; -webkit-user-select: none;
  margin: max(6px, env(safe-area-inset-top)) max(8px, env(safe-area-inset-right)) max(6px, env(safe-area-inset-bottom)) max(8px, env(safe-area-inset-left));
  padding: 4px 9px 5px; min-width: 128px; border-radius: 3px;
  font: 600 11px/1.3 var(--font-body, system-ui, sans-serif); letter-spacing: 0.03em; font-variant-numeric: tabular-nums;
  color: var(--shell, #efe6cf); text-shadow: 0 1px 2px #000;
  background: linear-gradient(180deg, rgba(20, 48, 110, 0.82), rgba(11, 26, 62, 0.88));
  border: 1px solid var(--gold, #d9a441);
  box-shadow: inset 0 0 0 1px rgba(11, 26, 62, 0.9), inset 0 0 0 2px rgba(143, 180, 255, 0.28), 0 2px 8px rgba(0, 0, 0, 0.55); }
#perf-meter[data-corner="tl"] { top: 0; left: 0; }
#perf-meter[data-corner="tr"] { top: 0; right: 0; text-align: right; }
#perf-meter[data-corner="bl"] { bottom: 0; left: 0; }
#perf-meter[data-corner="br"] { bottom: 0; right: 0; text-align: right; }
#perf-meter b { color: var(--gold-hi, #f6d27a); font-weight: 700; }
#perf-meter .pm-sub { color: var(--shell-dim, #b9ad94); font-weight: 500; }
#perf-meter[data-level="warn"] b.pm-fps { color: #ffcf6a; }
#perf-meter[data-level="bad"] b.pm-fps { color: var(--bad, #ff7a64); }
`;

const WINDOW = 0.5; // s

export class PerfMeter {
  constructor(settings, renderer) {
    this.settings = settings;
    this.renderer = renderer;
    this.el = null;
    this.t = 0; this.n = 0; this.sum = 0; this.worst = 0;
    this.fps = 0; this.ms = 0;
    settings.onChange((k) => { if (k === 'showFps') this._sync(); });
    this._sync();
  }

  get on() { return !!this.settings.showFps; }

  _corner() {
    try {
      const c = new URLSearchParams(location.search).get('fps');
      if (c === 'tr' || c === 'bl' || c === 'br' || c === 'tl') return c;
    } catch { /* no location */ }
    return 'tl';
  }

  _sync() {
    if (this.on && !this.el && typeof document !== 'undefined' && document.body) {
      if (!document.getElementById(STYLE_ID)) {
        const st = document.createElement('style');
        st.id = STYLE_ID;
        st.textContent = CSS;
        document.head.appendChild(st);
      }
      const el = document.createElement('div');
      el.id = 'perf-meter';
      el.setAttribute('aria-hidden', 'true');
      el.dataset.corner = this._corner();
      el.innerHTML = '<div><b class="pm-fps">--</b> fps &nbsp;<b class="pm-ms">--</b> ms &nbsp;<b class="pm-res">--</b></div><div class="pm-sub"></div>';
      document.body.appendChild(el);
      this.el = el;
      this.fpsEl = el.querySelector('.pm-fps');
      this.msEl = el.querySelector('.pm-ms');
      this.resEl = el.querySelector('.pm-res');
      this.subEl = el.querySelector('.pm-sub');
    }
    if (this.el) this.el.style.display = this.on ? '' : 'none';
  }

  // One frame interval in ms (called from Renderer.render).
  frame(ms) {
    if (!this.on || ms > 1000) return;
    this.t += ms / 1000; this.n++; this.sum += ms;
    if (ms > this.worst) this.worst = ms;
    if (this.t < WINDOW) return;
    this.ms = this.sum / this.n;
    this.fps = 1000 / this.ms;
    const worst = this.worst;
    this.t = 0; this.n = 0; this.sum = 0; this.worst = 0;
    if (!this.el) return;
    const r = this.renderer, info = r.webgl.info.render, q = this.settings.quality;
    this.fpsEl.textContent = this.fps >= 100 ? this.fps.toFixed(0) : this.fps.toFixed(1);
    this.msEl.textContent = `${this.ms.toFixed(1)}`;
    this.resEl.textContent = `\u00d7${r.dyn.ratio.toFixed(2)}`;
    this.el.dataset.level = this.fps < 24 ? 'bad' : this.fps < 45 ? 'warn' : 'ok';
    this.subEl.textContent = `${q.label}${r.settings.needsReload ? '*' : ''} · ${info.calls} calls · ${info.triangles >= 1e5 ? `${Math.round(info.triangles / 1000)}k` : info.triangles} tris · ${r.lightCount} lights · worst ${worst.toFixed(0)} ms`;
  }
}
