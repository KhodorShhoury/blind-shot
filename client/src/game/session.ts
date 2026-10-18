import type { MatchSnapshot, Phase } from '@shared/engine';

export interface MatchView {
  snap: MatchSnapshot;
  /** performance.now() timestamp at which the current phase ends. */
  endsAt: number;
  recvAt: number;
}

export type SessionEvent =
  | { type: 'snapshot' }
  | { type: 'phase'; phase: Phase; round: number }
  | { type: 'lock'; id: string; locked: boolean }
  | { type: 'lobby' }
  | { type: 'conn' };

export type Listener = (e: SessionEvent) => void;

/** State + event plumbing shared by local (practice) and online sessions. */
export abstract class GameSession {
  abstract readonly kind: 'local' | 'online';
  abstract youId: string;
  view: MatchView | null = null;
  /** Own, private aim (updated instantly from input; the server only receives throttled copies). */
  aim = 0;
  locked = false;
  version = 0;
  private listeners = new Set<Listener>();

  on(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  protected emit(e: SessionEvent): void {
    this.version++;
    for (const l of [...this.listeners]) l(e);
  }

  protected applySnapshot(snap: MatchSnapshot): void {
    const prev = this.view?.snap;
    const now = performance.now();
    this.view = { snap, endsAt: now + snap.remainingMs, recvAt: now };
    const changed = !prev || prev.phase !== snap.phase || prev.round !== snap.round;
    if (snap.you && changed) {
      if (snap.phase === 'aiming' || !prev) this.aim = snap.you.aim;
      this.locked = snap.you.locked;
    }
    this.emit({ type: 'snapshot' });
    if (changed) this.emit({ type: 'phase', phase: snap.phase, round: snap.round });
  }

  get me() {
    return this.view?.snap.players.find((p) => p.id === this.youId);
  }

  abstract setAim(angle: number): void;
  abstract setLocked(locked: boolean): void;
  toggleLock(): void {
    this.setLocked(!this.locked);
  }
  abstract destroy(): void;
}
