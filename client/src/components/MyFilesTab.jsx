import { useEffect, useState } from 'react';
import { listMyFiles, deleteFile, requestDownload, shareFile } from '../api/files.js';
import { listFriends } from '../api/friends.js';
import FileRow from './FileRow.jsx';
import ShareDialog from './ShareDialog.jsx';

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

  if (loading) return <div className="text-slate-400">Loading…</div>;
  if (error) return <div className="text-red-400">Error: {error}</div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">My Files</h2>
        <span className="text-sm text-slate-400">{files.length} file{files.length === 1 ? '' : 's'}</span>
      </div>

      {files.length === 0 ? (
        <div className="card p-8 text-center text-slate-500">
          No files yet. Click <span className="text-brand-400 font-medium">+ Upload</span> to add one.
        </div>
      ) : (
        <div className="space-y-2">
          {files.map((f) => (
            <FileRow
              key={f.id}
              file={f}
              showOwnerActions
              onDelete={() => onDelete(f)}
              onDownload={() => onDownload(f)}
              onShare={() => onShare(f)}
            />
          ))}
        </div>
      )}

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
