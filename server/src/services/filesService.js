import crypto from 'node:crypto';
import { query } from '../db/pool.js';
import { uploadStreamToR2, generateSignedDownloadUrl, deleteR2Object } from './r2Client.js';
import { config } from '../utils/config.js';
import { areFriends } from './friendsService.js';

export function generateR2Key(userId, filename) {
  const random = crypto.randomBytes(8).toString('hex');
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
  return `${userId}/${Date.now()}-${random}-${safeName}.7z`;
}

export async function persistFileMetadata({
  ownerId,
  filename,
  r2Key,
  originalSize,
  compressedSize,
  mimeType,
}) {
  const result = await query(
    `INSERT INTO files (owner_id, filename, r2_key, original_size_bytes, compressed_size_bytes, mime_type)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, owner_id, filename, r2_key, original_size_bytes, compressed_size_bytes, mime_type, created_at`,
    [ownerId, filename, r2Key, originalSize, compressedSize, mimeType || null]
  );
  return result.rows[0];
}

export async function listFilesOwnedBy(userId) {
  const result = await query(
    `SELECT id, filename, original_size_bytes, compressed_size_bytes, mime_type, created_at
     FROM files
     WHERE owner_id = $1
     ORDER BY created_at DESC`,
    [userId]
  );
  return result.rows;
}

export async function listFilesSharedWith(userId) {
  const result = await query(
    `SELECT f.id, f.filename, f.original_size_bytes, f.compressed_size_bytes, f.mime_type, f.created_at,
            u.username AS owner_username, u.id AS owner_id, fs.shared_at
     FROM files f
     JOIN file_shares fs ON fs.file_id = f.id
     JOIN users u ON u.id = f.owner_id
     WHERE fs.shared_with_user_id = $1
     ORDER BY fs.shared_at DESC`,
    [userId]
  );
  return result.rows;
}

export async function findFileById(fileId) {
  const result = await query(
    `SELECT id, owner_id, filename, r2_key, original_size_bytes, compressed_size_bytes, mime_type, created_at
     FROM files WHERE id = $1`,
    [fileId]
  );
  return result.rows[0];
}

export async function userCanAccessFile(file, userId) {
  if (file.owner_id === userId) return true;
  const sharedResult = await query(
    `SELECT id FROM file_shares WHERE file_id = $1 AND shared_with_user_id = $2`,
    [file.id, userId]
  );
  return sharedResult.rowCount > 0;
}

export async function shareFileWithUser(fileId, ownerId, recipientId) {
  const file = await findFileById(fileId);
  if (!file) {
    return { error: 'file not found', status: 404 };
  }
  if (file.owner_id !== ownerId) {
    return { error: 'only the owner may share this file', status: 403 };
  }
  if (recipientId === ownerId) {
    return { error: 'cannot share with yourself', status: 400 };
  }

  const friend = await areFriends(ownerId, recipientId);
  if (!friend) {
    return { error: 'recipient must be a friend', status: 403 };
  }

  const result = await query(
    `INSERT INTO file_shares (file_id, shared_with_user_id)
     VALUES ($1, $2)
     ON CONFLICT (file_id, shared_with_user_id) DO NOTHING
     RETURNING id, file_id, shared_with_user_id, shared_at`,
    [fileId, recipientId]
  );
  if (result.rowCount === 0) {
    return { error: 'already shared with this user', status: 409 };
  }
  return { share: result.rows[0] };
}

export async function unshareFile(fileId, ownerId, recipientId) {
  const file = await findFileById(fileId);
  if (!file) {
    return { error: 'file not found', status: 404 };
  }
  if (file.owner_id !== ownerId) {
    return { error: 'only the owner may unshare', status: 403 };
  }
  const result = await query(
    `DELETE FROM file_shares WHERE file_id = $1 AND shared_with_user_id = $2 RETURNING id`,
    [fileId, recipientId]
  );
  if (result.rowCount === 0) {
    return { error: 'share not found', status: 404 };
  }
  return { ok: true };
}

export async function deleteFileById(fileId, ownerId) {
  const file = await findFileById(fileId);
  if (!file) {
    return { error: 'file not found', status: 404 };
  }
  if (file.owner_id !== ownerId) {
    return { error: 'only the owner may delete', status: 403 };
  }
  await deleteR2Object(file.r2_key);
  await query(`DELETE FROM files WHERE id = $1`, [fileId]);
  return { ok: true };
}

export async function generateDownloadUrl(file) {
  return generateSignedDownloadUrl(file.r2_key, config.signedUrlTtlSeconds);
}

export async function uploadCompressedToR2({ key, body, contentType }) {
  return uploadStreamToR2({ key, body, contentType });
}
