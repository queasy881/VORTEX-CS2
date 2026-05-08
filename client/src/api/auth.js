import { apiJson } from '../utils/api.js';

export async function signup({ username, email, password }) {
  return apiJson('/api/auth/signup', {
    method: 'POST',
    body: JSON.stringify({ username, email, password }),
  });
}

export async function login({ username, password }) {
  return apiJson('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
}

export async function logout(refreshToken) {
  return apiJson('/api/auth/logout', {
    method: 'POST',
    body: JSON.stringify({ refreshToken }),
  });
}
