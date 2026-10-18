import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { io as connect, type Socket } from 'socket.io-client';
import { buildConfig } from '@shared/config';
import type { MatchSnapshot } from '@shared/engine';
import type { LobbyState } from '@shared/protocol';
import { createGameServer, type GameServer } from '../src/server';

const cfg = buildConfig({
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

/** Test-only peek at the server's secret positions (clients must never be able to do this). */
function secrets(code: string): Map<string, { x: number; y: number }> {
  const room = (srv.rooms as any).rooms.get(code);
  return new Map(room.engine.secretPositions().map((q: any) => [q.id, { x: q.x, y: q.y }]));
}
const angleTo = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.atan2(b.y - a.y, b.x - a.x);

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
  it('runs a full match, keeps aims AND positions secret, resolves hits, supports rematch', async () => {
    const { a, b } = await twoPlayerRoom();
    expect((await a.emit('room:start')).ok).toBe(true);
    await until(() => a.last?.phase === 'aiming' && b.last?.phase === 'aiming');
    const pos = secrets(a.code);
    const me = pos.get(a.playerId)!;
    const foe = pos.get(b.playerId)!;
    const toFoe = angleTo(me, foe);
    const awayAngle = angleTo(foe, me) + Math.PI + 0.35;
    a.s.emit('match:aim', { a: toFoe });
    b.s.emit('match:aim', { a: awayAngle });
    a.s.emit('match:lock', { locked: true });
    b.s.emit('match:lock', { locked: true });
    await until(() => a.last?.phase === 'fire' && b.last?.phase === 'fire');

    // secrecy: nothing received before the reveal carries the other player's angle OR coordinates
    for (const [c, otherId, otherAim] of [[a, b.playerId, awayAngle], [b, a.playerId, toFoe]] as const) {
      const preFire = c.snaps.filter((x) => x.phase === 'aiming' || x.phase === 'lock');
      expect(preFire.length).toBeGreaterThan(0);
      for (const snap of preFire) {
        expect(snap.shots).toHaveLength(0);
        expect(snap.eliminations).toHaveLength(0);
        const other = snap.players.find((q) => q.id === otherId)!;
        expect(other.x).toBeUndefined();
        expect(other.y).toBeUndefined();
        const own = snap.players.find((q) => q.id === c.playerId)!;
        expect(own.x).toBeDefined();
        expect(JSON.stringify(snap)).not.toContain(otherAim.toFixed(3));
      }
    }
    // after the reveal everyone's position is public
    const fireSnap = a.last;
    expect(fireSnap.players.every((q) => q.x !== undefined && q.y !== undefined)).toBe(true);
    expect(fireSnap.players.find((q) => q.id === b.playerId)!.x).toBe(foe.x);
    expect(fireSnap.shots.find((x) => x.shooterId === a.playerId)!.hitId).toBe(b.playerId);
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

  it('keeps playing when nobody is hit: next round, positions hidden again', async () => {
    const { a, b } = await twoPlayerRoom();
    await a.emit('room:start');
    await until(() => a.last?.phase === 'aiming' && a.last.round === 1);
    const r1 = secrets(a.code);
    // both fire directly away from each other: guaranteed miss
    a.s.emit('match:aim', { a: angleTo(r1.get(b.playerId)!, r1.get(a.playerId)!) });
    b.s.emit('match:aim', { a: angleTo(r1.get(a.playerId)!, r1.get(b.playerId)!) });
    await until(() => a.last?.phase === 'result' && a.last.round === 1);
    expect(a.last.eliminations).toHaveLength(0);
    expect(a.last.players.every((q) => q.alive)).toBe(true);
    await until(() => a.last?.phase === 'aiming' && a.last.round === 2 && b.last?.phase === 'aiming' && b.last.round === 2);
    const r2 = secrets(a.code);
    // nobody is re-placed: everyone starts the next round where they stood
    expect(r2.get(a.playerId)).toEqual(r1.get(a.playerId));
    // the new round hides the foe again, and nobody was told the new coordinates
    expect(a.last.players.find((q) => q.id === b.playerId)!.x).toBeUndefined();
    expect(b.last.players.find((q) => q.id === a.playerId)!.x).toBeUndefined();
  });

  it('lets a player walk; only they ever learn their own live position', async () => {
    const { a, b } = await twoPlayerRoom();
    await a.emit('room:start');
    await until(() => a.last?.phase === 'aiming' && b.last?.phase === 'aiming');
    const posA: { round: number; x: number; y: number }[] = [];
    const posB: { round: number; x: number; y: number }[] = [];
    a.s.on('match:pos', (m: any) => posA.push(m));
    b.s.on('match:pos', (m: any) => posB.push(m));
    const start = secrets(a.code).get(a.playerId)!;
    const bStart = secrets(a.code).get(b.playerId)!;
    // refresh the intent like the real client does (it expires if not refreshed)
    const iv = setInterval(() => a.s.emit('match:move', { x: 1, y: 0 }), 50);
    await until(() => posA.length > 0 && posA[posA.length - 1].x > start.x + 20, 3000);
    clearInterval(iv);
    a.s.emit('match:move', { x: 0, y: 0 });
    expect(secrets(a.code).get(a.playerId)!.x).toBeGreaterThan(start.x);
    expect(secrets(a.code).get(b.playerId)).toEqual(bStart);
    // B never receives A's position, neither in position updates nor in snapshots
    expect(posB.every((m) => m.x === secrets(a.code).get(b.playerId)!.x || m.x === bStart.x)).toBe(true);
    for (const snap of b.snaps.filter((x) => x.phase === 'aiming')) expect(snap.players.find((q) => q.id === a.playerId)!.x).toBeUndefined();
    // malformed movement is ignored
    for (const bad of [null, 'x', { x: 'a' }, { x: NaN, y: 1 }, { x: 1e12, y: 0 }]) a.s.emit('match:move', bad);
    await new Promise((r) => setTimeout(r, 30));
    expect(a.s.connected).toBe(true);
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
    // both aim directly away from each other so nobody dies
    const pos = secrets(a.code);
    a.s.emit('match:aim', { a: angleTo(pos.get(b.playerId)!, pos.get(a.playerId)!) });
    b.s.emit('match:aim', { a: angleTo(pos.get(a.playerId)!, pos.get(b.playerId)!) });
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
