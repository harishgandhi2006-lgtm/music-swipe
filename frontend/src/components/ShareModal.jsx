import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { fetchFriends, shareItem } from '../api.js';

/**
 * Share sheet for a track or an artist.
 * Pass `track` to share a song, or `artist` ({ id, name, cover_url }) to share
 * an artist. Exactly one of the two is expected.
 */
export default function ShareModal({ track, artist, onClose }) {
  const [friends, setFriends] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sent, setSent] = useState(new Set());
  const [failed, setFailed] = useState(new Set());

  const isArtist = !!artist && !track;
  const itemType = isArtist ? 'artist' : 'track';
  const itemId = isArtist ? artist.id : track?.id;

  const heading = isArtist ? 'Share an artist' : 'Share with a friend';
  const primary = isArtist ? artist.name : track?.title;
  const secondary = isArtist ? 'Artist' : track?.artist_name;
  const cover = isArtist ? artist.cover_url : track?.cover_url;

  useEffect(() => {
    fetchFriends()
      .then(setFriends)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  async function handleShare(friend) {
    const id = friend.friend_id;
    if (sent.has(id)) return;

    // Optimistic, but roll back and surface the failure if the request dies —
    // a silent no-op would look identical to a successful send.
    setSent(prev => new Set([...prev, id]));
    setFailed(prev => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });

    try {
      await shareItem(id, itemType, itemId);
    } catch {
      setSent(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      setFailed(prev => new Set([...prev, id]));
    }
  }

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50 flex items-end justify-center"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        {/* Backdrop */}
        <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

        {/* Sheet */}
        <motion.div
          className="relative w-full max-w-sm bg-[#1a1a1a] rounded-t-3xl overflow-hidden"
          initial={{ y: '100%' }}
          animate={{ y: 0 }}
          exit={{ y: '100%' }}
          transition={{ type: 'spring', damping: 30, stiffness: 300 }}
        >
          {/* Handle */}
          <div className="flex justify-center pt-3 pb-1">
            <div className="w-10 h-1 bg-white/20 rounded-full" />
          </div>

          {/* Header */}
          <div className="px-5 py-3 border-b border-white/10">
            <p className="text-white/40 text-xs uppercase tracking-widest mb-1">{heading}</p>
            <div className="flex items-center gap-3">
              <div
                className={`w-10 h-10 bg-cover bg-center bg-white/10 shrink-0 ${isArtist ? 'rounded-full' : 'rounded-lg'}`}
                style={cover ? { backgroundImage: `url(${cover})` } : undefined}
              />
              <div className="min-w-0">
                <p className="text-white font-semibold text-sm truncate">{primary}</p>
                <p className="text-white/50 text-xs truncate">{secondary}</p>
              </div>
            </div>
          </div>

          {/* Friend list */}
          <div className="max-h-72 overflow-y-auto">
            {loading && (
              <div className="flex justify-center py-10">
                <div className="w-6 h-6 border-2 border-white/20 border-t-white rounded-full animate-spin" />
              </div>
            )}
            {!loading && friends.length === 0 && (
              <p className="text-white/30 text-sm text-center py-10 px-6">
                No friends yet — add some from the Friends tab!
              </p>
            )}
            {friends.map(f => {
              const wasSent = sent.has(f.friend_id);
              const didFail = failed.has(f.friend_id);
              return (
                <button
                  key={f.friend_id}
                  onClick={() => handleShare(f)}
                  className="w-full flex items-center gap-3 px-5 py-3.5 hover:bg-white/5 transition text-left"
                >
                  {/* Avatar */}
                  <div className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center text-white font-bold text-sm shrink-0">
                    {f.friend_username[0].toUpperCase()}
                  </div>
                  <span className="flex-1 text-white text-sm font-medium">{f.friend_username}</span>
                  <span
                    className={`text-xs font-semibold transition ${
                      didFail ? 'text-red-400' : wasSent ? 'text-green-400' : 'text-white/40'
                    }`}
                  >
                    {didFail ? 'Retry' : wasSent ? '✓ Sent' : 'Send'}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="pb-8" />
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
