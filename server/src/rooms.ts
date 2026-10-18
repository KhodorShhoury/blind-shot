import { randomBytes } from 'node:crypto';
import type { Server, Socket } from 'socket.io';
import { MatchEngine, type PlayerInit } from '@shared/engine';
import type { GameConfig } from '@shared/config';
import {
  C2S,
  S2C,
  RateLimiter,
  isToken,
  normalizeRoomCode,
  parseAngle,
  parseMove,
  type PosUpdate,
  parseBool,
  randomRoomCode,
  sanitizeName,
  type JoinAck,
  type LobbyState,
  type LockInfo,
} from '@shared/protocol';

interface Member {
  id: string;
  token: string;
  name: string;
  slot: number;
  socketId: string | null;
  ready: boolean;
  rematch: boolean;
  left: boolean;
  disconnectedAt: number | null;
  lobbyTimer: NodeJS.Timeout | null;
}

interface Room {
  code: string;
  hostId: string;
  status: 'lobby' | 'playing' | 'over';
  members: Member[];
  engine: MatchEngine | null;
  tick: NodeJS.Timeout | null;
  cleanup: NodeJS.Timeout | null;
}

interface SocketData {
  general: RateLimiter;
  aim: RateLimiter;
  move: RateLimiter;
  lock: RateLimiter;
  binding: { code: string; playerId: string } | null;
}

type AckFn = (res: JoinAck | { ok: boolean; error?: string }) => void;
const asAck = (a: unknown): AckFn => (typeof a === 'function' ? (a as AckFn) : () => {});
const token = () => randomBytes(18).toString('base64url');
const pid = () => randomBytes(5).toString('hex');

export class RoomManager {
  private rooms = new Map<string, Room>();

  constructor(private io: Server, private cfg: GameConfig) {}

  get roomCount(): number {
    return this.rooms.size;
  }

  attach(socket: Socket): void {
    const data: SocketData = {
      general: new RateLimiter(10, 3),
      aim: new RateLimiter(80, 60),
      move: new RateLimiter(60, 30),
      lock: new RateLimiter(10, 5),
      binding: null,
    };
    socket.data = data;

    const guard = (ack: unknown): boolean => {
      if (!data.general.take()) {
        asAck(ack)({ ok: false, error: 'Slow down a little.' });
        return false;
      }
      return true;
    };

    socket.on(C2S.create, (payload: unknown, ack: unknown) => {
      if (!guard(ack)) return;
      const name = sanitizeName((payload as any)?.name, this.cfg);
      this.create(socket, name, asAck(ack));
    });
    socket.on(C2S.join, (payload: unknown, ack: unknown) => {
      if (!guard(ack)) return;
      const p = payload as any;
      this.join(socket, normalizeRoomCode(p?.code, this.cfg), sanitizeName(p?.name, this.cfg), asAck(ack));
    });
    socket.on(C2S.rejoin, (payload: unknown, ack: unknown) => {
      if (!guard(ack)) return;
      const p = payload as any;
      this.rejoin(socket, normalizeRoomCode(p?.code, this.cfg), p?.token, asAck(ack));
    });
    socket.on(C2S.leave, () => {
      if (data.general.take()) this.leave(socket);
    });
    socket.on(C2S.ready, (payload: unknown) => {
      const v = parseBool((payload as any)?.ready);
      if (v !== null && data.general.take()) this.withMember(socket, (r, m) => this.setReady(r, m, v));
    });
    socket.on(C2S.start, (_p: unknown, ack: unknown) => {
      if (!guard(ack)) return;
      this.withMember(socket, (r, m) => asAck(ack)(this.start(r, m)));
    });
    socket.on(C2S.toLobby, () => {
      if (data.general.take()) this.withMember(socket, (r, m) => this.toLobby(r, m));
    });
    socket.on(C2S.rematch, (payload: unknown) => {
      const v = parseBool((payload as any)?.vote);
      if (v !== null && data.general.take()) this.withMember(socket, (r, m) => this.rematch(r, m, v));
    });
    socket.on(C2S.aim, (payload: unknown) => {
      if (!data.aim.take()) return;
      const a = parseAngle((payload as any)?.a);
      if (a === null) return;
      this.withMember(socket, (r, m) => r.engine && r.status === 'playing' && r.engine.setAim(m.id, a));
    });
    socket.on(C2S.move, (payload: unknown) => {
      if (!data.move.take()) return;
      const v = parseMove(payload);
      if (v === null) return;
      this.withMember(socket, (r, m) => r.engine && r.status === 'playing' && r.engine.setMove(m.id, v.x, v.y, Date.now()));
    });
    socket.on(C2S.lock, (payload: unknown) => {
      if (!data.lock.take()) return;
      const v = parseBool((payload as any)?.locked);
      if (v === null) return;
      this.withMember(socket, (r, m) => {
        if (r.engine && r.status === 'playing' && r.engine.setLocked(m.id, v)) {
          this.emitRoom(r, S2C.lockInfo, { id: m.id, locked: v } satisfies LockInfo);
        }
      });
    });
    socket.on('disconnect', () => this.onDisconnect(socket));
  }

  /* ------------------------------------------------------------------ lifecycle */

  private create(socket: Socket, name: string, ack: AckFn): void {
    if ((socket.data as SocketData).binding) this.leave(socket);
    if (this.rooms.size >= this.cfg.room.maxRooms) return ack({ ok: false, error: 'Server is full. Try again soon.' });
    let code = '';
    do code = randomRoomCode(this.cfg.room.codeLength);
    while (this.rooms.has(code));
    const room: Room = { code, hostId: '', status: 'lobby', members: [], engine: null, tick: null, cleanup: null };
    this.rooms.set(code, room);
    const m = this.addMember(room, socket, name);
    room.hostId = m.id;
    ack({ ok: true, code, playerId: m.id, token: m.token });
    this.sendLobby(room);
  }

  private join(socket: Socket, code: string | null, name: string, ack: AckFn): void {
    if (!code) return ack({ ok: false, error: 'Invalid room code.' });
    const room = this.rooms.get(code);
    if (!room) return ack({ ok: false, error: 'Room not found.' });
    if (room.status !== 'lobby') return ack({ ok: false, error: 'A match is already in progress.' });
    if (this.activeMembers(room).length >= this.cfg.room.maxPlayers) return ack({ ok: false, error: 'Room is full.' });
    if ((socket.data as SocketData).binding) this.leave(socket);
    const m = this.addMember(room, socket, name);
    ack({ ok: true, code, playerId: m.id, token: m.token });
    this.sendLobby(room);
  }

  private rejoin(socket: Socket, code: string | null, tok: unknown, ack: AckFn): void {
    const room = code ? this.rooms.get(code) : undefined;
    if (!room || !isToken(tok)) return ack({ ok: false, error: 'Session expired.' });
    const m = room.members.find((x) => x.token === tok && !x.left);
    if (!m) return ack({ ok: false, error: 'Session expired.' });
    // drop any stale socket for this member
    if (m.socketId && m.socketId !== socket.id) {
      const old = this.io.sockets.sockets.get(m.socketId);
      if (old) {
        (old.data as SocketData).binding = null;
        old.disconnect(true);
      }
    }
    if (m.lobbyTimer) clearTimeout(m.lobbyTimer);
    m.lobbyTimer = null;
    m.socketId = socket.id;
    m.disconnectedAt = null;
    (socket.data as SocketData).binding = { code: room.code, playerId: m.id };
    socket.join(room.code);
    room.engine?.setConnected(m.id, true, Date.now());
    if (room.cleanup) clearTimeout(room.cleanup);
    room.cleanup = null;
    if (!this.isConnected(room, room.hostId)) room.hostId = m.id;
    ack({ ok: true, code: room.code, playerId: m.id, token: m.token });
    this.sendLobby(room);
    if (room.engine && room.status !== 'lobby') this.sendMatchTo(room, m);
    if (room.status === 'playing') this.sendMatch(room);
  }

  private leave(socket: Socket): void {
    const b = (socket.data as SocketData).binding;
    if (!b) return;
    const room = this.rooms.get(b.code);
    (socket.data as SocketData).binding = null;
    socket.leave(b.code);
    if (!room) return;
    const m = room.members.find((x) => x.id === b.playerId);
    if (!m) return;
    this.removeMember(room, m, true);
  }

  private onDisconnect(socket: Socket): void {
    const b = (socket.data as SocketData).binding;
    if (!b) return;
    const room = this.rooms.get(b.code);
    if (!room) return;
    const m = room.members.find((x) => x.id === b.playerId);
    if (!m || m.socketId !== socket.id) return; // already replaced by a newer socket
    m.socketId = null;
    m.disconnectedAt = Date.now();
    m.ready = room.status === 'lobby' ? false : m.ready;
    if (room.engine) room.engine.setConnected(m.id, false, Date.now());
    if (room.status === 'lobby' || room.status === 'over') {
      m.lobbyTimer = setTimeout(() => {
        m.lobbyTimer = null;
        if (m.socketId === null && !m.left) this.removeMember(room, m, true);
      }, this.cfg.room.lobbyGraceMs);
    }
    this.transferHostIfNeeded(room);
    this.sendLobby(room);
    if (room.status === 'playing') this.sendMatch(room);
    this.scheduleCleanup(room);
  }

  private addMember(room: Room, socket: Socket, name: string): Member {
    const used = new Set(room.members.filter((m) => !m.left).map((m) => m.slot));
    let slot = 0;
    while (used.has(slot)) slot++;
    const m: Member = {
      id: pid(),
      token: token(),
      name: this.uniqueName(room, name),
      slot,
      socketId: socket.id,
      ready: false,
      rematch: false,
      left: false,
      disconnectedAt: null,
      lobbyTimer: null,
    };
    room.members.push(m);
    (socket.data as SocketData).binding = { code: room.code, playerId: m.id };
    socket.join(room.code);
    return m;
  }

  private uniqueName(room: Room, name: string): string {
    const taken = new Set(room.members.filter((m) => !m.left).map((m) => m.name.toLowerCase()));
    if (!taken.has(name.toLowerCase())) return name;
    for (let i = 2; i < 10; i++) {
      const n = `${name.slice(0, this.cfg.room.nameMax - 2)} ${i}`;
      if (!taken.has(n.toLowerCase())) return n;
    }
    return name;
  }

  private removeMember(room: Room, m: Member, voluntary: boolean): void {
    if (m.lobbyTimer) clearTimeout(m.lobbyTimer);
    m.lobbyTimer = null;
    m.left = true;
    m.socketId = null;
    if (room.engine && room.status === 'playing') {
      // leaving mid-match forfeits at the next round start
      room.engine.setConnected(m.id, false, Date.now() - this.cfg.room.disconnectGraceMs - 1);
    }
    if (room.status !== 'playing') room.members = room.members.filter((x) => x !== m);
    if (this.activeMembers(room).length === 0) {
      this.destroy(room);
      return;
    }
    this.transferHostIfNeeded(room);
    this.sendLobby(room);
    if (room.status === 'playing') {
      this.sendMatch(room);
      this.checkRematch(room);
    } else if (room.status === 'over') this.checkRematch(room);
    this.scheduleCleanup(room);
    void voluntary;
  }

  private activeMembers(room: Room): Member[] {
    return room.members.filter((m) => !m.left);
  }
  private isConnected(room: Room, id: string): boolean {
    return room.members.some((m) => m.id === id && !m.left && m.socketId !== null);
  }
  private transferHostIfNeeded(room: Room): void {
    if (this.isConnected(room, room.hostId)) return;
    const next = this.activeMembers(room).find((m) => m.socketId !== null);
    if (next) room.hostId = next.id;
  }

  private scheduleCleanup(room: Room): void {
    const anyConnected = this.activeMembers(room).some((m) => m.socketId !== null);
    if (anyConnected) {
      if (room.cleanup) clearTimeout(room.cleanup);
      room.cleanup = null;
      return;
    }
    if (room.cleanup) return;
    room.cleanup = setTimeout(() => this.destroy(room), this.cfg.room.emptyRoomTtlMs);
  }

  private destroy(room: Room): void {
    if (room.tick) clearInterval(room.tick);
    if (room.cleanup) clearTimeout(room.cleanup);
    for (const m of room.members) if (m.lobbyTimer) clearTimeout(m.lobbyTimer);
    room.tick = room.cleanup = null;
    room.engine = null;
    this.rooms.delete(room.code);
  }

  /** Stop every timer (graceful shutdown / tests). */
  dispose(): void {
    for (const r of [...this.rooms.values()]) this.destroy(r);
  }

  /* ------------------------------------------------------------------ actions */

  private withMember(socket: Socket, fn: (room: Room, m: Member) => void): void {
    const b = (socket.data as SocketData).binding;
    if (!b) return;
    const room = this.rooms.get(b.code);
    const m = room?.members.find((x) => x.id === b.playerId && !x.left);
    if (room && m) fn(room, m);
  }

  private setReady(room: Room, m: Member, ready: boolean): void {
    if (room.status !== 'lobby') return;
    m.ready = ready;
    this.sendLobby(room);
  }

  private start(room: Room, m: Member): { ok: boolean; error?: string } {
    if (room.status !== 'lobby') return { ok: false, error: 'Match already running.' };
    if (m.id !== room.hostId) return { ok: false, error: 'Only the host can start.' };
    const connected = this.activeMembers(room).filter((x) => x.socketId !== null);
    if (connected.length < this.cfg.room.minPlayers) return { ok: false, error: `Need at least ${this.cfg.room.minPlayers} players.` };
    if (connected.some((x) => x.id !== room.hostId && !x.ready)) return { ok: false, error: 'Waiting for everyone to be ready.' };
    // drop absentees from the lobby
    for (const x of this.activeMembers(room)) if (x.socketId === null) this.removeMember(room, x, false);
    this.startMatch(room);
    return { ok: true };
  }

  private startMatch(room: Room): void {
    if (room.tick) clearInterval(room.tick);
    const players: PlayerInit[] = this.activeMembers(room).map((x) => ({ id: x.id, name: x.name, slot: x.slot }));
    room.status = 'playing';
    for (const x of room.members) x.rematch = false;
    const engine = new MatchEngine(players, Math.random, this.cfg, (ev) => {
      if (room.engine !== engine) return;
      if (ev === 'over') {
        room.status = 'over';
        if (room.tick) clearInterval(room.tick);
        room.tick = null;
        for (const x of room.members) x.ready = false;
        this.sendMatch(room);
        this.sendLobby(room);
      } else this.sendMatch(room);
    });
    room.engine = engine;
    for (const x of this.activeMembers(room)) if (x.socketId === null) engine.setConnected(x.id, false, Date.now());
    this.sendLobby(room);
    engine.start(Date.now());
    let n = 0;
    room.tick = setInterval(() => {
      engine.tick(Date.now());
      if (++n % 3 === 0) this.sendPositions(room, engine);
    }, 25);
  }

  private toLobby(room: Room, m: Member): void {
    if (room.status === 'lobby') return;
    if (m.id !== room.hostId && room.status === 'playing') return;
    if (room.tick) clearInterval(room.tick);
    room.tick = null;
    room.engine = null;
    room.status = 'lobby';
    for (const x of room.members) {
      x.ready = false;
      x.rematch = false;
    }
    for (const x of this.activeMembers(room)) if (x.socketId === null) this.removeMember(room, x, false);
    this.sendLobby(room);
  }

  private rematch(room: Room, m: Member, vote: boolean): void {
    if (room.status !== 'over') return;
    m.rematch = vote;
    this.sendLobby(room);
    this.checkRematch(room);
  }

  private checkRematch(room: Room): void {
    if (room.status !== 'over') return;
    const connected = this.activeMembers(room).filter((x) => x.socketId !== null);
    if (connected.length >= this.cfg.room.minPlayers && connected.every((x) => x.rematch)) {
      for (const x of this.activeMembers(room)) if (x.socketId === null) this.removeMember(room, x, false);
      this.startMatch(room);
    }
  }

  /* ------------------------------------------------------------------ messaging */

  private lobbyState(room: Room): LobbyState {
    return {
      code: room.code,
      status: room.status,
      hostId: room.hostId,
      minPlayers: this.cfg.room.minPlayers,
      maxPlayers: this.cfg.room.maxPlayers,
      players: this.activeMembers(room).map((m) => ({
        id: m.id,
        name: m.name,
        slot: m.slot,
        ready: m.ready,
        connected: m.socketId !== null,
        isHost: m.id === room.hostId,
        rematch: m.rematch,
      })),
    };
  }

  private sendLobby(room: Room): void {
    this.emitRoom(room, S2C.lobby, this.lobbyState(room));
  }

  private emitRoom(room: Room, ev: string, payload: unknown): void {
    this.io.to(room.code).emit(ev, payload);
  }

  /** While aiming, each player gets (only) their own live position; nobody else's is ever sent. */
  private sendPositions(room: Room, engine: MatchEngine): void {
    if (room.engine !== engine || engine.phase !== 'aiming') return;
    for (const m of this.activeMembers(room)) {
      if (!m.socketId) continue;
      const pos = engine.ownPosition(m.id);
      if (pos) this.io.to(m.socketId).volatile.emit(S2C.pos, { round: engine.round, x: Math.round(pos.x * 10) / 10, y: Math.round(pos.y * 10) / 10 } satisfies PosUpdate);
    }
  }

  private sendMatchTo(room: Room, m: Member): void {
    if (!room.engine || !m.socketId) return;
    this.io.to(m.socketId).emit(S2C.match, { snapshot: room.engine.snapshot(Date.now(), m.id) });
  }

  /** Each client gets a personalised snapshot (only their own aim is included). */
  private sendMatch(room: Room): void {
    if (!room.engine) return;
    for (const m of this.activeMembers(room)) this.sendMatchTo(room, m);
  }
}
