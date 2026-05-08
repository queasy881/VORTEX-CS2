import { apiJson, apiFetch, getAccessToken } from '../utils/api.js';

export async function listMyFiles() {
  return apiJson('/api/files/mine');
}

export async function listSharedWithMe() {
  return apiJson('/api/files/shared-with-me');
}

export async function shareFile(fileId, friendUserId) {
  return apiJson(`/api/files/${fileId}/share`, {
    method: 'POST',
    body: JSON.stringify({ friendUserId }),
  });
}

export async function unshareFile(fileId, userId) {
  return apiJson(`/api/files/${fileId}/share/${userId}`, { method: 'DELETE' });
}

export async function deleteFile(fileId) {
  return apiJson(`/api/files/${fileId}`, { method: 'DELETE' });
}

export async function requestDownload(fileId) {
  return apiJson(`/api/files/${fileId}/download`);
}

export async function getJobStatus(jobId) {
  return apiJson(`/api/files/jobs/${jobId}`);
}

export async function cancelJob(jobId) {
  return apiJson(`/api/files/jobs/${jobId}`, { method: 'DELETE' });
}

export async function startUpload(file, onProgress) {
  const token = getAccessToken();
  const response = await fetch('/api/files/upload', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': file.type || 'application/octet-stream',
      'X-Filename': file.name,
      'Content-Length': String(file.size),
    },
    body: file,
    duplex: 'half',
  });
  if (!response.ok) {
    const txt = await response.text();
    throw new Error(`upload failed: ${response.status} ${txt}`);
  }
  return response.json();
}

export function openUploadSocket(jobId) {
  const token = getAccessToken();
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${proto}//${window.location.host}/api/upload/${jobId}?token=${encodeURIComponent(token)}`;
  return new WebSocket(url);
}
