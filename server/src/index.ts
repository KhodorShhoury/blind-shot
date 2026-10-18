import { createGameServer } from './server';

const port = Number(process.env.PORT) || 3001;
const origins = (process.env.CLIENT_ORIGIN ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

createGameServer({ port, origins }).then((srv) => {
  console.log(`[blind-shot] listening on :${srv.port} (origins: ${origins.length ? origins.join(', ') : 'any'})`);
  const stop = () => {
    console.log('[blind-shot] shutting down');
    srv.close().then(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
});
