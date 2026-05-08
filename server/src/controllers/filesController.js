import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { PassThrough } from 'node:stream';
import {
  listFilesOwnedBy,
  listFilesSharedWith,
  findFileById,
  userCanAccessFile,
  shareFileWithUser,
  unshareFile,
  deleteFileById,
  generateDownloadUrl,
  uploadCompressedToR2,
  persistFileMetadata,
  generateR2Key,
} from '../services/filesService.js';
import { startCompressionJob, getJobStatus, cancelJob } from '../services/compressionService.js';
import { jobManager } from '../services/jobManager.js';
import { logger } from '../utils/logger.js';
import { config } from '../utils/config.js';

export async function getMyFiles(req, res) {
  const files = await listFilesOwnedBy(req.user.id);
  res.json({ files: files.map(formatFile) });
}

export async function getSharedWithMe(req, res) {
  const files = await listFilesSharedWith(req.user.id);
  res.json({ files: files.map(formatSharedFile) });
}

export async function postShare(req, res) {
  const { friendUserId } = req.body || {};
  if (!friendUserId) {
    return res.status(400).json({ error: 'friendUserId required' });
  }
  const result = await shareFileWithUser(req.params.fileId, req.user.id, friendUserId);
  if (result.error) {
    return res.status(result.status).json({ error: result.error });
  }
  res.status(201).json({ share: result.share });
}

export async function deleteShare(req, res) {
  const result = await unshareFile(req.params.fileId, req.user.id, req.params.userId);
  if (result.error) {
    return res.status(result.status).json({ error: result.error });
  }
  res.status(204).send();
}

export async function getDownload(req, res) {
  const file = await findFileById(req.params.fileId);
  if (!file) {
    return res.status(404).json({ error: 'file not found' });
  }
  const allowed = await userCanAccessFile(file, req.user.id);
  if (!allowed) {
    return res.status(403).json({ error: 'access denied' });
  }
  const url = await generateDownloadUrl(file);
  res.json({
    url,
    filename: file.filename,
    expiresInSeconds: config.signedUrlTtlSeconds,
    originalSize: Number(file.original_size_bytes),
    compressedSize: Number(file.compressed_size_bytes),
  });
}

export async function deleteFile(req, res) {
  const result = await deleteFileById(req.params.fileId, req.user.id);
  if (result.error) {
    return res.status(result.status).json({ error: result.error });
  }
  res.status(204).send();
}

export async function postUpload(req, res) {
  const filename = req.headers['x-filename'] || `upload-${Date.now()}.bin`;
  const originalSize = parseInt(req.headers['content-length'] || '0', 10);
  const contentType = req.headers['content-type'] || 'application/octet-stream';
  const jobId = req.headers['x-job-id'] || crypto.randomUUID();
  const ownerId = req.user.id;

  jobManager.create(jobId, ownerId, filename, originalSize);

  const pollInterval = setInterval(async () => {
    try {
      const status = await getJobStatus(jobId);
      if (status) {
        jobManager.update(jobId, {
          stage: status.stage || 'compressing',
          progress: Math.min(95, status.progress || 5),
          bytesProcessed: status.bytesProcessed || 0,
          compressedSize: status.compressedSize || 0,
        });
      }
    } catch (_err) {}
  }, 700);

  try {
    jobManager.update(jobId, { stage: 'compressing', progress: 5 });

    const response = await startCompressionJob({
      jobId,
      inputStream: req,
      contentType,
      originalSize,
    });

    const compressedSize = response.compressedSize || 0;
    const trueOriginalSize = response.originalSize || originalSize;
    jobManager.update(jobId, { stage: 'uploading', progress: 95, compressedSize });

    const r2Key = generateR2Key(ownerId, filename);
    const passThrough = new PassThrough();
    let uploadedBytes = 0;
    passThrough.on('data', (chunk) => {
      uploadedBytes += chunk.length;
    });

    const uploadPromise = uploadCompressedToR2({
      key: r2Key,
      body: passThrough,
      contentType: 'application/x-7z-compressed',
    });

    await pipeline(response.body, passThrough);
    await uploadPromise;

    clearInterval(pollInterval);

    const finalCompressedSize = uploadedBytes || compressedSize;
    const file = await persistFileMetadata({
      ownerId,
      filename,
      r2Key,
      originalSize: trueOriginalSize,
      compressedSize: finalCompressedSize,
      mimeType: contentType,
    });

    jobManager.finish(jobId, formatFile(file));
    res.json({ jobId, file: formatFile(file) });
  } catch (err) {
    clearInterval(pollInterval);
    logger.error('upload pipeline failed', { jobId, error: err.message });
    jobManager.fail(jobId, err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message, jobId });
    }
  }
}

export async function getJobStatusHandler(req, res) {
  const job = jobManager.get(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: 'job not found' });
  }
  if (job.ownerId !== req.user.id) {
    return res.status(403).json({ error: 'access denied' });
  }
  res.json(formatJob(job));
}

export async function cancelJobHandler(req, res) {
  const job = jobManager.get(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: 'job not found' });
  }
  if (job.ownerId !== req.user.id) {
    return res.status(403).json({ error: 'access denied' });
  }
  await cancelJob(req.params.jobId);
  jobManager.fail(req.params.jobId, 'cancelled by user');
  res.status(204).send();
}

function formatFile(row) {
  const original = Number(row.original_size_bytes);
  const compressed = Number(row.compressed_size_bytes);
  const saved = original > 0 ? ((original - compressed) / original) * 100 : 0;
  return {
    id: row.id,
    filename: row.filename,
    originalSize: original,
    compressedSize: compressed,
    savedPercent: Math.round(saved * 10) / 10,
    mimeType: row.mime_type,
    createdAt: row.created_at,
  };
}

function formatSharedFile(row) {
  return {
    ...formatFile(row),
    ownerUsername: row.owner_username,
    ownerId: row.owner_id,
    sharedAt: row.shared_at,
  };
}

function formatJob(job) {
  return {
    id: job.id,
    stage: job.stage,
    progress: job.progress,
    eta: job.eta,
    originalSize: job.originalSize,
    compressedSize: job.compressedSize,
    bytesProcessed: job.bytesProcessed,
    error: job.error,
    result: job.result,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
  };
}
