import { createApp } from './app.js';
import { loadEnv } from './config/env.js';
import { createContext } from './context.js';
import { openDatabase } from './db/database.js';
import { systemClock } from './lib/clock.js';
import { createLogger } from './lib/logger.js';
import { startWorker } from './worker.js';

const env = loadEnv();
const log = createLogger();
const db = openDatabase(env.dbPath);
const ctx = createContext({ db, clock: systemClock, log, env });
const app = createApp(ctx);
const stopWorker = startWorker(ctx);

const server = app.listen(env.port, () => {
  log.info('server_started', { port: env.port, db: env.dbPath, ruleset: ctx.rules.active().id, production: env.isProduction });
});

const shutdown = () => {
  log.info('server_stopping');
  stopWorker();
  server.close(() => {
    db.close();
    process.exit(0);
  });
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
