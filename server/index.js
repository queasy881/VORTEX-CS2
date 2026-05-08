import express from 'express';
import cors from 'cors';
import http from 'node:http';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config, missingEnvVars } from './src/utils/config.js';
import { logger } from './src/utils/logger.js';
import { errorHandler, notFoundHandler } from './src/middleware/errorHandler.js';
import { authRequired } from './src/middleware/auth.js';
import authRouter from './src/routes/auth.js';
import friendsRouter from './src/routes/friends.js';
import filesRouter from './src/routes/files.js';

const state = {
  ready: false,
  initError: null,
  schemaErrors: [],
};

function buildApp() {
  const app = express();

  const corsOptions = config.corsOrigin === '*'
    ? { origin: true, exposedHeaders: ['X-Job-Id'] }
    : { origin: config.corsOrigin.split(',').map((s) => s.trim()), credentials: true, exposedHeaders: ['X-Job-Id'] };
  app.use(cors(corsOptions));

  app.get('/health', (_req, res) => {
    res.json({
      status: state.ready ? 'ok' : 'starting',
      uptime: process.uptime(),
      missingEnvVars,
      initError: state.initError,
      schemaErrors: state.schemaErrors,
    });
  });

  app.use('/api/auth', express.json({ limit: '1mb' }), authRouter);
  app.use('/api/friends', authRequired, express.json({ limit: '1mb' }), friendsRouter);
  app.use('/api/files', authRequired, (req, res, next) => {
    if (req.path === '/upload' && req.method === 'POST') return next();
    return express.json({ limit: '1mb' })(req, res, next);
  }, filesRouter);

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const staticDir = path.join(__dirname, 'public');
  if (existsSync(staticDir)) {
    app.use(express.static(staticDir, { maxAge: '1h', index: false }));
    app.get(/^\/(?!api\/|health$).*/, (req, res, next) => {
      const indexPath = path.join(staticDir, 'index.html');
      if (existsSync(indexPath)) return res.sendFile(indexPath);
      return next();
    });
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

async function initBackground(httpServer) {
  if (missingEnvVars.length > 0) {
    const msg = `missing required env vars: ${missingEnvVars.join(', ')}`;
    logger.error(msg);
    state.initError = msg;
    return;
  }

  try {
    const { runMigrations, validateSchema } = await import('./src/db/schemaValidator.js');
    logger.info('running database migrations');
    await runMigrations();

    logger.info('validating database schema');
    const { valid, errors } = await validateSchema();
    if (!valid) {
      logger.error('schema validation failed', { errors });
      state.schemaErrors = errors;
      state.initError = 'schema validation failed';
      return;
    }
    logger.info('schema validation passed');
  } catch (err) {
    logger.error('database init failed', { message: err.message });
    state.initError = `database init failed: ${err.message}`;
    return;
  }

  try {
    const { attachWebSocketServer } = await import('./src/routes/websocket.js');
    attachWebSocketServer(httpServer);
    logger.info('websocket server attached');
  } catch (err) {
    logger.error('websocket init failed', { message: err.message });
  }

  state.ready = true;
  logger.info('server fully ready');
}

const app = buildApp();
const httpServer = http.createServer(app);
httpServer.listen(config.port, '0.0.0.0', () => {
  logger.info(`server listening on port ${config.port}`, { env: config.nodeEnv });
  initBackground(httpServer).catch((err) => {
    logger.error('init failed', { message: err.message });
    state.initError = err.message;
  });
});

const shutdown = (signal) => {
  logger.info(`received ${signal}, shutting down`);
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10000).unref();
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (reason) => {
  logger.error('unhandled rejection', { reason: String(reason) });
});
