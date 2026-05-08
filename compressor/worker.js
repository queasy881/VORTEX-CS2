import express from 'express';
import { spawn } from 'node:child_process';
import { createWriteStream, createReadStream, statSync, existsSync } from 'node:fs';
import { mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || '3001', 10);
const TMP_BASE = process.env.TMP_BASE || '/tmp/compress';

const jobs = new Map();

const app = express();

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', activeJobs: jobs.size });
});

app.get('/status/:jobId', async (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: 'job not found' });
  }
  let statusFromFile = null;
  try {
    if (existsSync(job.statusFile)) {
      const txt = await readFile(job.statusFile, 'utf8');
      statusFromFile = JSON.parse(txt);
    }
  } catch (_err) {}

  res.json({
    jobId: job.id,
    stage: statusFromFile?.stage || job.stage,
    progress: statusFromFile?.progress ?? job.progress,
    bytesProcessed: job.bytesReceived,
    compressedSize: statusFromFile?.compressedSize || job.compressedSize || 0,
    eta: null,
  });
});

app.delete('/jobs/:jobId', async (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: 'job not found' });
  }
  if (job.process) {
    try {
      job.process.kill('SIGKILL');
    } catch (_err) {}
  }
  await cleanupJob(job);
  jobs.delete(req.params.jobId);
  res.status(204).send();
});

app.post('/compress', async (req, res) => {
  const jobId = req.headers['x-job-id'] || `job-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const originalSize = parseInt(req.headers['x-original-size'] || '0', 10);

  const workDir = join(TMP_BASE, jobId);
  const inputPath = join(workDir, 'input.bin');
  const outputPath = join(workDir, 'output.archive');
  const statusFile = join(workDir, 'status.json');

  try {
    await mkdir(workDir, { recursive: true });
  } catch (err) {
    return res.status(500).json({ error: 'failed to create work dir', details: err.message });
  }

  const job = {
    id: jobId,
    workDir,
    inputPath,
    outputPath,
    statusFile,
    stage: 'receiving',
    progress: 0,
    bytesReceived: 0,
    compressedSize: 0,
    process: null,
    originalSize,
  };
  jobs.set(jobId, job);

  const writer = createWriteStream(inputPath);
  req.on('data', (chunk) => {
    job.bytesReceived += chunk.length;
  });

  try {
    await pipeline(req, writer);
  } catch (err) {
    await cleanupJob(job);
    jobs.delete(jobId);
    if (!res.headersSent) {
      return res.status(500).json({ error: 'upload failed', details: err.message });
    }
    return;
  }

  try {
    await writeFile(statusFile, JSON.stringify({ stage: 'starting', progress: 0 }));
  } catch (_err) {}

  job.stage = 'compressing';

  const scriptPath = join(__dirname, 'compress.sh');
  const child = spawn('bash', [scriptPath, jobId, inputPath, outputPath, statusFile, workDir], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  job.process = child;

  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  let stdoutData = '';
  child.stdout.on('data', (chunk) => {
    stdoutData += chunk.toString();
  });

  const exitPromise = new Promise((resolve, reject) => {
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`compress.sh exited with code ${code}: ${stderr}`));
    });
    child.on('error', (err) => reject(err));
  });

  try {
    await exitPromise;
  } catch (err) {
    await cleanupJob(job);
    jobs.delete(jobId);
    if (!res.headersSent) {
      return res.status(500).json({ error: 'compression failed', details: err.message });
    }
    return;
  }

  if (!existsSync(outputPath)) {
    await cleanupJob(job);
    jobs.delete(jobId);
    if (!res.headersSent) {
      return res.status(500).json({ error: 'no output produced' });
    }
    return;
  }

  const stat = statSync(outputPath);
  job.compressedSize = stat.size;
  job.stage = 'done';
  job.progress = 100;

  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Length', String(stat.size));
  res.setHeader('X-Compressed-Size', String(stat.size));
  res.setHeader('X-Original-Size', String(originalSize || job.bytesReceived));
  res.setHeader('X-Job-Id', jobId);

  const reader = createReadStream(outputPath);
  reader.pipe(res);

  res.on('close', async () => {
    await cleanupJob(job);
    jobs.delete(jobId);
  });
});

async function cleanupJob(job) {
  try {
    await rm(job.workDir, { recursive: true, force: true });
  } catch (_err) {}
}

app.listen(PORT, () => {
  console.log(`[compressor] listening on port ${PORT}`);
});

process.on('SIGTERM', () => {
  for (const job of jobs.values()) {
    if (job.process) {
      try { job.process.kill('SIGKILL'); } catch (_err) {}
    }
  }
  process.exit(0);
});
