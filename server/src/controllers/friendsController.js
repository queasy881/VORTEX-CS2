import {
  listAcceptedFriends,
  listPendingRequests,
  listOutgoingRequests,
  sendFriendRequest,
  acceptFriendRequest,
  rejectFriendRequest,
  removeFriend,
  searchUsers,
} from '../services/friendsService.js';

export async function getFriends(req, res) {
  const friends = await listAcceptedFriends(req.user.id);
  res.json({ friends });
}

export async function getPending(req, res) {
  const incoming = await listPendingRequests(req.user.id);
  const outgoing = await listOutgoingRequests(req.user.id);
  res.json({ incoming, outgoing });
}

export async function postRequest(req, res) {
  const { username } = req.body || {};
  if (!username) {
    return res.status(400).json({ error: 'username required' });
  }
  const result = await sendFriendRequest(req.user.id, username);
  if (result.error) {
    return res.status(result.status).json({ error: result.error });
  }
  res.status(201).json({ friendship: result.friendship });
}

export async function postAccept(req, res) {
  const result = await acceptFriendRequest(req.user.id, req.params.friendshipId);
  if (result.error) {
    return res.status(result.status).json({ error: result.error });
  }
  res.json({ friendship: result.friendship });
}

export async function postReject(req, res) {
  const result = await rejectFriendRequest(req.user.id, req.params.friendshipId);
  if (result.error) {
    return res.status(result.status).json({ error: result.error });
  }
  res.status(204).send();
}

export async function deleteFriend(req, res) {
  const result = await removeFriend(req.user.id, req.params.userId);
  if (result.error) {
    return res.status(result.status).json({ error: result.error });
  }
  res.status(204).send();
}

export async function getUserSearch(req, res) {
  const q = (req.query.q || '').toString().trim();
  if (q.length < 1) {
    return res.json({ users: [] });
  }
  const users = await searchUsers(q, req.user.id);
  res.json({ users });
}
