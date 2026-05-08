import { useEffect, useRef, useState } from 'react';
import { startUpload, openUploadSocket } from '../api/files.js';
import { formatBytes } from '../utils/format.js';

const STAGE_LABEL = {
  starting: 'Initializing',
  queued: 'Queued',
  receiving: 'Receiving',
  uploading: 'Streaming source',
  compressing: 'Compressing',
  extracting: 'Extracting',
  analyzing: 'Analyzing files',
  transcoding: 'Re-encoding media',
  archiving: 'Building archive',
  finalizing: 'Finalizing',
  done: 'Complete',
  failed: 'Failed',
};

const STAGE_ICON = {
  starting: '⚡',
  queued: '⏳',
  receiving: '📥',
  uploading: '⬆️',
  compressing: '🔥',
  extracting: '📦',
  analyzing: '🔍',
  transcoding: '🎬',
  archiving: '🗜️',
  finalizing: '✨',
  done: '✅',
  failed: '❌',
};

export default function UploadModal({ onClose, onComplete }) {
  const [file, setFile] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [job, setJob] = useState(null);
  const [error, setError] = useState(null);
  const [uploading, setUploading] = useState(false);
  const wsRef = useRef(null);

  useEffect(() => () => {
    if (wsRef.current) wsRef.current.close();
  }, []);

  function onPickFile(e) {
    const f = e.target.files?.[0];
    if (f) setFile(f);
  }

  function onDrop(e) {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) setFile(f);
  }

  async function start() {
    if (!file) return;
    setError(null);
    setUploading(true);

    const jobId = crypto.randomUUID();
    setJob({
      id: jobId,
      stage: 'starting',
      progress: 0,
      originalSize: file.size,
      compressedSize: 0,
    });

    const ws = openUploadSocket(jobId);
    wsRef.current = ws;
    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        if (msg.type === 'snapshot' || msg.type === 'update') {
          setJob(msg.job);
          if (msg.job.stage === 'done') {
            setUploading(false);
            setTimeout(() => onComplete(msg.job.result), 1500);
          }
          if (msg.job.stage === 'failed') {
            setUploading(false);
            setError(msg.job.error || 'compression failed');
          }
        }
        if (msg.type === 'error') {
          setError(msg.error);
        }
      } catch (_err) {}
    };
    ws.onerror = () => {};

    await new Promise((resolve) => {
      if (ws.readyState === WebSocket.OPEN) return resolve();
      ws.addEventListener('open', resolve, { once: true });
      setTimeout(resolve, 1500);
    });

    try {
      const result = await startUpload(file, jobId);
      if (result?.file) {
        setJob((prev) => ({
          ...(prev || {}),
          stage: 'done',
          progress: 100,
          compressedSize: result.file.compressedSize,
          result: result.file,
        }));
        setUploading(false);
        setTimeout(() => onComplete(result.file), 1500);
      }
    } catch (err) {
      setError(err.message);
      setUploading(false);
    }
  }

  const original = job?.originalSize || file?.size || 0;
  const compressed = job?.compressedSize || 0;
  const savedPercent = original > 0 && compressed > 0 ? ((original - compressed) / original) * 100 : 0;
  const isDone = job?.stage === 'done';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md px-4 animate-fade-in">
      <div className="card-hover w-full max-w-lg p-8 animate-scale-in relative overflow-hidden">
        <div className="absolute -top-24 -right-24 w-64 h-64 bg-violet-500/20 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -left-24 w-64 h-64 bg-cyan-500/20 rounded-full blur-3xl pointer-events-none" />

        <div className="relative flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl font-display font-bold gradient-text">Upload &amp; Crush</h2>
            <p className="text-xs text-slate-500 mt-1">Multi-stage compression pipeline</p>
          </div>
          <button onClick={onClose} className="btn-ghost text-2xl leading-none w-9 h-9 p-0 flex items-center justify-center">×</button>
        </div>

        {!job && (
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            className={`relative rounded-xl p-10 text-center cursor-pointer transition-all duration-300 ${
              dragOver
                ? 'bg-violet-500/10 ring-2 ring-violet-500/60 ring-offset-2 ring-offset-ink-950 scale-[1.02]'
                : 'bg-black/30 ring-1 ring-white/10 hover:ring-white/20 hover:bg-black/40'
            }`}
            style={{ borderStyle: 'dashed' }}
          >
            <input type="file" id="file-input" className="hidden" onChange={onPickFile} />
            <label htmlFor="file-input" className="cursor-pointer block">
              <div className={`mx-auto w-16 h-16 rounded-2xl bg-grad-primary flex items-center justify-center mb-4 shadow-glow-violet transition-transform duration-300 ${dragOver ? 'scale-110 animate-pulse-glow' : ''}`}>
                <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
              </div>
              {file ? (
                <div className="animate-scale-in">
                  <div className="font-semibold text-white text-lg">{file.name}</div>
                  <div className="text-sm text-slate-400 mt-1">{formatBytes(file.size)}</div>
                  <div className="badge badge-violet mt-3">Ready to crush</div>
                </div>
              ) : (
                <div>
                  <div className="font-semibold text-white text-lg">Drop a file here</div>
                  <div className="text-sm text-slate-500 mt-1">or click to browse — videos, images, archives, anything</div>
                </div>
              )}
            </label>
          </div>
        )}

        {job && (
          <div className="relative space-y-5 animate-fade-in">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className={`text-2xl ${!isDone ? 'animate-pulse' : ''}`}>{STAGE_ICON[job.stage] || '⚙️'}</span>
                <div>
                  <div className="font-semibold text-white">{STAGE_LABEL[job.stage] || job.stage}</div>
                  <div className="text-xs text-slate-500">
                    {isDone ? 'All done — saving to your library' : 'Pipeline running…'}
                  </div>
                </div>
              </div>
              <div className="text-2xl font-display font-bold gradient-text">
                {Math.round(job.progress || 0)}%
              </div>
            </div>

            <div className="progress-track h-3">
              <div className="progress-fill" style={{ width: `${Math.max(2, job.progress || 0)}%` }} />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="card p-3 text-center">
                <div className="text-[10px] text-slate-500 uppercase tracking-widest mb-1">Original</div>
                <div className="font-bold text-white">{formatBytes(original)}</div>
              </div>
              <div className="card p-3 text-center">
                <div className="text-[10px] text-slate-500 uppercase tracking-widest mb-1">Compressed</div>
                <div className="font-bold text-white">{compressed > 0 ? formatBytes(compressed) : '—'}</div>
              </div>
              <div className="card p-3 text-center">
                <div className="text-[10px] text-slate-500 uppercase tracking-widest mb-1">Saved</div>
                <div className={`font-bold ${savedPercent > 0 ? 'gradient-text' : 'text-slate-600'}`}>
                  {savedPercent > 0 ? `${savedPercent.toFixed(1)}%` : '—'}
                </div>
              </div>
            </div>

            {isDone && (
              <div className="animate-scale-in p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-200 text-sm flex items-center gap-3">
                <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                <span>Crushed and stored. Closing in a moment…</span>
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="relative animate-scale-in flex items-start gap-2 p-3 mt-4 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-200 text-sm">
            <svg className="w-5 h-5 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span className="break-all">{error}</span>
          </div>
        )}

        <div className="relative flex justify-end gap-2 mt-6">
          <button onClick={onClose} className="btn-secondary">
            {isDone ? 'Close' : 'Cancel'}
          </button>
          {!job && (
            <button onClick={start} disabled={!file || uploading} className="btn-primary">
              {uploading ? 'Starting…' : 'Crush it'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
