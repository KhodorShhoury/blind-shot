import { DEFAULT_CONFIG, type BotLevel, type GameConfig, type Rng } from './config';
import { distToPolyline, formation, pillarRadius, traceBeam, normAngle } from './geometry';
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
  end: 'player' | 'pillar' | 'range';
}

export interface Elimination {
  victimId: string;
  killerIds: string[];
}

export interface PublicPlayer {
  id: string;
  name: string;
  slot: number;
  x: number;
  y: number;
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

/** Everything a client is allowed to know. Other players' aim angles are NEVER part of this. */
export interface MatchSnapshot {
  phase: Phase;
  round: number;
  remainingMs: number;
  phaseMs: number;
  pillarR: number;
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
  locked: boolean;
  kills: number;
  eliminatedRound: number | null;
  plan: BotPlan | null;
  switched: boolean;
  threat: Record<string, number>;
}

export class MatchEngine {
  readonly cfg: GameConfig;
  phase: Phase = 'aiming';
  round = 0;
  private players: PState[];
  private phaseStart = 0;
  private phaseEnd = 0;
  private roundStart = 0;
  private allLockedSince: number | null = null;
  private shots: Shot[] = [];
  private eliminations: Elimination[] = [];
  private pillarR = 0;
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
      locked: false,
      kills: 0,
      eliminatedRound: null,
      plan: null,
      switched: false,
      threat: {},
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

  setConnected(id: string, connected: boolean, now: number): void {
    const p = this.find(id);
    if (!p || p.botLevel) return;
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
    const spots = formation(alive.length, this.cfg, this.rng);
    this.pillarR = pillarRadius(this.round, this.cfg);
    const cx = this.cfg.arena.w / 2;
    const cy = this.cfg.arena.h / 2;
    alive.forEach((p, i) => {
      p.x = spots[i].x;
      p.y = spots[i].y;
      p.aim = Math.atan2(cy - p.y, cx - p.x);
      p.locked = !p.connected;
      p.switched = false;
      p.plan = null;
    });
    const targets = alive.map((p) => ({ id: p.id, x: p.x, y: p.y }));
    for (const p of alive) {
      if (!p.botLevel) continue;
      p.plan = planBot({ id: p.id, x: p.x, y: p.y }, targets, this.pillarR, p.botLevel, p.threat, this.cfg, this.rng, this.cfg.timing.aimMs);
    }
    this.shots = [];
    this.eliminations = [];
    this.allLockedSince = null;
    this.roundStart = now;
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
          const humansAll = this.alivePlayers.every((p) => p.locked);
          if (humansAll) this.allLockedSince ??= now;
          else this.allLockedSince = null;
          const early = this.allLockedSince !== null && now - this.allLockedSince >= this.cfg.timing.allLockedGraceMs;
          if (now >= this.phaseEnd || early) {
            const t = Math.min(now, this.phaseEnd);
            for (const p of this.players) if (p.alive) p.locked = true;
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
      const r = traceBeam(p.x, p.y, p.aim, targets, p.id, this.pillarR, this.cfg);
      if (r.hitId) {
        const list = kills.get(r.hitId) ?? [];
        list.push(p.id);
        kills.set(r.hitId, list);
      }
      return { shooterId: p.id, angle: Math.round(p.aim * 1000) / 1000, points: r.points, hitId: r.hitId, end: r.end };
    });
    // bots remember who came close to them
    for (const b of shooters) {
      if (!b.botLevel) continue;
      for (const s of this.shots) {
        if (s.shooterId === b.id) continue;
        if (distToPolyline(s.points, b.x, b.y) < 90) b.threat[s.shooterId] = (b.threat[s.shooterId] ?? 0) + 1;
      }
    }
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

  snapshot(now: number, forId?: string): MatchSnapshot {
    const me = forId ? this.find(forId) : undefined;
    const revealed = this.phase === 'fire' || this.phase === 'result' || this.phase === 'over';
    return {
      phase: this.phase,
      round: this.round,
      remainingMs: Math.max(0, Math.round(this.phaseEnd - now)),
      phaseMs: Math.round(this.phaseEnd - this.phaseStart),
      pillarR: this.pillarR,
      players: this.players.map((p) => ({
        id: p.id,
        name: p.name,
        slot: p.slot,
        x: p.x,
        y: p.y,
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
