import { apiJson } from '../utils/api.js';

export async function listFriends() {
  return apiJson('/api/friends');
}

export async function listPending() {
  return apiJson('/api/friends/pending');
}

export async function searchUsers(q) {
  return apiJson(`/api/friends/search?q=${encodeURIComponent(q)}`);
}

export async function sendRequest(username) {
  return apiJson('/api/friends/request', {
    method: 'POST',
    body: JSON.stringify({ username }),
  });
}

export async function acceptRequest(friendshipId) {
  return apiJson(`/api/friends/accept/${friendshipId}`, { method: 'POST' });
}

export async function rejectRequest(friendshipId) {
  return apiJson(`/api/friends/reject/${friendshipId}`, { method: 'POST' });
}

export async function removeFriend(userId) {
  return apiJson(`/api/friends/${userId}`, { method: 'DELETE' });
}
