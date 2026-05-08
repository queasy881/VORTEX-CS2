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
    try {
      await acceptRequest(id);
      await reload();
    } catch (err) {
      alert(err.message);
    }
  }

  async function reject(id) {
    try {
      await rejectRequest(id);
      await reload();
    } catch (err) {
      alert(err.message);
    }
  }

  async function remove(userId, username) {
    if (!confirm(`Remove ${username} from friends?`)) return;
    try {
      await removeFriend(userId);
      await reload();
    } catch (err) {
      alert(err.message);
    }
  }

  if (loading) return <div className="text-slate-400">Loading…</div>;
  if (error) return <div className="text-red-400">Error: {error}</div>;

  return (
    <div className="space-y-6">
      <section className="card p-4">
        <h2 className="text-lg font-semibold mb-3">Find friends</h2>
        <input
          type="text"
          placeholder="Search by username…"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="input"
        />
        {searchResults.length > 0 && (
          <div className="mt-3 space-y-1">
            {searchResults.map((u) => (
              <div key={u.id} className="flex items-center justify-between bg-slate-800 px-3 py-2 rounded">
                <span>{u.username}</span>
                <button onClick={() => send(u.username)} className="btn-primary text-xs py-1 px-3">
                  Send request
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {incoming.length > 0 && (
        <section className="card p-4">
          <h2 className="text-lg font-semibold mb-3">Incoming requests</h2>
          <div className="space-y-2">
            {incoming.map((req) => (
              <div key={req.friendship_id} className="flex items-center justify-between bg-slate-800 p-3 rounded">
                <div>
                  <div className="font-medium">{req.username}</div>
                  <div className="text-xs text-slate-400">{req.email}</div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => accept(req.friendship_id)} className="btn-primary text-sm">
                    Accept
                  </button>
                  <button onClick={() => reject(req.friendship_id)} className="btn-secondary text-sm">
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {outgoing.length > 0 && (
        <section className="card p-4">
          <h2 className="text-lg font-semibold mb-3">Pending sent requests</h2>
          <div className="space-y-2">
            {outgoing.map((req) => (
              <div key={req.friendship_id} className="flex items-center justify-between bg-slate-800 p-3 rounded">
                <div>
                  <div className="font-medium">{req.username}</div>
                  <div className="text-xs text-slate-400">awaiting response</div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="card p-4">
        <h2 className="text-lg font-semibold mb-3">Your friends ({friends.length})</h2>
        {friends.length === 0 ? (
          <div className="text-slate-500 text-center py-6">No friends yet. Search above to find some.</div>
        ) : (
          <div className="space-y-2">
            {friends.map((f) => (
              <div key={f.id} className="flex items-center justify-between bg-slate-800 p-3 rounded">
                <div>
                  <div className="font-medium">{f.username}</div>
                  <div className="text-xs text-slate-400">{f.email}</div>
                </div>
                <button onClick={() => remove(f.id, f.username)} className="btn-danger text-sm">
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
