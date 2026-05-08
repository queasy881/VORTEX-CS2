import { useEffect, useState } from 'react';
import {
  listFriends,
  listPending,
  searchUsers,
  sendRequest,
  acceptRequest,
  rejectRequest,
  removeFriend,
} from '../api/friends.js';

function Avatar({ username, size = 'md' }) {
  const initial = (username || '?')[0].toUpperCase();
  const colors = ['from-violet-500 to-pink-500', 'from-cyan-500 to-blue-500', 'from-emerald-500 to-cyan-500', 'from-amber-500 to-rose-500', 'from-rose-500 to-violet-500'];
  const colorIdx = (username || '').split('').reduce((s, c) => s + c.charCodeAt(0), 0) % colors.length;
  const sizeClass = size === 'lg' ? 'w-12 h-12 text-lg' : 'w-10 h-10 text-base';
  return (
    <div className={`${sizeClass} rounded-xl bg-gradient-to-br ${colors[colorIdx]} flex items-center justify-center font-display font-bold text-white shadow-lg shadow-black/30 flex-shrink-0`}>
      {initial}
    </div>
  );
}

export default function FriendsTab() {
  const [friends, setFriends] = useState([]);
  const [incoming, setIncoming] = useState([]);
  const [outgoing, setOutgoing] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  async function reload() {
    setLoading(true);
    setError(null);
    try {
      const [f, p] = await Promise.all([listFriends(), listPending()]);
      setFriends(f.friends || []);
      setIncoming(p.incoming || []);
      setOutgoing(p.outgoing || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reload();
  }, []);

  useEffect(() => {
    if (!searchTerm.trim()) {
      setSearchResults([]);
      return;
    }
    const handle = setTimeout(async () => {
      try {
        const data = await searchUsers(searchTerm.trim());
        setSearchResults(data.users || []);
      } catch (_err) {
        setSearchResults([]);
      }
    }, 250);
    return () => clearTimeout(handle);
  }, [searchTerm]);

  async function send(username) {
    try {
      await sendRequest(username);
      setSearchTerm('');
      setSearchResults([]);
      await reload();
    } catch (err) {
      alert(`Request failed: ${err.message}`);
    }
  }

  async function accept(id) {
    try { await acceptRequest(id); await reload(); }
    catch (err) { alert(err.message); }
  }

  async function reject(id) {
    try { await rejectRequest(id); await reload(); }
    catch (err) { alert(err.message); }
  }

  async function remove(userId, username) {
    if (!confirm(`Remove ${username} from friends?`)) return;
    try { await removeFriend(userId); await reload(); }
    catch (err) { alert(err.message); }
  }

  if (loading) {
    return (
      <div className="space-y-3">
        {[...Array(3)].map((_, i) => (
          <div key={i} className={`skeleton h-32 stagger-${i + 1} animate-fade-in`} />
        ))}
      </div>
    );
  }
  if (error) return <div className="card p-4 text-rose-400">Error: {error}</div>;

  return (
    <div className="space-y-6">
      <section className="card p-5 animate-slide-up">
        <h2 className="text-lg font-display font-semibold mb-3 flex items-center gap-2">
          <svg className="w-5 h-5 text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          Find friends
        </h2>
        <input
          type="text"
          placeholder="Search by username…"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="input"
        />
        {searchResults.length > 0 && (
          <div className="mt-3 space-y-2 animate-fade-in">
            {searchResults.map((u, i) => (
              <div key={u.id} className={`flex items-center justify-between bg-black/30 hover:bg-black/50 transition-colors px-3 py-2.5 rounded-lg animate-slide-up stagger-${Math.min(i + 1, 10)}`}>
                <div className="flex items-center gap-3">
                  <Avatar username={u.username} />
                  <span className="font-medium">{u.username}</span>
                </div>
                <button onClick={() => send(u.username)} className="btn-primary text-xs py-1.5 px-3">
                  + Send request
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {incoming.length > 0 && (
        <section className="card p-5 animate-slide-up">
          <h2 className="text-lg font-display font-semibold mb-3 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-violet-500 glow-dot" />
            Incoming requests
            <span className="badge badge-violet">{incoming.length}</span>
          </h2>
          <div className="space-y-2">
            {incoming.map((req, i) => (
              <div key={req.friendship_id} className={`flex items-center justify-between bg-black/30 p-3 rounded-lg animate-slide-up stagger-${Math.min(i + 1, 10)}`}>
                <div className="flex items-center gap-3">
                  <Avatar username={req.username} />
                  <div>
                    <div className="font-semibold">{req.username}</div>
                    <div className="text-xs text-slate-500">{req.email}</div>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => accept(req.friendship_id)} className="btn-primary text-sm py-2 px-4">Accept</button>
                  <button onClick={() => reject(req.friendship_id)} className="btn-secondary text-sm py-2 px-4">Reject</button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {outgoing.length > 0 && (
        <section className="card p-5 animate-slide-up">
          <h2 className="text-lg font-display font-semibold mb-3 text-slate-400">Pending sent</h2>
          <div className="space-y-2">
            {outgoing.map((req) => (
              <div key={req.friendship_id} className="flex items-center gap-3 bg-black/20 p-3 rounded-lg">
                <Avatar username={req.username} />
                <div className="flex-1">
                  <div className="font-medium">{req.username}</div>
                  <div className="text-xs text-slate-500 flex items-center gap-1">
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                    awaiting response
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="card p-5 animate-slide-up">
        <h2 className="text-lg font-display font-semibold mb-3 flex items-center gap-2">
          <svg className="w-5 h-5 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
          </svg>
          Your friends
          <span className="badge badge-cyan">{friends.length}</span>
        </h2>
        {friends.length === 0 ? (
          <div className="text-center py-8">
            <div className="text-4xl mb-2 inline-block animate-float">👥</div>
            <div className="text-slate-400 text-sm">No friends yet — search above to find some</div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {friends.map((f, i) => (
              <div key={f.id} className={`flex items-center justify-between bg-black/30 p-3 rounded-lg group hover:bg-black/50 transition-colors animate-slide-up stagger-${Math.min(i + 1, 10)}`}>
                <div className="flex items-center gap-3">
                  <Avatar username={f.username} />
                  <div>
                    <div className="font-semibold">{f.username}</div>
                    <div className="text-xs text-slate-500">{f.email}</div>
                  </div>
                </div>
                <button onClick={() => remove(f.id, f.username)} className="text-rose-400 hover:text-rose-300 opacity-0 group-hover:opacity-100 transition-opacity text-sm font-semibold px-2">
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
