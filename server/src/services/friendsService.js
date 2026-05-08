import { query } from '../db/pool.js';

export async function listAcceptedFriends(userId) {
  const result = await query(
    `SELECT u.id, u.username, u.email, f.id AS friendship_id, f.created_at
     FROM friendships f
     JOIN users u ON (
       (f.requester_id = $1 AND u.id = f.addressee_id) OR
       (f.addressee_id = $1 AND u.id = f.requester_id)
     )
     WHERE f.status = 'accepted'
     ORDER BY u.username ASC`,
    [userId]
  );
  return result.rows;
}

export async function listPendingRequests(userId) {
  const result = await query(
    `SELECT f.id AS friendship_id, u.id AS requester_id, u.username, u.email, f.created_at
     FROM friendships f
     JOIN users u ON u.id = f.requester_id
     WHERE f.addressee_id = $1 AND f.status = 'pending'
     ORDER BY f.created_at DESC`,
    [userId]
  );
  return result.rows;
}

export async function listOutgoingRequests(userId) {
  const result = await query(
    `SELECT f.id AS friendship_id, u.id AS addressee_id, u.username, u.email, f.created_at
     FROM friendships f
     JOIN users u ON u.id = f.addressee_id
     WHERE f.requester_id = $1 AND f.status = 'pending'
     ORDER BY f.created_at DESC`,
    [userId]
  );
  return result.rows;
}

export async function sendFriendRequest(requesterId, addresseeUsername) {
  const userResult = await query(
    `SELECT id, username FROM users WHERE username = $1`,
    [addresseeUsername]
  );
  const addressee = userResult.rows[0];
  if (!addressee) {
    return { error: 'user not found', status: 404 };
  }
  if (addressee.id === requesterId) {
    return { error: 'cannot friend yourself', status: 400 };
  }

  const existing = await query(
    `SELECT id, status, requester_id, addressee_id FROM friendships
     WHERE (requester_id = $1 AND addressee_id = $2)
        OR (requester_id = $2 AND addressee_id = $1)`,
    [requesterId, addressee.id]
  );

  if (existing.rowCount > 0) {
    const row = existing.rows[0];
    if (row.status === 'accepted') {
      return { error: 'already friends', status: 409 };
    }
    if (row.status === 'pending') {
      return { error: 'request already pending', status: 409 };
    }
    if (row.status === 'blocked') {
      return { error: 'cannot send request', status: 403 };
    }
  }

  const insert = await query(
    `INSERT INTO friendships (requester_id, addressee_id, status)
     VALUES ($1, $2, 'pending')
     RETURNING id, requester_id, addressee_id, status, created_at`,
    [requesterId, addressee.id]
  );
  return { friendship: insert.rows[0] };
}

export async function acceptFriendRequest(userId, friendshipId) {
  const result = await query(
    `UPDATE friendships SET status = 'accepted'
     WHERE id = $1 AND addressee_id = $2 AND status = 'pending'
     RETURNING id, requester_id, addressee_id, status`,
    [friendshipId, userId]
  );
  if (result.rowCount === 0) {
    return { error: 'friendship request not found', status: 404 };
  }
  return { friendship: result.rows[0] };
}

export async function rejectFriendRequest(userId, friendshipId) {
  const result = await query(
    `DELETE FROM friendships
     WHERE id = $1 AND addressee_id = $2 AND status = 'pending'
     RETURNING id`,
    [friendshipId, userId]
  );
  if (result.rowCount === 0) {
    return { error: 'friendship request not found', status: 404 };
  }
  return { ok: true };
}

export async function removeFriend(userId, otherUserId) {
  const result = await query(
    `DELETE FROM friendships
     WHERE status = 'accepted' AND (
       (requester_id = $1 AND addressee_id = $2) OR
       (requester_id = $2 AND addressee_id = $1)
     )
     RETURNING id`,
    [userId, otherUserId]
  );
  if (result.rowCount === 0) {
    return { error: 'friendship not found', status: 404 };
  }
  return { ok: true };
}

export async function areFriends(userAId, userBId) {
  const result = await query(
    `SELECT id FROM friendships
     WHERE status = 'accepted' AND (
       (requester_id = $1 AND addressee_id = $2) OR
       (requester_id = $2 AND addressee_id = $1)
     )`,
    [userAId, userBId]
  );
  return result.rowCount > 0;
}

export async function searchUsers(query_str, currentUserId, limit = 20) {
  const result = await query(
    `SELECT id, username FROM users
     WHERE username ILIKE $1 AND id != $2
     ORDER BY username ASC
     LIMIT $3`,
    [`%${query_str}%`, currentUserId, limit]
  );
  return result.rows;
}
