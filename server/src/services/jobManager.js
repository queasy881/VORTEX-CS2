import { EventEmitter } from 'node:events';

class JobManager extends EventEmitter {
  constructor() {
    super();
    this.jobs = new Map();
  }

  create(jobId, ownerId, filename, originalSize) {
    const job = {
      id: jobId,
      ownerId,
      filename,
      originalSize,
      compressedSize: 0,
      stage: 'queued',
      progress: 0,
      eta: null,
      bytesProcessed: 0,
      startedAt: Date.now(),
      finishedAt: null,
      error: null,
      result: null,
    };
    this.jobs.set(jobId, job);
    this.emit('update', job);
    return job;
  }

  update(jobId, patch) {
    const job = this.jobs.get(jobId);
    if (!job) return null;
    Object.assign(job, patch);
    this.emit('update', job);
    return job;
  }

  finish(jobId, result) {
    const job = this.jobs.get(jobId);
    if (!job) return null;
    job.stage = 'done';
    job.progress = 100;
    job.finishedAt = Date.now();
    job.result = result;
    this.emit('update', job);
    return job;
  }

  fail(jobId, error) {
    const job = this.jobs.get(jobId);
    if (!job) return null;
    job.stage = 'failed';
    job.error = error;
    job.finishedAt = Date.now();
    this.emit('update', job);
    return job;
  }

  get(jobId) {
    return this.jobs.get(jobId);
  }

  remove(jobId) {
    this.jobs.delete(jobId);
  }

  cleanup(olderThanMs = 60 * 60 * 1000) {
    const now = Date.now();
    for (const [id, job] of this.jobs.entries()) {
      if (job.finishedAt && now - job.finishedAt > olderThanMs) {
        this.jobs.delete(id);
      }
    }
  }
}

export const jobManager = new JobManager();

setInterval(() => jobManager.cleanup(), 10 * 60 * 1000).unref();
