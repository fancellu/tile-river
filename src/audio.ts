// All sound is made here in code. Nothing plays until enable() is called
// from a click on the "Enable sound" control.
const SCALE = [293.66, 329.63, 369.99, 440.0, 493.88, 587.33, 659.25, 739.99, 880.0, 987.77, 1174.66, 1318.5];

export class Sfx {
  ctx: AudioContext | null = null;
  on = false;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private water: GainNode | null = null;
  private lastClack = 0;

  enable(): void {
    if (!this.ctx) {
      const ctx = new AudioContext();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(ctx.destination);
      const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      this.noise = buf;
      // a quiet brook that swells as more of the river is joined
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1400;
      bp.Q.value = 0.7;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.31;
      const lg = ctx.createGain();
      lg.gain.value = 500;
      lfo.connect(lg).connect(bp.frequency);
      lfo.start();
      this.water = ctx.createGain();
      this.water.gain.value = 0;
      src.connect(bp).connect(this.water).connect(this.master);
      src.start();
    }
    void this.ctx.resume();
    this.on = true;
  }

  disable(): void {
    this.on = false;
    void this.ctx?.suspend();
  }

  private tone(freq: number, dur: number, vol: number, type: OscillatorType = 'sine', when = 0, slideTo = 0): void {
    if (!this.on || !this.ctx || !this.master) return;
    const t = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private hiss(dur: number, vol: number, freq: number, type: BiquadFilterType = 'highpass'): void {
    if (!this.on || !this.ctx || !this.master || !this.noise) return;
    const t = this.ctx.currentTime;
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(this.master);
    s.start(t, Math.random());
    s.stop(t + dur + 0.02);
  }

  /** Fired clay set against fired clay. */
  clink(v = 1): void {
    if (!this.on || !this.ctx) return;
    const now = this.ctx.currentTime;
    if (now - this.lastClack < 0.035) return;
    this.lastClack = now;
    const k = 0.92 + Math.random() * 0.16;
    this.tone(2140 * k, 0.07, 0.11 * v);
    this.tone(3390 * k, 0.05, 0.07 * v);
    this.tone(5270 * k, 0.03, 0.04 * v);
    this.tone(410 * k, 0.05, 0.1 * v, 'triangle');
    this.hiss(0.03, 0.12 * v, 3000);
  }

  thud(): void {
    this.tone(150, 0.14, 0.3, 'sine', 0, 70);
    this.hiss(0.06, 0.1, 500, 'lowpass');
  }

  lift(): void {
    this.hiss(0.05, 0.05, 2500);
  }

  /** A note as the water reaches another tile. */
  ping(i: number): void {
    const f = SCALE[i % SCALE.length] * (i >= SCALE.length ? 2 : 1);
    this.tone(f, 0.55, 0.1, 'sine');
    this.tone(f * 2.76, 0.2, 0.025, 'sine');
  }

  /** A small bell as part of the painted world wakes. */
  chime(i: number): void {
    const f = SCALE[(i * 5 + 3) % SCALE.length] * 2;
    this.tone(f, 1.1, 0.06, 'sine');
    this.tone(f * 2.01, 0.6, 0.02, 'sine');
    this.tone(f * 3.0, 0.3, 0.012, 'sine');
  }

  fanfare(): void {
    [0, 2, 4, 7].forEach((n, k) => this.tone(SCALE[n] * 2, 0.9, 0.09, 'triangle', k * 0.11));
  }

  /** Solved in par: a bright run of bells. */
  perfect(): void {
    [4, 5, 7, 9, 11].forEach((n, k) => {
      this.tone(SCALE[n] * 2, 1.2, 0.07, 'sine', 0.35 + k * 0.09);
      this.tone(SCALE[n] * 4.02, 0.5, 0.018, 'sine', 0.35 + k * 0.09);
    });
  }

  /** The sea creature surfaces. */
  creature(): void {
    this.tone(70, 2.2, 0.28, 'sine', 0, 150);
    this.tone(105, 2.0, 0.12, 'triangle', 0.2, 210);
    this.hiss(1.4, 0.08, 900, 'lowpass');
  }

  setWater(level: number): void {
    if (!this.ctx || !this.water) return;
    this.water.gain.setTargetAtTime(this.on ? 0.02 + level * 0.07 : 0, this.ctx.currentTime, 0.4);
  }
}
