// Continuous tether hum: one persistent graph with a timbre per Aspect (lapis glassy,
// fire crackle, chain rattle, bulwark low drone). Its loudness, pitch and brightness
// follow how fast the player whips the tether. The graph is created lazily and torn
// down after it has been silent for a few seconds, so an idle tether costs nothing.
const ASPECT_INDEX = { lapis: 0, fire: 1, chain: 2, bulwark: 3 };

export class TetherHum {
  constructor(eng) {
    this.eng = eng;
    this.ctx = eng.ctx;
    this.nodes = null;
    this.level = 0; // smoothed 0..1
    this.silentFor = 0;
    this.aspect = 'lapis';
    this.mix = [1, 0, 0, 0];
  }

  build() {
    const c = this.ctx, t = c.currentTime;
    const out = c.createGain();
    out.gain.value = 0;
    const send = c.createGain();
    send.gain.value = 0.25;
    out.connect(this.eng.sfxBus);
    out.connect(send);
    send.connect(this.eng.sfxSend);
    const srcs = [];
    const start = (n) => { n.start(t); srcs.push(n); return n; };
    const osc = (type, f) => { const o = c.createOscillator(); o.type = type; o.frequency.value = f; return start(o); };
    const noise = (buf) => { const s = c.createBufferSource(); s.buffer = buf; s.loop = true; return start(s); };
    const chain = (...ns) => { for (let i = 0; i < ns.length - 1; i++) ns[i].connect(ns[i + 1]); return ns[ns.length - 1]; };
    const gain = (v) => { const g = c.createGain(); g.gain.value = v; return g; };
    const bq = (type, f, q = 0.7) => { const b = c.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; };

    // 0 lapis: glass partials (inharmonic sines) + a breath of air
    const lapisG = gain(0);
    const l1 = osc('sine', 520), l2 = osc('sine', 520 * 2.76), l3 = osc('sine', 520 * 1.5 * 1.002);
    const lg = [gain(0.5), gain(0.14), gain(0.22)];
    [l1, l2, l3].forEach((o, i) => { o.connect(lg[i]); lg[i].connect(lapisG); });
    const lAir = chain(noise(this.eng.noise.white), bq('bandpass', 4200, 3), gain(0.05), lapisG);
    // shimmer tremolo
    const trem = osc('sine', 6.5);
    const tremG = gain(0.15);
    trem.connect(tremG);
    tremG.connect(lapisG.gain);

    // 1 fire: crackling noise + low roar
    const fireG = gain(0);
    const fireLP = bq('lowpass', 900, 0.6);
    const fireAM = gain(0.5);
    chain(noise(this.eng.noise.pink), fireLP, fireAM, fireG);
    const crack = osc('square', 13);
    const crackG = gain(0.45);
    crack.connect(crackG);
    crackG.connect(fireAM.gain);
    chain(osc('sine', 70), gain(0.5), fireG);
    chain(noise(this.eng.noise.white), bq('highpass', 5500), gain(0.05), fireG);

    // 2 chain: detuned squares through a resonant band + rattle
    const chainG = gain(0);
    const chainBP = bq('bandpass', 700, 5);
    const c1 = osc('square', 180), c2 = osc('square', 181.7);
    const cs = gain(0.07);
    c1.connect(cs); c2.connect(cs);
    chain(cs, chainBP, chainG);
    const rattleAM = gain(0.5);
    const rattleLfo = osc('square', 26);
    const rattleLfoG = gain(0.5);
    rattleLfo.connect(rattleLfoG);
    rattleLfoG.connect(rattleAM.gain);
    chain(noise(this.eng.noise.white), bq('highpass', 3800), rattleAM, gain(0.1), chainG);

    // 3 bulwark: deep hum
    const bulG = gain(0);
    const bLP = bq('lowpass', 260, 0.8);
    const b1 = osc('sine', 55), b2 = osc('sine', 110.6), b3 = osc('triangle', 82.5);
    const bg = [gain(0.7), gain(0.3), gain(0.25)];
    [b1, b2, b3].forEach((o, i) => { o.connect(bg[i]); bg[i].connect(bLP); });
    bLP.connect(bulG);
    const bTrem = osc('sine', 3.2);
    const bTremG = gain(0.2);
    bTrem.connect(bTremG);
    bTremG.connect(bulG.gain);

    for (const g of [lapisG, fireG, chainG, bulG]) g.connect(out);
    this.nodes = { out, send, srcs, lapisG, fireG, chainG, bulG, l1, l2, l3, fireLP, chainBP, rattleLfo, bLP, crack, groups: [lapisG, fireG, chainG, bulG] };
  }

  teardown() {
    const n = this.nodes;
    if (!n) return;
    const t = this.ctx.currentTime;
    for (const s of n.srcs) { try { s.stop(t + 0.05); } catch { /* ended */ } }
    setTimeout(() => { try { n.out.disconnect(); n.send.disconnect(); } catch { /* ignore */ } }, 200);
    this.nodes = null;
  }

  // target: 0..1 drive (0 = off). sweep: 0..1.5 tether whip speed. aspect: id.
  update(dt, drive, sweep, aspect) {
    this.level += (drive - this.level) * (1 - Math.exp(-dt / (drive > this.level ? 0.08 : 0.25)));
    if (this.level < 0.01 && drive <= 0) {
      this.silentFor += dt;
      if (this.silentFor > 3) this.teardown();
      return;
    }
    this.silentFor = 0;
    if (!this.nodes) this.build();
    const n = this.nodes, t = this.ctx.currentTime, tc = 0.05;
    const s = Math.min(1.5, sweep);
    n.out.gain.setTargetAtTime(this.level * 0.2, t, tc);
    const ai = ASPECT_INDEX[aspect] ?? 0;
    n.groups.forEach((g, i) => g.gain.setTargetAtTime(i === ai ? 1 : 0, t, 0.12));
    // pitch / brightness rise with the whip
    const f = 520 * (1 + s * 0.9);
    n.l1.frequency.setTargetAtTime(f, t, tc);
    n.l2.frequency.setTargetAtTime(f * 2.76, t, tc);
    n.l3.frequency.setTargetAtTime(f * 1.5, t, tc);
    n.fireLP.frequency.setTargetAtTime(700 + s * 2600, t, tc);
    n.crack.frequency.setTargetAtTime(11 + s * 18, t, tc);
    n.chainBP.frequency.setTargetAtTime(600 + s * 1400, t, tc);
    n.rattleLfo.frequency.setTargetAtTime(20 + s * 30, t, tc);
    n.bLP.frequency.setTargetAtTime(220 + s * 420, t, tc);
  }
}
