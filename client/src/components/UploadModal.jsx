import { useEffect, useRef, useState } from 'react';
import { startUpload, openUploadSocket } from '../api/files.js';
import { formatBytes } from '../utils/format.js';

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
            setTimeout(() => onComplete(msg.job.result), 1200);
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
        setTimeout(() => onComplete(result.file), 1200);
      }
    } catch (err) {
      setError(err.message);
      setUploading(false);
    }
  }

  const stageLabel = {
    queued: 'Queued',
    receiving: 'Receiving',
    uploading: 'Uploading source',
    compressing: 'Compressing',
    extracting: 'Extracting',
    analyzing: 'Analyzing files',
    transcoding: 'Re-encoding media',
    archiving: 'Building archive',
    finalizing: 'Finalizing',
    done: 'Complete',
    failed: 'Failed',
  };

  const original = job?.originalSize || file?.size || 0;
  const compressed = job?.compressedSize || 0;
  const savedPercent = original > 0 && compressed > 0 ? ((original - compressed) / original) * 100 : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-4">
      <div className="card w-full max-w-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold">Upload &amp; compress</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-2xl leading-none">
            ×
          </button>
        </div>

        {!job && (
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition ${
              dragOver ? 'border-brand-500 bg-brand-500/10' : 'border-slate-700 hover:border-slate-600'
            }`}
          >
            <input
              type="file"
              id="file-input"
              className="hidden"
              onChange={onPickFile}
            />
            <label htmlFor="file-input" className="cursor-pointer block">
              <div className="text-4xl mb-2">📦</div>
              {file ? (
                <div>
                  <div className="font-medium text-white">{file.name}</div>
                  <div className="text-sm text-slate-400">{formatBytes(file.size)}</div>
                </div>
              ) : (
                <div>
                  <div className="font-medium text-slate-200">Drop a file or zipped folder here</div>
                  <div className="text-sm text-slate-500 mt-1">or click to browse</div>
                </div>
              )}
            </label>
          </div>
        )}

        {job && (
          <div className="space-y-3">
            <div className="text-sm text-slate-400">{stageLabel[job.stage] || job.stage}</div>
            <div className="w-full bg-slate-800 rounded-full h-3 overflow-hidden">
              <div
                className="bg-brand-500 h-3 transition-all duration-300"
                style={{ width: `${Math.max(2, job.progress || 0)}%` }}
              />
            </div>
            <div className="grid grid-cols-3 gap-3 text-center pt-2">
              <div>
                <div className="text-xs text-slate-500 uppercase">Original</div>
                <div className="font-semibold">{formatBytes(original)}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500 uppercase">Compressed</div>
                <div className="font-semibold">{compressed > 0 ? formatBytes(compressed) : '—'}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500 uppercase">Saved</div>
                <div className="font-semibold text-emerald-400">
                  {savedPercent > 0 ? `${savedPercent.toFixed(1)}%` : '—'}
                </div>
              </div>
            </div>
            {job.stage === 'done' && (
              <div className="bg-emerald-900/30 border border-emerald-800 text-emerald-200 px-3 py-2 rounded text-sm text-center">
                Upload complete!
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="bg-red-900/30 border border-red-800 text-red-200 px-3 py-2 rounded mt-4 text-sm">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2 mt-6">
          <button onClick={onClose} className="btn-secondary">
            {job?.stage === 'done' ? 'Close' : 'Cancel'}
          </button>
          {!job && (
            <button onClick={start} disabled={!file || uploading} className="btn-primary">
              {uploading ? 'Starting…' : 'Upload'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
