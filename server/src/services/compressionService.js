import { config } from '../utils/config.js';

export async function startCompressionJob({ jobId, inputStream, contentType, originalSize }) {
  const url = `${config.compressorUrl}/compress`;
  const headers = {
    'Content-Type': contentType || 'application/octet-stream',
    'X-Job-Id': jobId,
  };
  if (originalSize) {
    headers['X-Original-Size'] = String(originalSize);
  }

  const response = await fetch(url, {
    method: 'POST',
    body: inputStream,
    headers,
    duplex: 'half',
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`compressor failed: ${response.status} ${text}`);
  }

  return {
    body: response.body,
    compressedSize: parseInt(response.headers.get('X-Compressed-Size') || '0', 10),
    originalSize: parseInt(response.headers.get('X-Original-Size') || '0', 10),
  };
}

export async function getJobStatus(jobId) {
  const response = await fetch(`${config.compressorUrl}/status/${jobId}`);
  if (!response.ok) {
    return null;
  }
  return response.json();
}

export async function cancelJob(jobId) {
  await fetch(`${config.compressorUrl}/jobs/${jobId}`, { method: 'DELETE' });
}
