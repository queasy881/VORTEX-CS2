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
    let listener = null;
    let waitTimer = null;
    let waitListener = null;

    function attach(job) {
      if (job.ownerId !== ws.userId) {
        try { ws.send(JSON.stringify({ type: 'error', error: 'access denied' })); } catch (_e) {}
        ws.close();
        return;
      }
      try { ws.send(JSON.stringify({ type: 'snapshot', job: snapshot(job) })); } catch (_e) {}
      listener = (updatedJob) => {
        if (updatedJob.id !== ws.jobId) return;
        if (ws.readyState !== ws.OPEN) return;
        try { ws.send(JSON.stringify({ type: 'update', job: snapshot(updatedJob) })); } catch (_e) {}
        if (updatedJob.stage === 'done' || updatedJob.stage === 'failed') {
          setTimeout(() => ws.close(), 250);
        }
      };
      jobManager.on('update', listener);
    }

    const existing = jobManager.get(ws.jobId);
    if (existing) {
      attach(existing);
    } else {
      waitListener = (job) => {
        if (job.id === ws.jobId) {
          jobManager.off('update', waitListener);
          waitListener = null;
          if (waitTimer) clearTimeout(waitTimer);
          attach(job);
        }
      };
      jobManager.on('update', waitListener);
      waitTimer = setTimeout(() => {
        if (waitListener) jobManager.off('update', waitListener);
        if (!jobManager.get(ws.jobId)) {
          try { ws.send(JSON.stringify({ type: 'error', error: 'job not found (timeout)' })); } catch (_e) {}
          ws.close();
        }
      }, 30000);
    }

    ws.on('close', () => {
      if (listener) jobManager.off('update', listener);
      if (waitListener) jobManager.off('update', waitListener);
      if (waitTimer) clearTimeout(waitTimer);
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
