import { logger } from '../utils/logger.js';

export function errorHandler(err, req, res, _next) {
  logger.error('Unhandled error', { message: err.message, stack: err.stack, path: req.path });

  if (res.headersSent) {
    return;
  }

  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'request body too large' });
  }

  if (err.code === '23505') {
    return res.status(409).json({ error: 'resource already exists' });
  }

  return res.status(err.status || 500).json({
    error: err.publicMessage || 'internal server error',
  });
}

export function notFoundHandler(req, res) {
  res.status(404).json({ error: 'not found', path: req.path });
}
