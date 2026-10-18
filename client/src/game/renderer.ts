import { DEFAULT_CONFIG } from '@shared/config';
import { traceBeam } from '@shared/geometry';
import type { Shot } from '@shared/engine';
import type { GameSession } from './session';
import { getSettings, particleFactor } from './settings';

const CFG = DEFAULT_CONFIG;
export const ARENA = CFG.arena.w;
const R = CFG.arena.playerRadius;
const TAU = Math.PI * 2;
const MAX_DPR = 2;

interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; color: string; drag: number }
interface Pulse { x: number; y: number; start: number; dur: number; r0: number; r1: number; color: string; width: number; fill: boolean }
interface Beam {
  shot: Shot;
  color: string;
  glow: string;
  cum: number[];
  total: number;
  start: number;
  impacted: boolean;
  bounceDone: boolean[];
  muzzled: boolean;
}
/** vis: 0..1 fade used for the vanish / reveal transitions. posRound: the round `x,y` belong to. */
interface PStateR { x: number; y: number; wa: number; seed: number; dead: boolean; deadAt: number; init: boolean; vis: number; posRound: number }

export interface RendererHooks {
  onFire?: () => void;
  onKill?: () => void;
}

const hexRgb = (h: string) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private raf = 0;
  private running = false;
  private side = 0;
  private dpr = 1;
  private scale = 1;
  private bg: HTMLCanvasElement | null = null;
  private ro: ResizeObserver;
  private parts: Particle[] = [];
  private pulses: Pulse[] = [];
  private beams: Beam[] = [];
  private ps = new Map<string, PStateR>();
  private lastT = 0;
  private lastRound = -1;
  private firedRound = -1;
  private shakeUntil = 0;
  private shakeAmp = 0;
  private flash = 0;
  private flashColor = '#ffffff';
  private bannerText = '';
  private bannerAt = 0;
  private lastPhase = '';

  constructor(
    private canvas: HTMLCanvasElement,
    private wrap: HTMLElement,
    private session: GameSession,
    private hooks: RendererHooks = {},
  ) {
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(wrap);
    window.addEventListener('orientationchange', this.onOrient);
    this.resize();
  }

  private onOrient = () => setTimeout(() => this.resize(), 120);

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastT = performance.now();
    const loop = (t: number) => {
      if (!this.running) return;
      this.frame(t);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  destroy(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    window.removeEventListener('orientationchange', this.onOrient);
    this.parts.length = 0;
    this.pulses.length = 0;
    this.beams.length = 0;
    this.bg = null;
  }

  /** Converts a viewport coordinate to arena coordinates (always uses the live canvas rect). */
  toArena(clientX: number, clientY: number): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: ((clientX - r.left) / r.width) * ARENA, y: ((clientY - r.top) / r.height) * ARENA };
  }

  private resize(): void {
    const w = this.wrap.clientWidth;
    const h = this.wrap.clientHeight;
    const side = Math.max(120, Math.floor(Math.min(w, h)));
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    if (side === this.side && dpr === this.dpr) return;
    this.side = side;
    this.dpr = dpr;
    this.canvas.style.width = this.canvas.style.height = `${side}px`;
    this.canvas.width = this.canvas.height = Math.round(side * dpr);
    this.scale = this.canvas.width / ARENA;
    this.bg = null;
  }

  /* ------------------------------------------------------------ background */

  private buildBackground(): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = c.height = this.canvas.width;
    const g = c.getContext('2d')!;
    g.scale(this.scale, this.scale);
    const grad = g.createRadialGradient(500, 500, 60, 500, 500, 760);
    grad.addColorStop(0, '#111a33');
    grad.addColorStop(0.55, '#0a1020');
    grad.addColorStop(1, '#060912');
    g.fillStyle = grad;
    g.fillRect(0, 0, ARENA, ARENA);
    // grid
    g.lineWidth = 1 / this.scale;
    for (let i = 0; i <= 20; i++) {
      const p = i * 50;
      g.strokeStyle = i % 5 === 0 ? 'rgba(157,107,255,0.16)' : 'rgba(120,140,220,0.07)';
      g.beginPath();
      g.moveTo(p, 0); g.lineTo(p, ARENA);
      g.moveTo(0, p); g.lineTo(ARENA, p);
      g.stroke();
    }
    // neon border
    const edge = (w: number, a: number) => {
      g.lineWidth = w;
      g.strokeStyle = `rgba(157,107,255,${a})`;
      g.strokeRect(w / 2, w / 2, ARENA - w, ARENA - w);
    };
    edge(18, 0.05); edge(10, 0.12); edge(4, 0.85);
    // corner brackets
    g.strokeStyle = '#d9c6ff';
    g.lineWidth = 5;
    g.lineCap = 'round';
    const L = 60, m = 16;
    for (const [cx, cy, sx, sy] of [[m, m, 1, 1], [ARENA - m, m, -1, 1], [m, ARENA - m, 1, -1], [ARENA - m, ARENA - m, -1, -1]] as const) {
      g.beginPath();
      g.moveTo(cx, cy + sy * L); g.lineTo(cx, cy); g.lineTo(cx + sx * L, cy);
      g.stroke();
      g.fillStyle = '#9d6bff';
      g.beginPath(); g.arc(cx + sx * 14, cy + sy * 14, 4, 0, TAU); g.fill();
    }
    return c;
  }

  /* ------------------------------------------------------------ fx helpers */

  private burst(x: number, y: number, color: string, n: number, speed: number, life = 0.5, size = 3): void {
    const count = Math.round(n * particleFactor(getSettings()));
    for (let i = 0; i < count; i++) {
      if (this.parts.length > 420) this.parts.shift();
      const a = Math.random() * TAU;
      const s = speed * (0.35 + Math.random() * 0.65);
      this.parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0, max: life * (0.6 + Math.random() * 0.7), size: size * (0.6 + Math.random()), color, drag: 2.6 });
    }
  }

  private pulse(x: number, y: number, color: string, now: number, r0: number, r1: number, dur: number, width = 6, fill = false): void {
    if (this.pulses.length > 40) this.pulses.shift();
    this.pulses.push({ x, y, start: now, dur, r0, r1, color, width, fill });
  }

  private shake(amp: number, ms: number, now: number): void {
    if (getSettings().reducedMotion) return;
    this.shakeAmp = amp;
    this.shakeUntil = now + ms;
  }

  private doFlash(a: number, color = '#ffffff'): void {
    if (getSettings().reducedMotion) return;
    this.flash = Math.max(this.flash, a);
    this.flashColor = color;
  }

  /* ------------------------------------------------------------ state sync */

  private syncState(now: number, dt: number): void {
    const view = this.session.view;
    if (!view) return;
    const snap = view.snap;

    if (snap.round !== this.lastRound) {
      this.lastRound = snap.round;
      this.beams.length = 0;
      this.firedRound = -1;
      for (const p of snap.players) {
        const s = this.ps.get(p.id);
        if (s && p.alive) { s.dead = false; s.deadAt = 0; }
      }
    }
    if (snap.phase !== this.lastPhase) {
      this.lastPhase = snap.phase;
      const labels: Record<string, string> = { aiming: `ROUND ${snap.round}`, lock: 'LOCKED IN', fire: 'FIRE!' };
      if (labels[snap.phase]) { this.bannerText = labels[snap.phase]; this.bannerAt = now; }
    }

    const reveal = snap.phase === 'fire' || snap.phase === 'result' || snap.phase === 'over';
    const reduced = getSettings().reducedMotion;
    for (const p of snap.players) {
      let s = this.ps.get(p.id);
      const col = CFG.colors[p.slot % 4];
      if (!s) {
        s = { x: 0, y: 0, wa: 0, seed: Math.random() * 100, dead: false, deadAt: 0, init: false, vis: 0, posRound: -1 };
        this.ps.set(p.id, s);
      }
      const isMe = p.id === this.session.youId;
      const known = p.x !== undefined && p.y !== undefined;
      if (known && s.posRound !== snap.round) {
        // New round, new (server-chosen) position: teleport instead of sliding.
        if (isMe && s.init && s.vis > 0.05 && !reduced) {
          this.pulse(s.x, s.y, col.hex, now, R * 0.5, R * 2.8, 340, 4);
          this.burst(s.x, s.y, col.glow, 12, 300, 0.4, 2.6);
        }
        s.x = p.x!;
        s.y = p.y!;
        s.posRound = snap.round;
        s.init = true;
        if (isMe) {
          s.vis = 0;
          if (!reduced) {
            this.pulse(s.x, s.y, '#ffffff', now, R * 2.6, R * 0.6, 300, 3);
            this.pulse(s.x, s.y, col.hex, now, 4, R * 1.8, 360, 0, true);
            this.burst(s.x, s.y, col.glow, 14, 320, 0.45, 2.6);
          }
        } else {
          // opponent revealed by the volley
          s.vis = 0.45;
          if (!reduced) this.pulse(s.x, s.y, col.glow, now, R * 0.6, R * 2.2, 300, 3);
        }
      }
      const show = known && (isMe || reveal);
      s.vis += ((show ? 1 : 0) - s.vis) * (1 - Math.exp(-dt * (show ? 12 : 9)));
      if (s.vis < 0.01 && !show) s.vis = 0;
      if (!p.alive && snap.phase !== 'fire' && !s.dead) { s.dead = true; s.deadAt = -1e9; }
    }

    // trigger the volley once per round
    if ((snap.phase === 'fire' || snap.phase === 'result' || snap.phase === 'over') && snap.shots.length && this.firedRound !== snap.round) {
      this.firedRound = snap.round;
      const phaseStart = view.endsAt - snap.phaseMs;
      const start = snap.phase === 'fire' ? phaseStart : phaseStart - CFG.timing.fireMs;
      this.beams = snap.shots.map((shot) => {
        const shooter = snap.players.find((p) => p.id === shot.shooterId)!;
        const col = CFG.colors[shooter.slot % 4];
        const cum = [0];
        for (let i = 2; i < shot.points.length; i += 2) cum.push(cum[cum.length - 1] + Math.hypot(shot.points[i] - shot.points[i - 2], shot.points[i + 1] - shot.points[i - 1]));
        return { shot, color: col.hex, glow: col.glow, cum, total: cum[cum.length - 1], start, impacted: false, bounceDone: cum.map(() => false), muzzled: false };
      });
      if (snap.phase === 'fire' && now - start < 300) {
        this.hooks.onFire?.();
        this.doFlash(0.22);
      }
    }
  }

  private updateBeams(now: number): void {
    const speed = CFG.beam.speed;
    for (const b of this.beams) {
      const elapsed = now - b.start;
      if (elapsed < 0) continue;
      const late = elapsed > 1200;
      const shooter = this.ps.get(b.shot.shooterId);
      if (!b.muzzled) {
        b.muzzled = true;
        if (!late && shooter) {
          const mx = b.shot.points[0] + Math.cos(b.shot.angle) * (R + 16);
          const my = b.shot.points[1] + Math.sin(b.shot.angle) * (R + 16);
          this.pulse(mx, my, '#ffffff', now, 4, 34, 140, 0, true);
          this.burst(mx, my, b.glow, 10, 360, 0.3, 2.5);
        }
      }
      const head = (elapsed / 1000) * speed;
      for (let i = 1; i < b.cum.length - 1; i++) {
        if (!b.bounceDone[i] && head >= b.cum[i]) {
          b.bounceDone[i] = true;
          if (!late) this.burst(b.shot.points[i * 2], b.shot.points[i * 2 + 1], b.glow, 8, 260, 0.35, 2.2);
        }
      }
      if (!b.impacted && head >= b.total) {
        b.impacted = true;
        const n = b.shot.points.length;
        const ex = b.shot.points[n - 2], ey = b.shot.points[n - 1];
        if (b.shot.hitId) {
          const v = this.ps.get(b.shot.hitId);
          if (v && !v.dead) {
            v.dead = true;
            v.deadAt = late ? -1e9 : now;
            if (!late) {
              const pl = this.session.view?.snap.players.find((p) => p.id === b.shot.hitId);
              const col = pl ? CFG.colors[pl.slot % 4] : CFG.colors[0];
              this.pulse(v.x, v.y, col.hex, now, R, 150, 520, 8);
              this.pulse(v.x, v.y, '#ffffff', now, R * 0.5, 90, 260, 0, true);
              this.burst(v.x, v.y, col.hex, 36, 520, 0.8, 4);
              this.burst(v.x, v.y, '#ffffff', 14, 420, 0.5, 2.5);
              this.shake(11, 380, now);
              this.doFlash(0.38, col.glow);
              this.hooks.onKill?.();
            }
          }
        }
        if (!late) {
          this.burst(ex, ey, b.glow, b.shot.hitId ? 18 : 10, 380, 0.45, 2.8);
          this.pulse(ex, ey, b.glow, now, 4, 28, 240, 3);
        }
      }
    }
  }

  /* ------------------------------------------------------------ frame */

  private frame(t: number): void {
    const now = t;
    const dt = Math.min(0.05, (now - this.lastT) / 1000);
    this.lastT = now;
    if (!this.bg) this.bg = this.buildBackground();
    this.syncState(now, dt);
    this.updateBeams(now);

    const g = this.ctx;
    const settings = getSettings();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = '#060912';
    g.fillRect(0, 0, this.canvas.width, this.canvas.height);
    let sx = 0, sy = 0;
    if (now < this.shakeUntil) {
      const k = (this.shakeUntil - now) / 380;
      sx = (Math.random() - 0.5) * this.shakeAmp * k * this.scale;
      sy = (Math.random() - 0.5) * this.shakeAmp * k * this.scale;
    }
    g.setTransform(1, 0, 0, 1, sx, sy);
    g.drawImage(this.bg, 0, 0);
    g.setTransform(this.scale, 0, 0, this.scale, sx, sy);

    const view = this.session.view;
    const snap = view?.snap;
    if (!snap || !view) { this.drawIdle(now); return; }

    this.drawTimer(now, snap, view.endsAt);

    const me = snap.players.find((p) => p.id === this.session.youId);
    if (me && me.alive && me.x !== undefined && me.y !== undefined && (snap.phase === 'aiming' || snap.phase === 'lock')) this.drawAimGuide(now, { id: me.id, x: me.x, y: me.y, slot: me.slot });

    // beams below bodies? draw above for impact clarity
    this.drawPlayers(now, dt, snap);
    this.drawBeams(now);
    this.drawFx(now, dt);
    this.drawBanner(now);
    this.drawResultFeed(now, snap);

    // warning vignette in the final seconds
    if (snap.phase === 'aiming' && !settings.reducedMotion) {
      const left = view.endsAt - now;
      if (left < CFG.timing.warnMs && left > 0) {
        const k = (1 - left / CFG.timing.warnMs) * (0.55 + 0.45 * Math.sin(now / 90));
        const v = g.createRadialGradient(500, 500, 380, 500, 500, 760);
        v.addColorStop(0, 'rgba(255,40,80,0)');
        v.addColorStop(1, `rgba(255,40,80,${0.32 * k})`);
        g.fillStyle = v;
        g.fillRect(0, 0, ARENA, ARENA);
      }
    }
    if (this.flash > 0.01) {
      g.globalAlpha = this.flash;
      g.fillStyle = this.flashColor;
      g.fillRect(0, 0, ARENA, ARENA);
      g.globalAlpha = 1;
      this.flash *= Math.exp(-dt * 7);
    }
  }

  private drawIdle(now: number): void {
    const g = this.ctx;
    g.strokeStyle = 'rgba(157,107,255,0.4)';
    g.lineWidth = 3;
    g.beginPath(); g.arc(500, 500, 60 + Math.sin(now / 400) * 6, 0, TAU); g.stroke();
  }

  private drawTimer(now: number, snap: NonNullable<GameSession['view']>['snap'], endsAt: number): void {
    if (snap.phase !== 'aiming') return;
    const g = this.ctx;
    const total = snap.phaseMs || CFG.timing.aimMs;
    const left = Math.max(0, endsAt - now);
    const frac = left / total;
    const urgent = left < CFG.timing.warnMs;
    const secs = Math.ceil(left / 1000);
    const pr = 128;
    g.lineCap = 'round';
    g.lineWidth = 10;
    g.strokeStyle = 'rgba(255,255,255,0.07)';
    g.beginPath(); g.arc(500, 500, pr, 0, TAU); g.stroke();
    g.strokeStyle = urgent ? '#ff3d6b' : '#9d6bff';
    g.lineWidth = urgent ? 12 : 9;
    g.beginPath(); g.arc(500, 500, pr, -Math.PI / 2, -Math.PI / 2 + TAU * frac); g.stroke();
    const pop = urgent ? 1 + 0.08 * Math.max(0, Math.sin((left % 1000) / 1000 * Math.PI)) : 1;
    g.save();
    g.translate(500, 500);
    g.scale(pop, pop);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = '900 96px Orbitron, system-ui, sans-serif';
    g.fillStyle = urgent ? 'rgba(255,90,120,0.95)' : 'rgba(235,225,255,0.88)';
    g.fillText(String(secs), 0, 4);
    g.restore();
  }

  private drawAimGuide(now: number, me: { id: string; x: number; y: number; slot: number }): void {
    const g = this.ctx;
    const ang = this.session.aim;
    const locked = this.session.locked;
    const col = CFG.colors[me.slot % 4];
    // Private preview: a straight line to the wall. It deliberately knows nothing about opponents.
    const tr = traceBeam(me.x, me.y, ang, [], me.id, CFG);
    const pts = tr.points;
    g.save();
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.globalCompositeOperation = 'lighter';
    g.strokeStyle = col.hex;
    g.globalAlpha = locked ? 0.28 : 0.14;
    g.lineWidth = locked ? 12 : 8;
    g.beginPath();
    g.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
    g.stroke();
    g.globalAlpha = locked ? 0.9 : 0.5;
    g.lineWidth = 2;
    if (!locked) g.setLineDash([10, 12]);
    g.lineDashOffset = -now / 40;
    g.beginPath();
    g.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
    g.stroke();
    g.setLineDash([]);
    // reticle near the player
    const rx = me.x + Math.cos(ang) * 78, ry = me.y + Math.sin(ang) * 78;
    g.globalAlpha = locked ? 1 : 0.85;
    g.strokeStyle = '#ffffff';
    g.lineWidth = 2;
    g.beginPath(); g.arc(rx, ry, 9, 0, TAU); g.stroke();
    g.beginPath();
    g.moveTo(rx + Math.cos(ang) * 13, ry + Math.sin(ang) * 13);
    g.lineTo(rx + Math.cos(ang) * 22, ry + Math.sin(ang) * 22);
    g.stroke();
    // endpoint marker (wall)
    const ex = pts[pts.length - 2], ey = pts[pts.length - 1];
    g.globalAlpha = 0.7;
    g.strokeStyle = col.glow;
    g.beginPath(); g.arc(ex, ey, 6, 0, TAU); g.stroke();
    g.restore();
  }

  private drawPlayers(now: number, dt: number, snap: NonNullable<GameSession['view']>['snap']): void {
    const g = this.ctx;
    for (const p of snap.players) {
      const s = this.ps.get(p.id);
      if (!s || s.vis <= 0.01) continue; // hidden: nothing at all is drawn
      const col = CFG.colors[p.slot % 4];
      const isMe = p.id === this.session.youId;
      let deadT = 0;
      if (s.dead) {
        deadT = (now - s.deadAt) / 650;
        if (deadT >= 1) {
          // faint wreck marker, only while the reveal is on screen
          g.globalAlpha = 0.28 * s.vis;
          g.strokeStyle = col.hex;
          g.lineWidth = 3;
          g.beginPath();
          g.moveTo(s.x - 8, s.y - 8); g.lineTo(s.x + 8, s.y + 8);
          g.moveTo(s.x + 8, s.y - 8); g.lineTo(s.x - 8, s.y + 8);
          g.stroke();
          g.globalAlpha = 1;
          continue;
        }
      }
      // weapon angle: only my own is ever known before the reveal
      const shot = snap.shots.find((sh) => sh.shooterId === p.id);
      let target = s.wa;
      let rate = 14;
      if (shot) { target = shot.angle; rate = 40; }
      else if (isMe) { target = this.session.aim; rate = 60; }
      const d = Math.atan2(Math.sin(target - s.wa), Math.cos(target - s.wa));
      s.wa += d * (1 - Math.exp(-dt * rate));

      const bob = Math.sin(now / 420 + s.seed) * 1.4;
      const fade = s.vis * (s.dead ? 1 - deadT : 1);
      const sc = s.dead ? 1 + deadT * 0.5 : 1;
      g.save();
      g.translate(s.x, s.y + bob);
      g.globalAlpha = fade;
      if (s.dead) g.scale(sc, sc);
      // glow
      const gl = g.createRadialGradient(0, 0, R * 0.4, 0, 0, R * 2.3);
      gl.addColorStop(0, hexA(col.hex, 0.32));
      gl.addColorStop(1, hexA(col.hex, 0));
      g.fillStyle = gl;
      g.beginPath(); g.arc(0, 0, R * 2.3, 0, TAU); g.fill();
      // locked ring (only ever shown for myself)
      if (isMe && this.session.locked && (snap.phase === 'aiming' || snap.phase === 'lock')) {
        g.save();
        g.rotate(now / 700);
        g.strokeStyle = col.glow;
        g.lineWidth = 2.5;
        g.setLineDash([9, 7]);
        g.beginPath(); g.arc(0, 0, R + 10, 0, TAU); g.stroke();
        g.restore();
      }
      // weapon
      g.save();
      g.rotate(s.wa);
      g.fillStyle = '#1b2440';
      g.strokeStyle = col.hex;
      g.lineWidth = 2.5;
      roundRect(g, R * 0.35, -5, R + 12, 10, 4);
      g.fill(); g.stroke();
      g.fillStyle = '#ffffff';
      g.beginPath(); g.arc(R + 11, 0, 3.2, 0, TAU); g.fill();
      // facing chevron
      g.fillStyle = col.glow;
      g.beginPath();
      g.moveTo(R + 26, 0); g.lineTo(R + 17, -6); g.lineTo(R + 17, 6); g.closePath(); g.fill();
      g.restore();
      // body
      g.fillStyle = '#0b1122';
      g.strokeStyle = col.hex;
      g.lineWidth = 4;
      g.beginPath(); g.arc(0, 0, R, 0, TAU); g.fill(); g.stroke();
      g.strokeStyle = hexA(col.hex, 0.45);
      g.lineWidth = 1.5;
      g.beginPath(); g.arc(0, 0, R * 0.64, 0, TAU); g.stroke();
      g.fillStyle = col.hex;
      g.beginPath(); g.arc(0, 0, 6.5 + Math.sin(now / 300 + s.seed) * 1.2, 0, TAU); g.fill();
      g.restore();

      // name
      if (!s.dead || deadT < 0.5) {
        g.save();
        g.globalAlpha = fade * (p.connected ? 1 : 0.5);
        g.textAlign = 'center';
        g.font = '700 22px Rajdhani, system-ui, sans-serif';
        g.fillStyle = '#e9edff';
        const ny = s.y + bob - R - 24;
        g.fillText(p.connected ? p.name : `${p.name} ⚠`, s.x, ny);
        if (isMe) {
          g.fillStyle = col.hex;
          g.beginPath();
          g.moveTo(s.x, ny + 10); g.lineTo(s.x - 6, ny + 2); g.lineTo(s.x + 6, ny + 2); g.closePath(); g.fill();
        }
        g.restore();
      }
    }
  }

  private drawBeams(now: number): void {
    const g = this.ctx;
    g.save();
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.globalCompositeOperation = 'lighter';
    for (const b of this.beams) {
      const elapsed = now - b.start;
      if (elapsed < 0) continue;
      const head = Math.min(b.total, (elapsed / 1000) * CFG.beam.speed);
      const revealMs = (b.total / CFG.beam.speed) * 1000;
      const age = elapsed - revealMs;
      const alpha = age < 220 ? 1 : Math.max(0, 1 - (age - 220) / 520);
      if (alpha <= 0.01) continue;
      const pts = b.shot.points;
      const path = () => {
        g.beginPath();
        g.moveTo(pts[0], pts[1]);
        for (let i = 1; i < b.cum.length; i++) {
          if (head >= b.cum[i]) g.lineTo(pts[i * 2], pts[i * 2 + 1]);
          else {
            const f = (head - b.cum[i - 1]) / (b.cum[i] - b.cum[i - 1] || 1);
            g.lineTo(pts[(i - 1) * 2] + (pts[i * 2] - pts[(i - 1) * 2]) * f, pts[(i - 1) * 2 + 1] + (pts[i * 2 + 1] - pts[(i - 1) * 2 + 1]) * f);
            break;
          }
        }
        g.stroke();
      };
      const thin = 1 - Math.max(0, age) / 900;
      g.globalAlpha = alpha * 0.16; g.strokeStyle = b.color; g.lineWidth = 34 * thin; path();
      g.globalAlpha = alpha * 0.35; g.strokeStyle = b.glow; g.lineWidth = 16 * thin; path();
      g.globalAlpha = alpha * 0.9; g.strokeStyle = b.color; g.lineWidth = 8 * thin; path();
      g.globalAlpha = alpha; g.strokeStyle = '#ffffff'; g.lineWidth = 3.2 * thin; path();
    }
    g.restore();
  }

  private drawFx(now: number, dt: number): void {
    const g = this.ctx;
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (let i = this.pulses.length - 1; i >= 0; i--) {
      const p = this.pulses[i];
      const k = (now - p.start) / p.dur;
      if (k >= 1) { this.pulses.splice(i, 1); continue; }
      if (k < 0) continue;
      const e = 1 - Math.pow(1 - k, 3);
      const r = p.r0 + (p.r1 - p.r0) * e;
      g.globalAlpha = (1 - k) * (p.fill ? 0.9 : 0.8);
      if (p.fill) { g.fillStyle = p.color; g.beginPath(); g.arc(p.x, p.y, r, 0, TAU); g.fill(); }
      else { g.strokeStyle = p.color; g.lineWidth = p.width * (1 - k) + 1; g.beginPath(); g.arc(p.x, p.y, r, 0, TAU); g.stroke(); }
    }
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.life += dt;
      if (p.life >= p.max) { this.parts.splice(i, 1); continue; }
      const damp = Math.exp(-p.drag * dt);
      p.vx *= damp; p.vy *= damp;
      p.x += p.vx * dt; p.y += p.vy * dt;
      const k = 1 - p.life / p.max;
      g.globalAlpha = k;
      g.fillStyle = p.color;
      const s = p.size * (0.4 + k * 0.6);
      g.fillRect(p.x - s / 2, p.y - s / 2, s, s);
    }
    g.restore();
  }

  private drawBanner(now: number): void {
    const age = now - this.bannerAt;
    if (!this.bannerText || age > 1100) return;
    const g = this.ctx;
    const k = age / 1100;
    const a = k < 0.15 ? k / 0.15 : 1 - Math.max(0, (k - 0.55) / 0.45);
    const sc = 1 + (1 - Math.min(1, k * 4)) * 0.4;
    g.save();
    g.translate(500, 205);
    g.scale(sc, sc);
    g.globalAlpha = Math.max(0, a);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = '900 54px Orbitron, system-ui, sans-serif';
    g.lineWidth = 8;
    g.strokeStyle = 'rgba(8,11,20,0.8)';
    g.strokeText(this.bannerText, 0, 0);
    g.fillStyle = this.bannerText === 'FIRE!' ? '#ff6b8a' : '#eadcff';
    g.fillText(this.bannerText, 0, 0);
    g.restore();
  }

  private drawResultFeed(now: number, snap: NonNullable<GameSession['view']>['snap']): void {
    if (snap.phase !== 'result' && !(snap.phase === 'fire' && this.beams.every((b) => b.impacted))) return;
    const g = this.ctx;
    const names = new Map(snap.players.map((p) => [p.id, p]));
    const lines = snap.eliminations.length
      ? snap.eliminations.map((e) => ({ v: names.get(e.victimId)!, k: e.killerIds.map((id) => names.get(id)!).filter(Boolean) }))
      : [];
    g.save();
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = '700 30px Rajdhani, system-ui, sans-serif';
    const baseY = 800;
    if (!lines.length) {
      g.fillStyle = 'rgba(220,225,255,0.75)';
      g.fillText('All shots missed', 500, baseY);
    }
    lines.forEach((ln, i) => {
      const y = baseY + i * 40;
      const killers = ln.k.map((k) => k.name).join(' & ');
      const text = `${killers || '?'}  ▸  ${ln.v.name}`;
      const w = g.measureText(text).width + 50;
      g.fillStyle = 'rgba(8,11,20,0.72)';
      roundRect(g, 500 - w / 2, y - 18, w, 36, 18);
      g.fill();
      g.strokeStyle = CFG.colors[ln.v.slot % 4].hex;
      g.lineWidth = 2;
      g.stroke();
      g.fillStyle = '#f2f4ff';
      g.fillText(text, 500, y + 1);
    });
    g.restore();
    void now;
  }
}

function hexA(hex: string, a: number): string {
  const [r, g, b] = hexRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
