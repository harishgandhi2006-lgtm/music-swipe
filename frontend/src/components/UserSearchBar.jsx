import { useState, useEffect, useRef } from 'react';
import { searchUsers, sendFriendRequest } from '../api.js';

export default function UserSearchBar({ onViewProfile }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [sentRequests, setSentRequests] = useState(new Set());
  const debounceRef = useRef(null);

  useEffect(() => {
    if (query.trim().length < 2) { setResults([]); return; }
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const data = await searchUsers(query.trim());
        setResults(data);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 350);
    return () => clearTimeout(debounceRef.current);
  }, [query]);

  async function handleAdd(user) {
    setSentRequests(prev => new Set([...prev, user.id]));
    await sendFriendRequest(user.id).catch(console.error);
  }

  function statusLabel(user) {
    if (sentRequests.has(user.id)) return { label: '✓ Sent', disabled: true, cls: 'text-green-400' };
    if (user.friendshipStatus === 'accepted') return { label: 'Friends', disabled: true, cls: 'text-green-400' };
    if (user.friendshipStatus === 'pending' && user.isRequester) return { label: 'Pending', disabled: true, cls: 'text-white/40' };
    if (user.friendshipStatus === 'pending') return { label: 'Accept', disabled: false, cls: 'text-blue-400' };
    return { label: '+ Add', disabled: false, cls: 'text-white/60' };
  }

  return (
    <div>
      {/* Search input */}
      <div className="relative">
        <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/30 w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <input
          type="text"
          placeholder="Search by username..."
          value={query}
          onChange={e => setQuery(e.target.value)}
          className="w-full bg-white/10 text-white placeholder-white/30 rounded-xl pl-10 pr-4 py-2.5 outline-none focus:ring-2 focus:ring-white/20 text-sm"
        />
        {loading && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
        )}
      </div>

      {/* Results */}
      {results.length > 0 && (
        <div className="mt-2 flex flex-col gap-2">
          {results.map(user => {
            const { label, disabled, cls } = statusLabel(user);
            return (
              <div key={user.id} className="flex items-center gap-3 px-3 py-2.5 bg-white/5 rounded-xl">
                <button onClick={() => onViewProfile?.(user.id)} className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center text-white font-bold text-sm shrink-0 hover:opacity-80 transition">
                  {user.username[0].toUpperCase()}
                </button>
                <button onClick={() => onViewProfile?.(user.id)} className="flex-1 text-white text-sm font-medium hover:underline text-left truncate">
                  {user.username}
                </button>
                <button
                  disabled={disabled}
                  onClick={() => !disabled && handleAdd(user)}
                  className={`text-xs font-semibold transition ${cls} ${disabled ? 'cursor-default' : 'hover:opacity-80'}`}
                >
                  {label}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
