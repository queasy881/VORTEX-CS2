import { useState } from 'react';

function Avatar({ username }) {
  const initial = (username || '?')[0].toUpperCase();
  const colors = ['from-violet-500 to-pink-500', 'from-cyan-500 to-blue-500', 'from-emerald-500 to-cyan-500', 'from-amber-500 to-rose-500', 'from-rose-500 to-violet-500'];
  const colorIdx = (username || '').split('').reduce((s, c) => s + c.charCodeAt(0), 0) % colors.length;
  return (
    <div className={`w-9 h-9 rounded-lg bg-gradient-to-br ${colors[colorIdx]} flex items-center justify-center font-display font-bold text-white shadow-md flex-shrink-0`}>
      {initial}
    </div>
  );
}

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md px-4 animate-fade-in">
      <div className="card-hover w-full max-w-md p-6 animate-scale-in relative overflow-hidden">
        <div className="absolute -top-20 -right-20 w-48 h-48 bg-violet-500/20 rounded-full blur-3xl pointer-events-none" />

        <div className="relative flex items-center justify-between mb-4">
          <h2 className="text-2xl font-display font-bold gradient-text">Share file</h2>
          <button onClick={onClose} className="btn-ghost text-2xl leading-none w-9 h-9 p-0 flex items-center justify-center">×</button>
        </div>

        <div className="relative bg-black/30 rounded-lg p-3 mb-4 flex items-center gap-3">
          <span className="text-xl">📦</span>
          <div className="text-sm text-slate-300 truncate">{file.filename}</div>
        </div>

        {friends.length === 0 ? (
          <div className="relative text-center py-8">
            <div className="text-4xl mb-2">👥</div>
            <div className="text-slate-400 text-sm">No friends yet — add some from the Friends tab first</div>
          </div>
        ) : (
          <div className="relative space-y-1.5 max-h-72 overflow-y-auto -mx-1 px-1">
            {friends.map((friend, i) => (
              <button
                key={friend.id}
                onClick={() => setSelected(friend.id)}
                className={`w-full text-left p-3 rounded-lg transition-all duration-200 flex items-center gap-3 animate-slide-up stagger-${Math.min(i + 1, 10)} ${
                  selected === friend.id
                    ? 'bg-grad-primary text-white shadow-glow-violet'
                    : 'bg-black/30 hover:bg-black/50 text-slate-200'
                }`}
              >
                <Avatar username={friend.username} />
                <div className="flex-1 min-w-0">
                  <div className="font-semibold truncate">{friend.username}</div>
                  <div className="text-xs opacity-70 truncate">{friend.email}</div>
                </div>
                {selected === friend.id && (
                  <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </button>
            ))}
          </div>
        )}

        <div className="relative flex justify-end gap-2 mt-6">
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button onClick={submit} disabled={!selected || submitting} className="btn-primary">
            {submitting ? 'Sharing…' : 'Share'}
          </button>
        </div>
      </div>
    </div>
  );
}
