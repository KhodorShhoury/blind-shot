import { DEFAULT_CONFIG, type BotLevel, type GameConfig, type Rng } from './config';
import { traceBeam, normAngle } from './geometry';
import { planBot, type BotPlan } from './bots';

export type Phase = 'aiming' | 'lock' | 'fire' | 'result' | 'over';

export interface PlayerInit {
  id: string;
  name: string;
  /** Colour slot 0..3 */
  slot: number;
  botLevel?: BotLevel;
}

export interface Shot {
  shooterId: string;
  angle: number;
  points: number[];
  hitId: string | null;
  end: 'player' | 'range';
}

export interface Elimination {
  victimId: string;
  killerIds: string[];
}

export interface PublicPlayer {
  id: string;
  name: string;
  slot: number;
  /**
   * Arena position. Hidden information: during the aiming/lock phases the server only fills this in
   * for the receiving player's OWN entry. Everyone's position is revealed only once the volley fires.
   */
  x?: number;
  y?: number;
  alive: boolean;
  locked: boolean;
  connected: boolean;
  isBot: boolean;
  kills: number;
}

export interface Standing {
  id: string;
  place: number;
  kills: number;
  eliminatedRound: number | null;
}

/** Everything a client is allowed to know. Other players' aim angles and (before the reveal) positions are NEVER part of this. */
export interface MatchSnapshot {
  phase: Phase;
  round: number;
  remainingMs: number;
  phaseMs: number;
  players: PublicPlayer[];
  you?: { aim: number; locked: boolean };
  shots: Shot[];
  eliminations: Elimination[];
  winnerId: string | null;
  draw: boolean;
  standings: Standing[];
}

export type EngineEvent = 'round' | 'lock' | 'fire' | 'result' | 'over';

interface PState {
  id: string;
  name: string;
  slot: number;
  botLevel: BotLevel | null;
  connected: boolean;
  disconnectedAt: number | null;
  alive: boolean;
  x: number;
  y: number;
  aim: number;
  /** Walking intent (unit vector or smaller) and when it was last refreshed. */
  mx: number;
  my: number;
  mvAt: number;
  locked: boolean;
  kills: number;
  eliminatedRound: number | null;
  plan: BotPlan | null;
  switched: boolean;
}

export class MatchEngine {
  readonly cfg: GameConfig;
  phase: Phase = 'aiming';
  round = 0;
  private players: PState[];
  private phaseStart = 0;
  private phaseEnd = 0;
  private roundStart = 0;
  private lastMoveT = 0;
  /** Players who were positioned at the start of the current round (i.e. who take part in its volley). */
  private roundRoster = new Set<string>();
  private allLockedSince: number | null = null;
  private shots: Shot[] = [];
  private eliminations: Elimination[] = [];
  private winnerId: string | null = null;
  private draw = false;
  private started = false;

  constructor(
    inits: PlayerInit[],
    private readonly rng: Rng = Math.random,
    cfg: GameConfig = DEFAULT_CONFIG,
    private readonly onEvent: (e: EngineEvent) => void = () => {},
  ) {
    this.cfg = cfg;
    this.players = inits.map((p) => ({
      id: p.id,
      name: p.name,
      slot: p.slot,
      botLevel: p.botLevel ?? null,
      connected: true,
      disconnectedAt: null,
      alive: true,
      x: cfg.arena.w / 2,
      y: cfg.arena.h / 2,
      aim: 0,
      mx: 0,
      my: 0,
      mvAt: 0,
      locked: false,
      kills: 0,
      eliminatedRound: null,
      plan: null,
      switched: false,
    }));
  }

  start(now: number): void {
    if (this.started) return;
    this.started = true;
    this.startRound(now);
  }

  get alivePlayers(): PState[] {
    return this.players.filter((p) => p.alive);
  }

  private find(id: string): PState | undefined {
    return this.players.find((p) => p.id === id);
  }

  setAim(id: string, angle: number): void {
    const p = this.find(id);
    if (!p || this.phase !== 'aiming' || !p.alive || p.locked || p.botLevel) return;
    if (!Number.isFinite(angle)) return;
    p.aim = normAngle(angle);
  }

  /** Returns true if the lock state actually changed. */
  setLocked(id: string, locked: boolean): boolean {
    const p = this.find(id);
    if (!p || this.phase !== 'aiming' || !p.alive || p.botLevel || !p.connected) return false;
    if (p.locked === locked) return false;
    p.locked = locked;
    return true;
  }

  /**
   * Walking intent for a human player (unit vector or smaller). Only possible while aiming. The intent
   * expires unless it is refreshed, so a lost "stop" message can never leave someone running forever.
   */
  setMove(id: string, dx: number, dy: number, now: number): void {
    const p = this.find(id);
    if (!p || this.phase !== 'aiming' || !p.alive || p.botLevel || !p.connected) return;
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
    const len = Math.hypot(dx, dy);
    const k = len > 1 ? 1 / len : 1;
    p.mx = dx * k;
    p.my = dy * k;
    p.mvAt = now;
  }

  /** A player's own position (null if they are not part of the current round). */
  ownPosition(id: string): { x: number; y: number } | null {
    const p = this.find(id);
    return p && p.alive ? { x: p.x, y: p.y } : null;
  }

  setConnected(id: string, connected: boolean, now: number): void {
    const p = this.find(id);
    if (!p || p.botLevel) return;
    if (!connected) {
      p.mx = 0;
      p.my = 0;
    }
    p.connected = connected;
    p.disconnectedAt = connected ? null : now;
    // a disconnected player's current aim is auto-committed
    if (!connected && p.alive && this.phase === 'aiming') p.locked = true;
  }

  private startRound(now: number): void {
    this.round++;
    for (const p of this.players) {
      if (p.alive && !p.connected && p.disconnectedAt !== null && now - p.disconnectedAt >= this.cfg.room.disconnectGraceMs) {
        p.alive = false;
        p.eliminatedRound = this.round - 1 || 1;
      }
    }
    const alive = this.alivePlayers;
    if (alive.length <= 1) {
      this.finish(now);
      return;
    }
    // Players choose their own position by walking. Only the very first round needs a starting spot:
    // one corner each. After that everybody simply starts where they last stood.
    if (this.round === 1) {
      const { w, h, startInset: s } = this.cfg.arena;
      const corners = [
        { x: s, y: s },
        { x: w - s, y: h - s },
        { x: w - s, y: s },
        { x: s, y: h - s },
      ];
      alive.forEach((p, i) => {
        p.x = corners[i % corners.length].x;
        p.y = corners[i % corners.length].y;
      });
    }
    alive.forEach((p) => {
      // neutral starting angle: gives no hint about where anybody is
      p.aim = this.rng() * Math.PI * 2 - Math.PI;
      p.mx = 0;
      p.my = 0;
      p.locked = !p.connected;
      p.switched = false;
      p.plan = null;
    });
    for (const p of alive) {
      if (!p.botLevel) continue;
      p.plan = planBot({ x: p.x, y: p.y }, p.botLevel, this.cfg, this.rng, this.cfg.timing.aimMs);
    }
    this.roundRoster = new Set(alive.map((p) => p.id));
    this.shots = [];
    this.eliminations = [];
    this.allLockedSince = null;
    this.roundStart = now;
    this.lastMoveT = now;
    this.setPhase('aiming', now, this.cfg.timing.aimMs);
    this.onEvent('round');
  }

  private setPhase(phase: Phase, now: number, duration: number): void {
    this.phase = phase;
    this.phaseStart = now;
    this.phaseEnd = now + duration;
  }

  private finish(now: number): void {
    const alive = this.alivePlayers;
    this.winnerId = alive.length === 1 ? alive[0].id : null;
    this.draw = alive.length === 0;
    this.setPhase('over', now, 0);
    this.onEvent('over');
  }

  /** Advance the state machine. Safe to call at any frequency. */
  tick(now: number): void {
    if (!this.started) return;
    for (let guard = 0; guard < 4; guard++) {
      switch (this.phase) {
        case 'aiming': {
          this.runBots(now);
          this.integrate(now);
          const humansAll = this.alivePlayers.every((p) => p.locked);
          if (humansAll) this.allLockedSince ??= now;
          else this.allLockedSince = null;
          const early = this.allLockedSince !== null && now - this.allLockedSince >= this.cfg.timing.allLockedGraceMs;
          if (now >= this.phaseEnd || early) {
            const t = Math.min(now, this.phaseEnd);
            for (const p of this.players) if (p.alive) { p.locked = true; p.mx = 0; p.my = 0; }
            this.setPhase('lock', early ? now : t, this.cfg.timing.lockMs);
            this.onEvent('lock');
            continue;
          }
          return;
        }
        case 'lock':
          if (now >= this.phaseEnd) {
            this.fire(this.phaseEnd);
            continue;
          }
          return;
        case 'fire':
          if (now >= this.phaseEnd) {
            this.setPhase('result', this.phaseEnd, this.cfg.timing.resultMs);
            this.onEvent('result');
            continue;
          }
          return;
        case 'result':
          if (now >= this.phaseEnd) {
            const next = this.phaseEnd;
            if (this.alivePlayers.length <= 1) this.finish(next);
            else this.startRound(next);
            continue;
          }
          return;
        default:
          return;
      }
    }
  }

  /** Moves walking players (humans by intent, bots towards their destination), inside the arena. */
  private integrate(now: number): void {
    const t = Math.min(now, this.phaseEnd);
    const dt = Math.min(0.1, Math.max(0, (t - this.lastMoveT) / 1000));
    this.lastMoveT = Math.max(this.lastMoveT, t);
    if (dt <= 0) return;
    const { w, h, wallMargin: m, moveSpeed } = this.cfg.arena;
    const elapsed = t - this.roundStart;
    for (const p of this.players) {
      if (!p.alive) continue;
      let dx = 0;
      let dy = 0;
      if (p.plan) {
        if (elapsed < p.plan.moveAt) continue;
        const vx = p.plan.dest.x - p.x;
        const vy = p.plan.dest.y - p.y;
        const d = Math.hypot(vx, vy);
        if (d < 0.5) continue;
        const step = Math.min(moveSpeed * dt, d);
        dx = (vx / d) * step;
        dy = (vy / d) * step;
      } else if (p.mx !== 0 || p.my !== 0) {
        if (t - p.mvAt > 600) {
          p.mx = 0;
          p.my = 0;
          continue;
        }
        dx = p.mx * moveSpeed * dt;
        dy = p.my * moveSpeed * dt;
      } else continue;
      p.x = Math.min(w - m, Math.max(m, p.x + dx));
      p.y = Math.min(h - m, Math.max(m, p.y + dy));
    }
  }

  private runBots(now: number): void {
    const elapsed = now - this.roundStart;
    for (const p of this.players) {
      if (!p.alive || !p.plan) continue;
      if (!p.switched && p.plan.aim2 !== null && elapsed >= p.plan.switchAt) {
        p.aim = normAngle(p.plan.aim2);
        p.switched = true;
      } else if (!p.switched && !p.locked) p.aim = normAngle(p.plan.aim1);
      if (!p.locked && elapsed >= p.plan.lockAt) p.locked = true;
    }
  }

  /** Resolves every committed shot against the alive-at-start roster simultaneously. */
  private fire(now: number): void {
    const shooters = this.alivePlayers;
    const targets = shooters.map((p) => ({ id: p.id, x: p.x, y: p.y }));
    const kills = new Map<string, string[]>();
    this.shots = shooters.map((p) => {
      const r = traceBeam(p.x, p.y, p.aim, targets, p.id, this.cfg);
      if (r.hitId) {
        const list = kills.get(r.hitId) ?? [];
        list.push(p.id);
        kills.set(r.hitId, list);
      }
      return { shooterId: p.id, angle: Math.round(p.aim * 1000) / 1000, points: r.points, hitId: r.hitId, end: r.end };
    });
    this.eliminations = [];
    for (const [victimId, killerIds] of kills) {
      const v = this.find(victimId)!;
      v.alive = false;
      v.eliminatedRound = this.round;
      for (const k of killerIds) this.find(k)!.kills++;
      this.eliminations.push({ victimId, killerIds });
    }
    this.setPhase('fire', now, this.cfg.timing.fireMs);
    this.onEvent('fire');
  }

  /**
   * Server/test-only: the secret positions of everyone who took part in the current round. Never put this in a payload.
   */
  secretPositions(): { id: string; x: number; y: number }[] {
    return this.players.filter((p) => this.roundRoster.has(p.id)).map((p) => ({ id: p.id, x: p.x, y: p.y }));
  }

  snapshot(now: number, forId?: string): MatchSnapshot {
    const me = forId ? this.find(forId) : undefined;
    const revealed = this.phase === 'fire' || this.phase === 'result' || this.phase === 'over';
    // Before the reveal a player may only learn their own position (and only while they are alive).
    // At the reveal, exactly the players who took part in the volley become visible.
    const shown = new Set<string>(revealed ? this.shots.map((sh) => sh.shooterId) : []);
    if (!revealed && me && me.alive) shown.add(me.id);
    return {
      phase: this.phase,
      round: this.round,
      remainingMs: Math.max(0, Math.round(this.phaseEnd - now)),
      phaseMs: Math.round(this.phaseEnd - this.phaseStart),
      players: this.players.map((p) => ({
        id: p.id,
        name: p.name,
        slot: p.slot,
        ...(shown.has(p.id) ? { x: p.x, y: p.y } : {}),
        alive: p.alive,
        locked: p.locked,
        connected: p.connected,
        isBot: !!p.botLevel,
        kills: p.kills,
      })),
      you: me ? { aim: Math.round(me.aim * 1000) / 1000, locked: me.locked } : undefined,
      shots: revealed ? this.shots : [],
      eliminations: revealed ? this.eliminations : [],
      winnerId: this.phase === 'over' ? this.winnerId : null,
      draw: this.phase === 'over' && this.draw,
      standings: this.phase === 'over' ? this.standings() : [],
    };
  }

  private standings(): Standing[] {
    const list = this.players.map((p) => ({ id: p.id, kills: p.kills, eliminatedRound: p.eliminatedRound, alive: p.alive }));
    list.sort((a, b) => {
      if (a.alive !== b.alive) return a.alive ? -1 : 1;
      const ea = a.eliminatedRound ?? Infinity;
      const eb = b.eliminatedRound ?? Infinity;
      if (ea !== eb) return eb - ea;
      return b.kills - a.kills;
    });
    let place = 0;
    let prev: (typeof list)[number] | null = null;
    return list.map((p, i) => {
      if (!prev || prev.alive !== p.alive || prev.eliminatedRound !== p.eliminatedRound) place = i + 1;
      prev = p;
      return { id: p.id, place, kills: p.kills, eliminatedRound: p.eliminatedRound };
    });
  }
}
