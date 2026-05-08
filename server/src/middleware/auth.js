import { verifyAccessToken } from '../services/authService.js';

export function authRequired(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'missing or malformed Authorization header' });
  }

  const token = header.slice(7);
  try {
    const payload = verifyAccessToken(token);
    req.user = { id: payload.sub, username: payload.username };
    return next();
  } catch (err) {
    return res.status(401).json({ error: 'invalid or expired access token' });
  }
}

export function authFromQuery(req, res, next) {
  const token = req.query.token;
  if (!token) {
    return res.status(401).json({ error: 'missing token query param' });
  }
  try {
    const payload = verifyAccessToken(token);
    req.user = { id: payload.sub, username: payload.username };
    return next();
  } catch (err) {
    return res.status(401).json({ error: 'invalid or expired token' });
  }
}
