import { getSettings } from './settings';

/** Tiny synthesized SFX engine on the Web Audio API. No audio files needed. */
class AudioManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private lastHover = 0;

  /** Must be called from a user gesture at least once. */
  unlock(): void {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || (window as any).webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.connect(this.ctx.destination);
        const len = this.ctx.sampleRate;
        this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = this.noise.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
    } catch {
      /* audio is optional */
    }
  }

  private ready(): AudioContext | null {
    const s = getSettings();
    if (!s.sfx || s.volume <= 0 || !this.ctx || !this.master || this.ctx.state !== 'running') return null;
    this.master.gain.value = s.volume;
    return this.ctx;
  }

  private tone(type: OscillatorType, f0: number, f1: number, dur: number, vol: number, delay = 0): void {
    const c = this.ready();
    if (!c || !this.master) return;
    const t = c.currentTime + delay;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private burst(dur: number, vol: number, f0: number, f1: number, q = 1, type: BiquadFilterType = 'bandpass', delay = 0): void {
    const c = this.ready();
    if (!c || !this.master || !this.noise) return;
    const t = c.currentTime + delay;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

  click(): void {
    this.tone('square', 720, 520, 0.07, 0.08);
  }
  hover(): void {
    const n = performance.now();
    if (n - this.lastHover < 60) return;
    this.lastHover = n;
    this.tone('sine', 1300, 1300, 0.03, 0.025);
  }
  tick(urgent: boolean): void {
    this.tone('sine', urgent ? 1050 : 700, urgent ? 1000 : 680, urgent ? 0.11 : 0.07, urgent ? 0.14 : 0.08);
  }
  roundStart(): void {
    this.burst(0.35, 0.05, 300, 1800, 0.8, 'bandpass');
  }
  lock(on: boolean): void {
    if (on) {
      this.tone('triangle', 480, 900, 0.1, 0.14);
      this.tone('square', 1200, 1200, 0.04, 0.05, 0.09);
    } else this.tone('triangle', 800, 420, 0.1, 0.1);
  }
  lockPhase(): void {
    this.tone('sawtooth', 200, 900, 0.5, 0.06);
  }
  fire(): void {
    this.burst(0.28, 0.35, 5000, 300, 2, 'bandpass');
    this.tone('sawtooth', 1400, 70, 0.24, 0.18);
    this.tone('sine', 120, 38, 0.3, 0.25);
  }
  eliminate(): void {
    this.burst(0.5, 0.4, 1800, 80, 0.7, 'lowpass');
    this.tone('triangle', 320, 36, 0.45, 0.22);
  }
  win(): void {
    [523, 659, 784, 1047].forEach((f, i) => this.tone('square', f, f, 0.18, 0.1, i * 0.1));
    this.tone('triangle', 1047, 1047, 0.5, 0.1, 0.4);
  }
  lose(): void {
    [440, 392, 330, 262].forEach((f, i) => this.tone('triangle', f, f * 0.98, 0.22, 0.12, i * 0.14));
  }
}

export const audio = new AudioManager();
