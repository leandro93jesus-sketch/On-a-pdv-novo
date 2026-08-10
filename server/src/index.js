import { createApp } from './app.js';
import { bootstrapRuntime } from './bootstrap.js';
import { getDataDir, getDbPath } from './db/paths.js';
import { logger } from './utils/logger.js';
import { APP_NAME, APP_VERSION } from './version.js';

const runtime = bootstrapRuntime();
const app = createApp();
const PORT = Number(process.env.PORT || 3001);

let server = null;

export function startServer(port = PORT) {
  if (server) return server;
  const host = process.env.PDV_HOST || '127.0.0.1';
  server = app.listen(port, host, () => {
    logger.info(`${APP_NAME} ${APP_VERSION} API em http://${host}:${port}`);
    logger.info(`data dir: ${getDataDir()}`);
    logger.info(`banco: ${getDbPath()}`);
    console.log(`[onca-pdv] ${APP_NAME} ${APP_VERSION}`);
    console.log(`[onca-pdv] API em http://${host}:${port}`);
    console.log(`[onca-pdv] banco: ${getDbPath()}`);
  });
  server.on('error', (err) => {
    logger.error('falha ao iniciar HTTP', { message: err.message, code: err.code });
    console.error('[onca-pdv] falha ao iniciar HTTP:', err.message);
  });
  return server;
}

export function stopServer() {
  return new Promise((resolve) => {
    if (!server) return resolve();
    server.close(() => {
      server = null;
      resolve();
    });
  });
}

if (process.env.NODE_ENV !== 'test' && process.env.PDV_NO_LISTEN !== '1') {
  startServer(PORT);
}

export { app, runtime };
