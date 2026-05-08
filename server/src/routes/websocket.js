import { WebSocketServer } from 'ws';
import { verifyAccessToken } from '../services/authService.js';
import { jobManager } from '../services/jobManager.js';
import { logger } from '../utils/logger.js';

export function attachWebSocketServer(httpServer) {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const match = url.pathname.match(/^\/api\/upload\/([^/]+)$/);
    if (!match) {
      socket.destroy();
      return;
    }
    const jobId = match[1];
    const token = url.searchParams.get('token');
    if (!token) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    let payload;
    try {
      payload = verifyAccessToken(token);
    } catch (_err) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.userId = payload.sub;
      ws.jobId = jobId;
      handleConnection(ws);
    });
  });

  function handleConnection(ws) {
    const job = jobManager.get(ws.jobId);

    if (!job) {
      ws.send(JSON.stringify({ type: 'error', error: 'job not found' }));
      ws.close();
      return;
    }
    if (job.ownerId !== ws.userId) {
      ws.send(JSON.stringify({ type: 'error', error: 'access denied' }));
      ws.close();
      return;
    }

    ws.send(JSON.stringify({ type: 'snapshot', job: snapshot(job) }));

    const listener = (updatedJob) => {
      if (updatedJob.id !== ws.jobId) return;
      if (ws.readyState !== ws.OPEN) return;
      ws.send(JSON.stringify({ type: 'update', job: snapshot(updatedJob) }));
      if (updatedJob.stage === 'done' || updatedJob.stage === 'failed') {
        ws.close();
      }
    };

    jobManager.on('update', listener);

    ws.on('close', () => {
      jobManager.off('update', listener);
    });

    ws.on('error', (err) => {
      logger.warn('websocket error', { jobId: ws.jobId, error: err.message });
    });
  }

  return wss;
}

function snapshot(job) {
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
