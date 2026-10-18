import { DEFAULT_CONFIG, type BotLevel } from '@shared/config';
import { MatchEngine, type PlayerInit } from '@shared/engine';
import { GameSession } from './session';

const BOT_NAMES = ['Nova', 'Echo', 'Vex', 'Zeta', 'Pulse', 'Rook'];

/** Offline practice match: the same authoritative engine as the server, running in the browser. */
export class LocalSession extends GameSession {
  readonly kind = 'local' as const;
  youId = 'you';
  private engine: MatchEngine;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lockSig = '';
  readonly level: BotLevel;
  readonly bots: number;
  readonly playerName: string;

  constructor(playerName: string, bots: number, level: BotLevel) {
    super();
    this.level = level;
    this.bots = bots;
    this.playerName = playerName;
    const names = [...BOT_NAMES].sort(() => Math.random() - 0.5);
    const inits: PlayerInit[] = [{ id: 'you', name: playerName || 'You', slot: 0 }];
    for (let i = 0; i < bots; i++) inits.push({ id: `bot${i}`, name: names[i], slot: i + 1, botLevel: level });
    this.engine = new MatchEngine(inits, Math.random, DEFAULT_CONFIG, () => this.push());
    this.engine.start(performance.now());
    this.timer = setInterval(() => this.step(), 25);
  }

  private push(): void {
    this.applySnapshot(this.engine.snapshot(performance.now(), this.youId));
  }

  private step(): void {
    this.engine.tick(performance.now());
    if (this.engine.phase === 'aiming') {
      const sig = this.engine.snapshot(0).players.map((p) => (p.locked ? 1 : 0)).join('');
      if (sig !== this.lockSig) {
        const old = this.lockSig;
        this.lockSig = sig;
        const players = this.engine.snapshot(0).players;
        players.forEach((p, i) => {
          if (p.id !== this.youId && old[i] !== sig[i] && old) this.emit({ type: 'lock', id: p.id, locked: p.locked });
        });
        if (this.view) {
          this.view.snap.players = this.engine.snapshot(0).players;
          this.emit({ type: 'snapshot' });
        }
      }
    } else this.lockSig = '';
  }

  setAim(angle: number): void {
    if (this.locked) return;
    this.aim = angle;
    this.engine.setAim(this.youId, angle);
  }

  setLocked(locked: boolean): void {
    if (this.view?.snap.phase !== 'aiming') return;
    if (this.engine.setLocked(this.youId, locked)) {
      this.locked = locked;
      this.emit({ type: 'lock', id: this.youId, locked });
      if (this.view) {
        const me = this.view.snap.players.find((p) => p.id === this.youId);
        if (me) me.locked = locked;
      }
    }
  }

  destroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
