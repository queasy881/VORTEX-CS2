import { useEffect, useState } from 'react';
import { listMyFiles, deleteFile, requestDownload, shareFile } from '../api/files.js';
import { listFriends } from '../api/friends.js';
import FileRow from './FileRow.jsx';
import ShareDialog from './ShareDialog.jsx';
import { formatBytes } from '../utils/format.js';

export default function MyFilesTab() {
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [shareTarget, setShareTarget] = useState(null);
  const [friends, setFriends] = useState([]);

  async function reload() {
    setLoading(true);
    setError(null);
    try {
      const data = await listMyFiles();
      setFiles(data.files || []);
      const friendsData = await listFriends();
      setFriends(friendsData.friends || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reload();
  }, []);

  async function onDelete(file) {
    if (!confirm(`Delete "${file.filename}"? This cannot be undone.`)) return;
    try {
      await deleteFile(file.id);
      setFiles((f) => f.filter((x) => x.id !== file.id));
    } catch (err) {
      alert(`Delete failed: ${err.message}`);
    }
  }

  async function onDownload(file) {
    try {
      const data = await requestDownload(file.id);
      window.open(data.url, '_blank', 'noopener');
    } catch (err) {
      alert(`Download failed: ${err.message}`);
    }
  }

  function onShare(file) {
    setShareTarget(file);
  }

  async function handleShareSubmit(friendUserId) {
    if (!shareTarget) return;
    try {
      await shareFile(shareTarget.id, friendUserId);
      setShareTarget(null);
    } catch (err) {
      alert(`Share failed: ${err.message}`);
    }
  }

  const totalOriginal = files.reduce((s, f) => s + (f.originalSize || 0), 0);
  const totalCompressed = files.reduce((s, f) => s + (f.compressedSize || 0), 0);
  const totalSaved = totalOriginal > 0 ? ((totalOriginal - totalCompressed) / totalOriginal) * 100 : 0;

  if (loading) {
    return (
      <div className="space-y-3">
        {[...Array(4)].map((_, i) => (
          <div key={i} className={`skeleton h-20 stagger-${i + 1} animate-fade-in`} />
        ))}
      </div>
    );
  }
  if (error) return <div className="card p-4 text-rose-400">Error: {error}</div>;

  return (
    <div className="space-y-6">
      {files.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 animate-slide-up">
          <StatCard label="Files" value={files.length} icon="📚" color="from-violet-500 to-violet-700" />
          <StatCard label="Storage saved" value={formatBytes(totalOriginal - totalCompressed)} icon="💾" color="from-cyan-500 to-cyan-700" />
          <StatCard label="Avg compression" value={`${totalSaved.toFixed(1)}%`} icon="🔥" color="from-emerald-500 to-emerald-700" />
        </div>
      )}

      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-display font-semibold">My Files</h2>
          <span className="text-sm text-slate-500">{files.length} file{files.length === 1 ? '' : 's'}</span>
        </div>

        {files.length === 0 ? (
          <div className="card p-12 text-center animate-scale-in">
            <div className="text-6xl mb-4 inline-block animate-float">📦</div>
            <div className="text-xl font-display font-semibold text-white mb-2">No files yet</div>
            <div className="text-slate-400 text-sm">Click <span className="text-violet-400 font-semibold">+ Upload</span> to crush your first file</div>
          </div>
        ) : (
          <div className="space-y-2">
            {files.map((f, i) => (
              <div key={f.id} className={`animate-slide-up stagger-${Math.min(i + 1, 10)}`}>
                <FileRow
                  file={f}
                  showOwnerActions
                  onDelete={() => onDelete(f)}
                  onDownload={() => onDownload(f)}
                  onShare={() => onShare(f)}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {shareTarget && (
        <ShareDialog
          file={shareTarget}
          friends={friends}
          onClose={() => setShareTarget(null)}
          onShare={handleShareSubmit}
        />
      )}
    </div>
  );
}

function StatCard({ label, value, icon, color }) {
  return (
    <div className="card-hover p-4 flex items-center gap-4">
      <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${color} flex items-center justify-center text-2xl shadow-lg`}>
        {icon}
      </div>
      <div>
        <div className="text-xs text-slate-500 uppercase tracking-wider">{label}</div>
        <div className="text-xl font-display font-bold text-white mt-0.5">{value}</div>
      </div>
    </div>
  );
}
