import { createServer, type Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { buildConfig, type GameConfig } from '@shared/config';
import { RoomManager } from './rooms';

export interface ServerOptions {
  port?: number;
  config?: GameConfig;
  /** Allowed browser origins. Empty/undefined = reflect any origin (development only). */
  origins?: string[];
}

export interface GameServer {
  http: HttpServer;
  io: Server;
  rooms: RoomManager;
  port: number;
  close(): Promise<void>;
}

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): GameConfig {
  const n = (v: string | undefined) => (v && Number.isFinite(+v) && +v > 0 ? +v : undefined);
  return buildConfig({
    timing: {
      ...(n(env.AIM_MS) && { aimMs: n(env.AIM_MS) }),
      ...(n(env.LOCK_MS) && { lockMs: n(env.LOCK_MS) }),
      ...(n(env.FIRE_MS) && { fireMs: n(env.FIRE_MS) }),
      ...(n(env.RESULT_MS) && { resultMs: n(env.RESULT_MS) }),
    },
  });
}

export function createGameServer(opts: ServerOptions = {}): Promise<GameServer> {
  const config = opts.config ?? configFromEnv();
  const http = createServer((req, res) => {
    if (req.url === '/healthz') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('ok');
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ name: 'blind-shot-server', rooms: rooms.roomCount }));
  });
  const io = new Server(http, {
    cors: { origin: opts.origins && opts.origins.length ? opts.origins : true },
    maxHttpBufferSize: 4_000,
    serveClient: false,
  });
  const rooms = new RoomManager(io, config);
  io.on('connection', (socket) => rooms.attach(socket));

  return new Promise((resolve) => {
    http.listen(opts.port ?? 0, () => {
      const addr = http.address();
      const port = typeof addr === 'object' && addr ? addr.port : opts.port ?? 0;
      resolve({
        http,
        io,
        rooms,
        port,
        close: () =>
          new Promise<void>((done) => {
            rooms.dispose();
            io.close(() => done());
          }),
      });
    });
  });
}
