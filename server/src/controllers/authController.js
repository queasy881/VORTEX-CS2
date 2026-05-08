import {
  createUser,
  findUserByUsername,
  findUserByEmail,
  verifyPassword,
  generateTokenPair,
  verifyRefreshToken,
  isRefreshTokenValid,
  revokeRefreshToken,
  signAccessToken,
} from '../services/authService.js';

const USERNAME_RE = /^[a-zA-Z0-9_]{3,32}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function signup(req, res) {
  const { username, email, password } = req.body || {};

  if (!username || !email || !password) {
    return res.status(400).json({ error: 'username, email, and password required' });
  }
  if (!USERNAME_RE.test(username)) {
    return res.status(400).json({ error: 'username must be 3-32 chars (letters, numbers, underscore)' });
  }
  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'invalid email format' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'password must be at least 8 characters' });
  }

  const existingByUsername = await findUserByUsername(username);
  if (existingByUsername) {
    return res.status(409).json({ error: 'username already taken' });
  }
  const existingByEmail = await findUserByEmail(email);
  if (existingByEmail) {
    return res.status(409).json({ error: 'email already registered' });
  }

  const user = await createUser({ username, email, password });
  const { accessToken, refreshToken } = await generateTokenPair(user);

  return res.status(201).json({
    user: { id: user.id, username: user.username, email: user.email },
    accessToken,
    refreshToken,
  });
}

export async function login(req, res) {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'username and password required' });
  }

  const user = await findUserByUsername(username);
  if (!user) {
    return res.status(401).json({ error: 'invalid credentials' });
  }

  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) {
    return res.status(401).json({ error: 'invalid credentials' });
  }

  const { accessToken, refreshToken } = await generateTokenPair(user);
  return res.json({
    user: { id: user.id, username: user.username, email: user.email },
    accessToken,
    refreshToken,
  });
}

export async function refresh(req, res) {
  const { refreshToken } = req.body || {};
  if (!refreshToken) {
    return res.status(400).json({ error: 'refreshToken required' });
  }

  let payload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch (err) {
    return res.status(401).json({ error: 'invalid refresh token' });
  }

  const valid = await isRefreshTokenValid(payload.sub, refreshToken);
  if (!valid) {
    return res.status(401).json({ error: 'refresh token revoked or expired' });
  }

  const accessToken = signAccessToken({ sub: payload.sub, username: payload.username });
  return res.json({ accessToken });
}

export async function logout(req, res) {
  const { refreshToken } = req.body || {};
  if (refreshToken) {
    await revokeRefreshToken(refreshToken);
  }
  return res.status(204).send();
}
