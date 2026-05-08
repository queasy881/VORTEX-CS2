import { formatBytes, formatRelativeTime } from '../utils/format.js';

export default function FileRow({ file, showOwnerActions, ownerLabel, onDownload, onShare, onDelete }) {
  const ratio = file.savedPercent || 0;
  const ratioColor = ratio >= 70 ? 'text-emerald-400' : ratio >= 40 ? 'text-yellow-400' : 'text-slate-400';

  return (
    <div className="card p-4 flex items-center gap-4 hover:border-slate-700 transition">
      <div className="text-3xl">📄</div>
      <div className="flex-1 min-w-0">
        <div className="font-medium truncate">{file.filename}</div>
        <div className="text-xs text-slate-400 mt-1 flex items-center gap-3 flex-wrap">
          <span>
            <span className="text-slate-500">Original:</span> {formatBytes(file.originalSize)}
          </span>
          <span>
            <span className="text-slate-500">Compressed:</span> {formatBytes(file.compressedSize)}
          </span>
          <span className={ratioColor}>
            ↓ {ratio.toFixed(1)}% saved
          </span>
          {ownerLabel && (
            <span>
              <span className="text-slate-500">From:</span> <span className="text-brand-400">{ownerLabel}</span>
            </span>
          )}
          <span className="text-slate-500">{formatRelativeTime(file.createdAt)}</span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button onClick={onDownload} className="btn-secondary text-sm">
          Download
        </button>
        {showOwnerActions && (
          <>
            <button onClick={onShare} className="btn-secondary text-sm">
              Share
            </button>
            <button onClick={onDelete} className="btn-danger text-sm">
              Delete
            </button>
          </>
        )}
      </div>
    </div>
  );
}
