import type { GameConfig } from './config';
import type { MatchSnapshot } from './engine';

export const C2S = {
  create: 'room:create',
  join: 'room:join',
  rejoin: 'room:rejoin',
  leave: 'room:leave',
  ready: 'room:ready',
  start: 'room:start',
  toLobby: 'room:lobby',
  rematch: 'room:rematch',
  aim: 'match:aim',
  move: 'match:move',
  lock: 'match:lock',
} as const;

export const S2C = {
  lobby: 'lobby:state',
  match: 'match:state',
  lockInfo: 'match:lockinfo',
  pos: 'match:pos',
  error: 'room:error',
} as const;

export interface LobbyPlayer {
  id: string;
  name: string;
  slot: number;
  ready: boolean;
  connected: boolean;
  isHost: boolean;
  rematch: boolean;
}

export interface LobbyState {
  code: string;
  status: 'lobby' | 'playing' | 'over';
  hostId: string;
  players: LobbyPlayer[];
  minPlayers: number;
  maxPlayers: number;
}

export interface JoinAck {
  ok: boolean;
  error?: string;
  playerId?: string;
  token?: string;
  code?: string;
}

export type Ack<T = object> = (res: ({ ok: true } & T) | { ok: false; error: string }) => void;

export interface MatchMessage {
  snapshot: MatchSnapshot;
}

/** Private, frequent update of the receiving player's OWN position while aiming. */
export interface PosUpdate {
  round: number;
  x: number;
  y: number;
}

export interface LockInfo {
  id: string;
  locked: boolean;
}

/* ---------- validation (pure, shared by server + tests) ---------- */

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function randomRoomCode(len: number, rng: () => number = Math.random): string {
  let s = '';
  for (let i = 0; i < len; i++) s += CODE_ALPHABET[Math.floor(rng() * CODE_ALPHABET.length)];
  return s;
}

export function sanitizeName(raw: unknown, cfg: Pick<GameConfig, 'room'>, fallback = 'Player'): string {
  if (typeof raw !== 'string') return fallback;
  // strip control chars & angle brackets, collapse whitespace
  const cleaned = raw.replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, cfg.room.nameMax);
  return cleaned || fallback;
}

export function normalizeRoomCode(raw: unknown, cfg: Pick<GameConfig, 'room'>): string | null {
  if (typeof raw !== 'string') return null;
  const code = raw.trim().toUpperCase();
  if (code.length !== cfg.room.codeLength) return null;
  for (const ch of code) if (!CODE_ALPHABET.includes(ch)) return null;
  return code;
}

export function parseAngle(raw: unknown): number | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || Math.abs(raw) > 1000) return null;
  return raw;
}

/** Movement intent: a vector with magnitude <= 1 (anything bigger is normalised). */
export function parseMove(raw: unknown): { x: number; y: number } | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { x, y } = raw as { x?: unknown; y?: unknown };
  if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  if (Math.abs(x) > 100 || Math.abs(y) > 100) return null;
  const len = Math.hypot(x, y);
  return len > 1 ? { x: x / len, y: y / len } : { x, y };
}

export function parseBool(raw: unknown): boolean | null {
  return typeof raw === 'boolean' ? raw : null;
}

export function isToken(raw: unknown): raw is string {
  return typeof raw === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(raw);
}

/** Token-bucket rate limiter. */
export class RateLimiter {
  private tokens: number;
  private last: number;
  constructor(private capacity: number, private perSecond: number, now = Date.now()) {
    this.tokens = capacity;
    this.last = now;
  }
  take(cost = 1, now = Date.now()): boolean {
    this.tokens = Math.min(this.capacity, this.tokens + ((now - this.last) / 1000) * this.perSecond);
    this.last = now;
    if (this.tokens < cost) return false;
    this.tokens -= cost;
    return true;
  }
}
