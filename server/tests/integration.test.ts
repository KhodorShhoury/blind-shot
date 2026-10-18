import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { io as connect, type Socket } from 'socket.io-client';
import { buildConfig } from '@shared/config';
import type { MatchSnapshot } from '@shared/engine';
import type { LobbyState } from '@shared/protocol';
import { createGameServer, type GameServer } from '../src/server';

const cfg = buildConfig({
  arena: { pillarBase: 0 },
  beam: { maxBounces: 0 },
  timing: { aimMs: 400, lockMs: 100, fireMs: 150, resultMs: 150, allLockedGraceMs: 50 },
  room: { lobbyGraceMs: 300, emptyRoomTtlMs: 300, disconnectGraceMs: 600 },
});

let srv: GameServer;
let clients: Client[] = [];

class Client {
  s: Socket;
  lobby: LobbyState | null = null;
  snaps: MatchSnapshot[] = [];
  playerId = '';
  token = '';
  code = '';
  constructor(url: string) {
    this.s = connect(url, { transports: ['websocket'], reconnection: false });
    this.s.on('lobby:state', (l: LobbyState) => (this.lobby = l));
    this.s.on('match:state', (m: { snapshot: MatchSnapshot }) => this.snaps.push(m.snapshot));
    clients.push(this);
  }
  get last() { return this.snaps[this.snaps.length - 1]; }
  ready() { return new Promise<void>((r) => (this.s.connected ? r() : this.s.on('connect', () => r()))); }
  emit<T = any>(ev: string, payload?: unknown): Promise<T> {
    return new Promise((r) => this.s.emit(ev, payload, r));
  }
  async create(name: string) {
    await this.ready();
    const res = await this.emit('room:create', { name });
    this.playerId = res.playerId; this.token = res.token; this.code = res.code;
    return res;
  }
  async join(code: string, name: string) {
    await this.ready();
    const res = await this.emit('room:join', { code, name });
    if (res.ok) { this.playerId = res.playerId; this.token = res.token; this.code = res.code; }
    return res;
  }
}

const until = async (fn: () => boolean, ms = 4000) => {
  const t = Date.now();
  while (!fn()) {
    if (Date.now() - t > ms) throw new Error('timeout waiting for condition');
    await new Promise((r) => setTimeout(r, 10));
  }
};
const url = () => `http://localhost:${srv.port}`;

async function twoPlayerRoom() {
  const a = new Client(url());
  const b = new Client(url());
  await a.create('Alice');
  await b.join(a.code, 'Bob');
  b.s.emit('room:ready', { ready: true });
  await until(() => !!a.lobby?.players.find((p) => p.name === 'Bob')?.ready);
  return { a, b };
}

beforeEach(async () => { srv = await createGameServer({ config: cfg }); });
afterEach(async () => {
  clients.forEach((c) => c.s.close());
  clients = [];
  await srv.close();
});

describe('rooms', () => {
  it('creates, joins, validates codes, and enforces capacity', async () => {
    const a = new Client(url());
    const res = await a.create('Alice');
    expect(res.code).toMatch(/^[A-Z2-9]{5}$/);
    const bad = new Client(url());
    await bad.ready();
    expect((await bad.emit('room:join', { code: 'ZZZZZ', name: 'x' })).ok).toBe(false);
    expect((await bad.emit('room:join', { code: 12, name: 'x' })).ok).toBe(false);
    for (const n of ['B', 'C', 'D']) expect((await new Client(url()).join(a.code, n)).ok).toBe(true);
    const e = await new Client(url()).join(a.code, 'E');
    expect(e.ok).toBe(false);
    await until(() => a.lobby?.players.length === 4);
    expect(a.lobby!.players.map((p) => p.slot).sort()).toEqual([0, 1, 2, 3]);
  });

  it('only the host can start, and everyone must be ready', async () => {
    const a = new Client(url());
    const b = new Client(url());
    await a.create('Alice');
    await b.join(a.code, 'Bob');
    expect((await b.emit('room:start')).ok).toBe(false);
    expect((await a.emit('room:start')).ok).toBe(false); // Bob not ready
    b.s.emit('room:ready', { ready: true });
    await until(() => !!a.lobby?.players.find((p) => p.name === 'Bob')?.ready);
    expect((await a.emit('room:start')).ok).toBe(true);
  });

  it('transfers ownership when the host leaves and cleans up empty rooms', async () => {
    const a = new Client(url());
    const b = new Client(url());
    await a.create('Alice');
    await b.join(a.code, 'Bob');
    a.s.emit('room:leave');
    await until(() => b.lobby?.hostId === b.playerId);
    expect(b.lobby!.players).toHaveLength(1);
    b.s.emit('room:leave');
    await until(() => srv.rooms.roomCount === 0);
  });

  it('removes abandoned rooms after the TTL', async () => {
    const a = new Client(url());
    await a.create('Alice');
    a.s.close();
    await until(() => srv.rooms.roomCount === 0, 3000);
  });
});

describe('match flow', () => {
  it('runs a full match, keeps aims secret, resolves hits, supports rematch', async () => {
    const { a, b } = await twoPlayerRoom();
    expect((await a.emit('room:start')).ok).toBe(true);
    await until(() => a.last?.phase === 'aiming' && b.last?.phase === 'aiming');
    const me = a.last.players.find((p) => p.id === a.playerId)!;
    const foe = a.last.players.find((p) => p.id === b.playerId)!;
    const toFoe = Math.atan2(foe.y - me.y, foe.x - me.x);
    const awayAngle = Math.atan2(foe.y - 500, foe.x - 500) + 0.35;
    const SECRET = 1.23456;
    a.s.emit('match:aim', { a: toFoe });
    b.s.emit('match:aim', { a: awayAngle });
    // secrecy: nothing a client received before the reveal contains the other player's angle
    a.s.emit('match:lock', { locked: true });
    b.s.emit('match:lock', { locked: true });
    await until(() => a.last?.phase === 'fire');
    const preFire = a.snaps.filter((s) => s.phase === 'aiming' || s.phase === 'lock');
    for (const s of preFire) {
      expect(s.shots).toHaveLength(0);
      expect(JSON.stringify(s)).not.toContain(awayAngle.toFixed(3));
    }
    void SECRET;
    expect(a.last.shots.find((s) => s.shooterId === a.playerId)!.hitId).toBe(b.playerId);
    await until(() => a.last?.phase === 'over');
    expect(a.last.winnerId).toBe(a.playerId);
    expect(a.last.standings[0].id).toBe(a.playerId);

    // rematch
    a.s.emit('room:rematch', { vote: true });
    await until(() => !!b.lobby?.players.find((p) => p.id === a.playerId)?.rematch);
    b.s.emit('room:rematch', { vote: true });
    const before = a.snaps.length;
    await until(() => a.snaps.length > before && a.last.phase === 'aiming' && a.last.round === 1);
    expect(a.last.players.every((p) => p.alive)).toBe(true);
  });

  it('survives a disconnect during aiming and restores state on rejoin', async () => {
    const { a, b } = await twoPlayerRoom();
    await a.emit('room:start');
    await until(() => b.last?.phase === 'aiming');
    b.s.emit('match:aim', { a: 0.777 });
    await new Promise((r) => setTimeout(r, 50));
    b.s.close();
    await until(() => a.lobby?.players.find((p) => p.id === b.playerId)?.connected === false);
    // reconnect with the saved token
    const b2 = new Client(url());
    await b2.ready();
    const res = await b2.emit('room:rejoin', { code: a.code, token: b.token });
    expect(res.ok).toBe(true);
    expect(res.playerId).toBe(b.playerId);
    await until(() => !!b2.last);
    expect(b2.last.players.find((p) => p.id === b.playerId)!.connected).toBe(true);
    expect(b2.last.you!.aim).toBeCloseTo(0.777, 2);
    expect((await new Client(url()).emit('room:rejoin', { code: a.code, token: 'x'.repeat(24) })).ok).toBe(false);
  });

  it('forfeits a player who never returns and awards the win', async () => {
    const { a, b } = await twoPlayerRoom();
    await a.emit('room:start');
    await until(() => a.last?.phase === 'aiming' && b.last?.phase === 'aiming');
    // both aim harmlessly so nobody dies by default aim
    for (const c of [a, b]) {
      const me = c.last.players.find((p) => p.id === c.playerId)!;
      c.s.emit('match:aim', { a: Math.atan2(me.y - 500, me.x - 500) + 0.35 });
    }
    await new Promise((r) => setTimeout(r, 40));
    b.s.close();
    await until(() => a.last?.phase === 'over', 6000);
    expect(a.last.winnerId).toBe(a.playerId);
  });

  it('rejects malformed and rate-limited input without crashing', async () => {
    const { a, b } = await twoPlayerRoom();
    await a.emit('room:start');
    await until(() => a.last?.phase === 'aiming');
    for (const bad of [null, undefined, 'x', { a: 'nope' }, { a: NaN }, { a: 1e12 }, [], { a: {} }]) a.s.emit('match:aim', bad);
    for (let i = 0; i < 500; i++) a.s.emit('match:aim', { a: i / 100 });
    a.s.emit('match:lock', { locked: 'yes' });
    a.s.emit('room:create', 5);
    const r = await b.emit('room:join', { code: a.code, name: 'x' });
    expect(r.ok).toBe(false); // match running
    expect(a.s.connected).toBe(true);
  });
});
