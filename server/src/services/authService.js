import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { config } from '../utils/config.js';
import { query } from '../db/pool.js';

export async function hashPassword(password) {
  return bcrypt.hash(password, config.bcryptCost);
}

export async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

export function signAccessToken(payload) {
  return jwt.sign(payload, config.jwtAccessSecret, {
    expiresIn: config.accessTokenTtlSeconds,
  });
}

export function signRefreshToken(payload) {
  return jwt.sign(payload, config.jwtRefreshSecret, {
    expiresIn: config.refreshTokenTtlSeconds,
  });
}

export function verifyAccessToken(token) {
  return jwt.verify(token, config.jwtAccessSecret);
}

export function verifyRefreshToken(token) {
  return jwt.verify(token, config.jwtRefreshSecret);
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export async function storeRefreshToken(userId, token) {
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + config.refreshTokenTtlSeconds * 1000);
  await query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
    [userId, tokenHash, expiresAt]
  );
}

export async function isRefreshTokenValid(userId, token) {
  const tokenHash = hashToken(token);
  const result = await query(
    `SELECT id FROM refresh_tokens
     WHERE user_id = $1 AND token_hash = $2 AND revoked = FALSE AND expires_at > NOW()`,
    [userId, tokenHash]
  );
  return result.rowCount > 0;
}

export async function revokeRefreshToken(token) {
  const tokenHash = hashToken(token);
  await query(
    `UPDATE refresh_tokens SET revoked = TRUE WHERE token_hash = $1`,
    [tokenHash]
  );
}

export async function revokeAllUserTokens(userId) {
  await query(
    `UPDATE refresh_tokens SET revoked = TRUE WHERE user_id = $1`,
    [userId]
  );
}

export async function createUser({ username, email, password }) {
  const passwordHash = await hashPassword(password);
  const result = await query(
    `INSERT INTO users (username, email, password_hash)
     VALUES ($1, $2, $3)
     RETURNING id, username, email, created_at`,
    [username, email, passwordHash]
  );
  return result.rows[0];
}

export async function findUserByUsername(username) {
  const result = await query(
    `SELECT id, username, email, password_hash, created_at FROM users WHERE username = $1`,
    [username]
  );
  return result.rows[0];
}

export async function findUserByEmail(email) {
  const result = await query(
    `SELECT id, username, email, password_hash, created_at FROM users WHERE email = $1`,
    [email]
  );
  return result.rows[0];
}

export async function findUserById(id) {
  const result = await query(
    `SELECT id, username, email, created_at FROM users WHERE id = $1`,
    [id]
  );
  return result.rows[0];
}

export async function generateTokenPair(user) {
  const payload = { sub: user.id, username: user.username };
  const accessToken = signAccessToken(payload);
  const refreshToken = signRefreshToken(payload);
  await storeRefreshToken(user.id, refreshToken);
  return { accessToken, refreshToken };
}
