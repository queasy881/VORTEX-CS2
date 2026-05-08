import express from 'express';
import cors from 'cors';
import http from 'node:http';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config } from './src/utils/config.js';
import { logger } from './src/utils/logger.js';
import { runMigrations, validateSchema } from './src/db/schemaValidator.js';
import { errorHandler, notFoundHandler } from './src/middleware/errorHandler.js';
import { authRequired } from './src/middleware/auth.js';
import authRouter from './src/routes/auth.js';
import friendsRouter from './src/routes/friends.js';
import filesRouter from './src/routes/files.js';
import { attachWebSocketServer } from './src/routes/websocket.js';

async function bootstrap() {
  logger.info('running database migrations');
  await runMigrations();

  logger.info('validating database schema');
  const { valid, errors } = await validateSchema();
  if (!valid) {
    logger.error('schema validation failed', { errors });
    console.error('\n=== SCHEMA VALIDATION ERRORS ===');
    for (const e of errors) {
      console.error('  - ' + e);
    }
    console.error('================================\n');
    process.exit(1);
  }
  logger.info('schema validation passed');

  const app = express();

  const corsOptions = config.corsOrigin === '*'
    ? { origin: true, exposedHeaders: ['X-Job-Id'] }
    : { origin: config.corsOrigin.split(',').map((s) => s.trim()), credentials: true, exposedHeaders: ['X-Job-Id'] };
  app.use(cors(corsOptions));

  app.get('/health', (_req, res) => res.json({ status: 'ok', uptime: process.uptime() }));

  app.use('/api/auth', express.json({ limit: '1mb' }), authRouter);

  app.use('/api/friends', authRequired, express.json({ limit: '1mb' }), friendsRouter);

  app.use('/api/files', authRequired, (req, res, next) => {
    if (req.path === '/upload' && req.method === 'POST') {
      return next();
    }
    return express.json({ limit: '1mb' })(req, res, next);
  }, filesRouter);

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const staticDir = path.join(__dirname, 'public');
  if (existsSync(staticDir)) {
    app.use(express.static(staticDir, { maxAge: '1h', index: false }));
    app.get(/^\/(?!api\/|health$).*/, (req, res, next) => {
      const indexPath = path.join(staticDir, 'index.html');
      if (existsSync(indexPath)) {
        return res.sendFile(indexPath);
      }
      return next();
    });
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  const httpServer = http.createServer(app);
  attachWebSocketServer(httpServer);

  httpServer.listen(config.port, '0.0.0.0', () => {
    logger.info(`server listening on port ${config.port}`, { env: config.nodeEnv });
  });

  const shutdown = (signal) => {
    logger.info(`received ${signal}, shutting down`);
    httpServer.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

bootstrap().catch((err) => {
  console.error('fatal startup error:', err);
  process.exit(1);
});
