import { useEffect, useState } from 'react';
import { listSharedWithMe, requestDownload } from '../api/files.js';
import FileRow from './FileRow.jsx';

export default function SharedWithMeTab() {
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  async function reload() {
    setLoading(true);
    setError(null);
    try {
      const data = await listSharedWithMe();
      setFiles(data.files || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reload();
  }, []);

  async function onDownload(file) {
    try {
      const data = await requestDownload(file.id);
      window.open(data.url, '_blank', 'noopener');
    } catch (err) {
      alert(`Download failed: ${err.message}`);
    }
  }

  if (loading) {
    return (
      <div className="space-y-3">
        {[...Array(3)].map((_, i) => (
          <div key={i} className={`skeleton h-20 stagger-${i + 1} animate-fade-in`} />
        ))}
      </div>
    );
  }
  if (error) return <div className="card p-4 text-rose-400">Error: {error}</div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-display font-semibold">Shared With Me</h2>
        <span className="text-sm text-slate-500">{files.length} file{files.length === 1 ? '' : 's'}</span>
      </div>

      {files.length === 0 ? (
        <div className="card p-12 text-center animate-scale-in">
          <div className="text-6xl mb-4 inline-block animate-float">🤝</div>
          <div className="text-xl font-display font-semibold text-white mb-2">Nothing shared yet</div>
          <div className="text-slate-400 text-sm">When friends share files with you, they'll show up here</div>
        </div>
      ) : (
        <div className="space-y-2">
          {files.map((f, i) => (
            <div key={f.id} className={`animate-slide-up stagger-${Math.min(i + 1, 10)}`}>
              <FileRow
                file={f}
                ownerLabel={f.ownerUsername}
                onDownload={() => onDownload(f)}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
