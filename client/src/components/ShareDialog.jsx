import { useState } from 'react';

export default function ShareDialog({ file, friends, onClose, onShare }) {
  const [selected, setSelected] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    if (!selected) return;
    setSubmitting(true);
    try {
      await onShare(selected);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-4">
      <div className="card w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold">Share file</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-2xl leading-none">×</button>
        </div>
        <div className="text-slate-300 mb-4 text-sm">
          Sharing <span className="text-brand-400 font-medium">{file.filename}</span>
        </div>

        {friends.length === 0 ? (
          <div className="text-slate-500 text-center py-6">
            You have no friends yet. Add some from the Friends tab first.
          </div>
        ) : (
          <div className="space-y-1 max-h-72 overflow-y-auto">
            {friends.map((friend) => (
              <button
                key={friend.id}
                onClick={() => setSelected(friend.id)}
                className={`w-full text-left p-3 rounded-md transition ${
                  selected === friend.id
                    ? 'bg-brand-600 text-white'
                    : 'bg-slate-800 hover:bg-slate-700 text-slate-200'
                }`}
              >
                <div className="font-medium">{friend.username}</div>
                <div className="text-xs opacity-70">{friend.email}</div>
              </button>
            ))}
          </div>
        )}

        <div className="flex justify-end gap-2 mt-6">
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button onClick={submit} disabled={!selected || submitting} className="btn-primary">
            {submitting ? 'Sharing…' : 'Share'}
          </button>
        </div>
      </div>
    </div>
  );
}
