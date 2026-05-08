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

  if (loading) return <div className="text-slate-400">Loading…</div>;
  if (error) return <div className="text-red-400">Error: {error}</div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">Shared With Me</h2>
        <span className="text-sm text-slate-400">{files.length} file{files.length === 1 ? '' : 's'}</span>
      </div>

      {files.length === 0 ? (
        <div className="card p-8 text-center text-slate-500">
          No friends have shared files with you yet.
        </div>
      ) : (
        <div className="space-y-2">
          {files.map((f) => (
            <FileRow
              key={f.id}
              file={f}
              ownerLabel={f.ownerUsername}
              onDownload={() => onDownload(f)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
