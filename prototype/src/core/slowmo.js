// Game-time slow motion. A request holds `scale` (0.2..1) for `seconds` of REAL time with eased
// edges; the owner multiplies gameplay dt by `scale`. It is advanced with real dt, so it always
// expires, even when a test harness steps the simulation by hand, and it can never stack into a
// long freeze (requests are capped at SLOWMO_MAX seconds).
export const SLOWMO_MAX = 0.8;
export const SLOWMO_MIN_SCALE = 0.2;

export class SlowMo {
  constructor() {
    this.left = 0;
    this.dur = 0;
    this.target = 1;
    this.scale = 1;
  }

  // A stronger (lower scale) or longer request wins; a weaker one during a running slow-mo is ignored.
  request(scale, seconds) {
    const left = this.left > 0 ? this.left : 0;
    if (left > 0 && scale > this.target && seconds <= left) return;
    this.target = Math.max(SLOWMO_MIN_SCALE, Math.min(1, scale));
    this.left = this.dur = Math.min(SLOWMO_MAX, Math.max(seconds, left));
  }

  update(dt) {
    if (this.left > 0) {
      this.left = Math.max(0, this.left - dt);
      const t = 1 - this.left / this.dur;
      const env = t < 0.1 ? t / 0.1 : t < 0.55 ? 1 : 1 - (t - 0.55) / 0.45; // quick in, hold, ease out
      this.scale = 1 - (1 - this.target) * Math.max(0, env);
    } else this.scale = 1;
    return this.scale;
  }
}
