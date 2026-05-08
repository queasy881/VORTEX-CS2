import { formatBytes, formatRelativeTime } from '../utils/format.js';

function getFileIcon(mimeType, filename) {
  const ext = (filename || '').split('.').pop()?.toLowerCase();
  if (mimeType?.startsWith('video/') || ['mp4', 'mov', 'avi', 'mkv', 'webm'].includes(ext)) {
    return { icon: '🎬', color: 'from-rose-500 to-orange-500' };
  }
  if (mimeType?.startsWith('audio/') || ['mp3', 'wav', 'flac', 'opus', 'aac'].includes(ext)) {
    return { icon: '🎵', color: 'from-violet-500 to-pink-500' };
  }
  if (mimeType?.startsWith('image/') || ['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext)) {
    return { icon: '🖼️', color: 'from-emerald-500 to-cyan-500' };
  }
  if (mimeType?.includes('pdf') || ext === 'pdf') {
    return { icon: '📄', color: 'from-rose-500 to-violet-500' };
  }
  if (['zip', '7z', 'tar', 'gz', 'rar'].includes(ext)) {
    return { icon: '🗜️', color: 'from-amber-500 to-rose-500' };
  }
  return { icon: '📦', color: 'from-violet-500 to-cyan-500' };
}

export default function FileRow({ file, showOwnerActions, ownerLabel, onDownload, onShare, onDelete }) {
  const ratio = file.savedPercent || 0;
  const ratioBadge = ratio >= 70 ? 'badge-emerald' : ratio >= 40 ? 'badge-cyan' : ratio >= 10 ? 'badge-violet' : 'badge-rose';
  const { icon, color } = getFileIcon(file.mimeType, file.filename);

  return (
    <div className="card-hover p-4 flex items-center gap-4 group">
      <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${color} flex items-center justify-center text-2xl shadow-lg shadow-black/30 transition-transform duration-300 group-hover:scale-110 group-hover:rotate-3`}>
        <span className="drop-shadow">{icon}</span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-white truncate flex items-center gap-2">
          {file.filename}
          {ownerLabel && (
            <span className="badge badge-cyan text-[10px]">@{ownerLabel}</span>
          )}
        </div>
        <div className="text-xs text-slate-400 mt-1.5 flex items-center gap-3 flex-wrap">
          <span className="flex items-center gap-1">
            <span className="text-slate-600">orig</span>
            <span className="text-slate-300 font-mono">{formatBytes(file.originalSize)}</span>
          </span>
          <span className="text-slate-700">→</span>
          <span className="flex items-center gap-1">
            <span className="text-slate-600">crushed</span>
            <span className="text-white font-mono font-semibold">{formatBytes(file.compressedSize)}</span>
          </span>
          <span className={`badge ${ratioBadge}`}>
            ↓ {ratio.toFixed(1)}% saved
          </span>
          <span className="text-slate-600 text-[10px]">{formatRelativeTime(file.createdAt)}</span>
        </div>
      </div>
      <div className="flex items-center gap-2 opacity-80 group-hover:opacity-100 transition-opacity">
        <button onClick={onDownload} className="btn-secondary text-sm py-2 px-4" title="Download">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
        </button>
        {showOwnerActions && (
          <>
            <button onClick={onShare} className="btn-secondary text-sm py-2 px-4" title="Share">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
              </svg>
            </button>
            <button onClick={onDelete} className="btn-danger text-sm py-2 px-4" title="Delete">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          </>
        )}
      </div>
    </div>
  );
}
