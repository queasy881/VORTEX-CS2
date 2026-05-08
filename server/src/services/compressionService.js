import { spawn } from 'node:child_process';
import { createWriteStream, createReadStream, statSync, existsSync } from 'node:fs';
import { mkdir, rm, readFile } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from '../utils/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TMP_BASE = process.env.COMPRESSOR_TMP_DIR || '/tmp/compress';
const SCRIPT_PATH = process.env.COMPRESSOR_SCRIPT || join(__dirname, '../../tools/compress.sh');

const activeJobs = new Map();

export async function startCompressionJob({ jobId, inputStream, originalSize }) {
  const workDir = join(TMP_BASE, jobId);
  const inputPath = join(workDir, 'input.bin');
  const outputPath = join(workDir, 'output.archive');
  const statusFile = join(workDir, 'status.json');

  await mkdir(workDir, { recursive: true });

  let bytesReceived = 0;
  const writer = createWriteStream(inputPath);
  inputStream.on('data', (chunk) => {
    bytesReceived += chunk.length;
  });
  await pipeline(inputStream, writer);

  if (!existsSync(SCRIPT_PATH)) {
    await rm(workDir, { recursive: true, force: true });
    throw new Error(`compress.sh not found at ${SCRIPT_PATH}`);
  }

  const child = spawn('bash', [SCRIPT_PATH, jobId, inputPath, outputPath, statusFile, workDir], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  activeJobs.set(jobId, { workDir, child });

  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });
  child.stdout.on('data', () => {});

  try {
    await new Promise((resolve, reject) => {
      child.on('exit', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`compress.sh exited with code ${code}: ${stderr.slice(0, 500)}`));
      });
      child.on('error', reject);
    });
  } catch (err) {
    activeJobs.delete(jobId);
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
    throw err;
  }

  if (!existsSync(outputPath)) {
    activeJobs.delete(jobId);
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
    throw new Error('compression produced no output');
  }

  const stat = statSync(outputPath);
  const stream = createReadStream(outputPath);
  stream.on('close', async () => {
    activeJobs.delete(jobId);
    try {
      await rm(workDir, { recursive: true, force: true });
    } catch (_err) {}
  });

  logger.info('compression complete', {
    jobId,
    originalSize: bytesReceived,
    compressedSize: stat.size,
  });

  return {
    body: stream,
    compressedSize: stat.size,
    originalSize: bytesReceived || originalSize || 0,
  };
}

export async function getJobStatus(jobId) {
  const job = activeJobs.get(jobId);
  if (!job) return null;
  const statusFile = join(job.workDir, 'status.json');
  try {
    const text = await readFile(statusFile, 'utf8');
    return JSON.parse(text);
  } catch (_err) {
    return { stage: 'starting', progress: 0 };
  }
}

export async function cancelJob(jobId) {
  const job = activeJobs.get(jobId);
  if (!job) return;
  try {
    job.child.kill('SIGKILL');
  } catch (_err) {}
  try {
    await rm(job.workDir, { recursive: true, force: true });
  } catch (_err) {}
  activeJobs.delete(jobId);
}
