import { io, type Socket } from 'socket.io-client';
import { C2S, S2C, type JoinAck, type LobbyState, type LockInfo, type PosUpdate } from '@shared/protocol';
import type { MatchSnapshot } from '@shared/engine';
import { GameSession } from '../game/session';

export type ConnState = 'connecting' | 'connected' | 'reconnecting' | 'offline';

const STORE = 'blindshot.session.v1';
interface Stored { code: string; token: string; playerId: string }

export const serverUrl = (): string => {
  const env = import.meta.env.VITE_SERVER_URL as string | undefined;
  if (env) return env;
  return import.meta.env.DEV ? `http://${location.hostname}:3001` : location.origin;
};

export function loadStored(): Stored | null {
  try {
    const raw = sessionStorage.getItem(STORE);
    return raw ? (JSON.parse(raw) as Stored) : null;
  } catch {
    return null;
  }
}
function saveStored(s: Stored | null): void {
  try {
    if (s) sessionStorage.setItem(STORE, JSON.stringify(s));
    else sessionStorage.removeItem(STORE);
  } catch {
    /* ignore */
  }
}

export class OnlineSession extends GameSession {
  readonly kind = 'online' as const;
  youId = '';
  lobby: LobbyState | null = null;
  conn: ConnState = 'connecting';
  private socket: Socket;
  private stored: Stored | null = null;
  private lastSent = NaN;
  private lastSentAt = 0;
  private pending: ReturnType<typeof setTimeout> | null = null;
  private hasConnected = false;
  private destroyed = false;

  constructor() {
    super();
    this.socket = io(serverUrl(), {
      transports: ['websocket', 'polling'],
      reconnectionDelayMax: 3000,
      timeout: 8000,
    });
    const s = this.socket;
    s.on('connect', () => {
      this.hasConnected = true;
      this.setConn('connected');
      if (this.stored) this.rejoin();
    });
    s.on('disconnect', () => this.setConn(this.destroyed ? 'offline' : 'reconnecting'));
    s.io.on('reconnect_attempt', () => this.setConn('reconnecting'));
    s.on('connect_error', () => this.setConn(this.hasConnected ? 'reconnecting' : 'offline'));
    s.on(S2C.lobby, (l: LobbyState) => {
      this.lobby = l;
      this.emit({ type: 'lobby' });
    });
    s.on(S2C.match, (m: { snapshot: MatchSnapshot }) => this.applySnapshot(m.snapshot));
    s.on(S2C.pos, (m: PosUpdate) => this.setOwnPosition(m.round, m.x, m.y));
    s.on(S2C.lockInfo, (info: LockInfo) => {
      const snap = this.view?.snap;
      const p = snap?.players.find((x) => x.id === info.id);
      if (p) p.locked = info.locked;
      if (info.id === this.youId) this.locked = info.locked;
      this.emit({ type: 'lock', id: info.id, locked: info.locked });
    });
  }

  private setConn(c: ConnState): void {
    if (this.conn === c) return;
    this.conn = c;
    this.emit({ type: 'conn' });
  }

  private adopt(res: JoinAck): void {
    this.youId = res.playerId!;
    this.stored = { code: res.code!, token: res.token!, playerId: res.playerId! };
    saveStored(this.stored);
  }

  /** Promise helper with a timeout so UI never hangs. */
  private request(event: string, payload?: unknown): Promise<JoinAck> {
    return new Promise((resolve) => {
      const t = setTimeout(() => resolve({ ok: false, error: 'Server did not respond.' }), 8000);
      this.socket.emit(event, payload, (res: JoinAck) => {
        clearTimeout(t);
        resolve(res ?? { ok: false, error: 'No response.' });
      });
    });
  }

  private async whenConnected(): Promise<boolean> {
    if (this.socket.connected) return true;
    return new Promise((resolve) => {
      const t = setTimeout(() => {
        this.socket.off('connect', ok);
        resolve(false);
      }, 8000);
      const ok = () => {
        clearTimeout(t);
        resolve(true);
      };
      this.socket.once('connect', ok);
    });
  }

  async create(name: string): Promise<JoinAck> {
    if (!(await this.whenConnected())) return { ok: false, error: 'Cannot reach the game server.' };
    const res = await this.request(C2S.create, { name });
    if (res.ok) this.adopt(res);
    return res;
  }

  async join(code: string, name: string): Promise<JoinAck> {
    if (!(await this.whenConnected())) return { ok: false, error: 'Cannot reach the game server.' };
    const res = await this.request(C2S.join, { code, name });
    if (res.ok) this.adopt(res);
    return res;
  }

  /** Resume a previous session (page reload or network drop). */
  async resume(stored: Stored): Promise<boolean> {
    this.stored = stored;
    this.youId = stored.playerId;
    if (!(await this.whenConnected())) return false;
    return this.rejoin();
  }

  private async rejoin(): Promise<boolean> {
    if (!this.stored) return false;
    const res = await this.request(C2S.rejoin, { code: this.stored.code, token: this.stored.token });
    if (!res.ok) {
      this.stored = null;
      saveStored(null);
      this.lobby = null;
      this.emit({ type: 'lobby' });
      return false;
    }
    this.adopt(res);
    return true;
  }

  get code(): string {
    return this.stored?.code ?? this.lobby?.code ?? '';
  }

  setReady(ready: boolean): void {
    this.socket.emit(C2S.ready, { ready });
  }
  start(): Promise<JoinAck> {
    return this.request(C2S.start);
  }
  rematch(vote: boolean): void {
    this.socket.emit(C2S.rematch, { vote });
  }
  backToLobby(): void {
    this.view = null;
    this.socket.emit(C2S.toLobby);
  }

  /** Aim updates are throttled to ~30 Hz, with a trailing send so the final angle always arrives. */
  setAim(angle: number): void {
    if (this.locked) return;
    this.aim = angle;
    const send = () => {
      this.pending = null;
      if (this.aim === this.lastSent) return;
      this.lastSent = this.aim;
      this.lastSentAt = performance.now();
      this.socket.volatile.emit(C2S.aim, { a: Math.round(this.aim * 10000) / 10000 });
    };
    const since = performance.now() - this.lastSentAt;
    if (since >= 33) send();
    else if (!this.pending) this.pending = setTimeout(send, 33 - since);
  }

  private moveSent = { x: 0, y: 0, at: 0 };

  setMove(dx: number, dy: number): void {
    if (this.view?.snap.phase !== 'aiming') return;
    const x = Math.round(dx * 100) / 100;
    const y = Math.round(dy * 100) / 100;
    const now = performance.now();
    const stop = x === 0 && y === 0;
    const same = x === this.moveSent.x && y === this.moveSent.y;
    // never drop a "stop"; otherwise throttle (callers refresh the latest intent ~10x/s anyway)
    if (!stop && ((same && now - this.moveSent.at < 100) || now - this.moveSent.at < 40)) return;
    if (stop && same && now - this.moveSent.at < 100) return;
    this.moveSent = { x, y, at: now };
    this.socket.emit(C2S.move, { x, y });
  }

  setLocked(locked: boolean): void {
    if (this.view?.snap.phase !== 'aiming' || this.locked === locked) return;
    if (locked) {
      // make sure the server holds the exact angle before it is locked
      if (this.pending) clearTimeout(this.pending);
      this.pending = null;
      this.lastSent = this.aim;
      this.socket.emit(C2S.aim, { a: Math.round(this.aim * 10000) / 10000 });
    }
    this.locked = locked;
    this.socket.emit(C2S.lock, { locked });
    this.emit({ type: 'lock', id: this.youId, locked });
  }

  leave(): void {
    this.socket.emit(C2S.leave);
    saveStored(null);
    this.stored = null;
  }

  destroy(): void {
    this.destroyed = true;
    if (this.pending) clearTimeout(this.pending);
    this.pending = null;
    this.socket.removeAllListeners();
    this.socket.io.removeAllListeners();
    this.socket.disconnect();
  }
}
