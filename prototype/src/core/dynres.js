// Dynamic resolution: keeps the frame rate by trading pixel ratio for speed.
//
// Frame intervals are averaged over half-second windows.
//   slow: 4 windows in a row (about 2 s) above SLOW_MS lower the ratio one step (x0.85, floor 0.6)
//   fast: 16 healthy windows (8 s) raise it one step toward the preset cap
// A ratio that just failed is remembered as a ceiling for 40 s, so the ratio can't
// flap between two steps. A display vsynced at 60 Hz never reports under 16.7 ms,
// so "healthy" is 60 fps on a 60 Hz class display and under 14 ms on a faster one.
const WINDOW = 0.5; // s
const SLOW_MS = 22;
const SLOW_WINDOWS = 4; // 2 s
const FAST_WINDOWS = 16; // 8 s
const STEP = 0.85;
const FLOOR = 0.6;
const CEILING_MEMORY = 40; // s

export class DynRes {
  constructor() {
    this.enabled = false;
    this.cap = 1;
    this.ratio = 1;
    this.reset();
  }

  reset() {
    this.t = 0; this.n = 0; this.sum = 0;
    this.slow = 0; this.fast = 0;
    this.hold = 0;
    this.refresh = 17; // smallest window average seen: the display's frame interval
    this.ceiling = Infinity;
    this.ceilingT = 0;
  }

  configure(cap, enabled) {
    this.cap = cap;
    this.enabled = enabled;
    this.ratio = enabled ? Math.min(this.ratio || cap, cap) : cap;
    this.reset();
  }

  // Feed one frame interval (ms). Returns a new pixel ratio when it should change, else 0.
  frame(ms, nowMs = performance.now()) {
    if (!this.enabled) return 0;
    if (ms > 250 || (typeof document !== 'undefined' && document.hidden)) return 0; // hitches, hidden tab: ignore
    this.t += ms / 1000; this.n++; this.sum += ms;
    if (this.t < WINDOW) return 0;
    const avg = this.sum / this.n;
    this.t = 0; this.n = 0; this.sum = 0;
    if (this.hold > 0) { this.hold--; return 0; } // let the resize and shader warm-up settle
    this.refresh = Math.min(this.refresh, Math.max(avg, 7));
    const now = nowMs / 1000;
    if (now > this.ceilingT + CEILING_MEMORY) this.ceiling = Infinity;
    if (avg > SLOW_MS) {
      this.fast = 0;
      if (++this.slow >= SLOW_WINDOWS && this.ratio > FLOOR + 0.001) {
        this.slow = 0;
        this.ceiling = this.ratio; this.ceilingT = now;
        return this._set(Math.max(FLOOR, +(this.ratio * STEP).toFixed(3)));
      }
      return 0;
    }
    this.slow = 0;
    const healthy = avg < (this.refresh > 14 ? 18.5 : 14);
    if (healthy && this.ratio < this.cap - 0.001) {
      if (++this.fast >= FAST_WINDOWS) {
        this.fast = 0;
        const next = Math.min(this.cap, +(this.ratio / STEP).toFixed(3));
        if (next < this.ceiling - 0.001) return this._set(next);
      }
    } else this.fast = 0;
    return 0;
  }

  _set(r) {
    this.ratio = r;
    this.hold = 2;
    return r;
  }
}
