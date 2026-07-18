import { useState, useEffect, useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { fetchInbox, markSeen, postInteraction } from '../api.js';
import { useAudio } from '../hooks/useAudio.js';

function formatAgo(unixSeconds) {
  const diff = Math.floor(Date.now() / 1000) - unixSeconds;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export default function InboxView({ showToast }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [playingItem, setPlayingItem] = useState(null);
  const audio = useAudio(playingItem);

  const load = useCallback(() => {
    fetchInbox()
      .then(setItems)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  function markRead(itemId) {
    markSeen(itemId).catch(console.error);
    setItems(prev => prev.map(i => (i.id === itemId ? { ...i, seen: true } : i)));
  }

  function handlePlay(item) {
    if (playingItem?.id === item.id) {
      audio.toggle();
    } else {
      // useAudio expects preview_url — the API sends previewUrl.
      setPlayingItem({ id: item.id, preview_url: item.previewUrl });
      markRead(item.id);
    }
  }

  async function handleLike(item) {
    if (item.itemType !== 'track') return;
    await postInteraction(item.itemId, 'like').catch(console.error);
    showToast?.('like');
    setItems(prev => prev.map(i => (i.id === item.id ? { ...i, liked: true } : i)));
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 pt-6 pb-4 shrink-0">
        <h1 className="text-white font-bold text-xl tracking-tight">Inbox</h1>
        <p className="text-white/40 text-xs mt-0.5">Music shared with you</p>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-6">
        {loading && (
          <div className="flex justify-center py-16">
            <div className="w-7 h-7 border-2 border-white/20 border-t-white rounded-full animate-spin" />
          </div>
        )}
        {!loading && items.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <div className="text-5xl">✉️</div>
            <p className="text-white/30 text-sm text-center">
              Nothing yet<br />Friends can share tracks and artists with you here
            </p>
          </div>
        )}

        <AnimatePresence>
          {items.map(item => {
            const isArtist = item.itemType === 'artist';
            const isPlaying = playingItem?.id === item.id && audio.isPlaying;
            const isLoaded = playingItem?.id === item.id;

            return (
              <motion.div
                key={item.id}
                layout
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                className={`mb-3 rounded-2xl overflow-hidden ${
                  item.seen ? 'bg-white/5' : 'bg-white/10 border border-white/10'
                }`}
              >
                <div className="flex items-center gap-3 p-3">
                  {/* Artwork — circular for artists, rounded square for tracks */}
                  <div
                    className={`w-14 h-14 bg-cover bg-center bg-white/10 shrink-0 relative ${
                      isArtist ? 'rounded-full' : 'rounded-xl'
                    }`}
                    style={item.coverUrl ? { backgroundImage: `url(${item.coverUrl})` } : undefined}
                  >
                    {!item.seen && (
                      <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-green-400 rounded-full border-2 border-[#0f0f0f]" />
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    {isArtist && (
                      <span className="inline-block text-[10px] font-bold uppercase tracking-wider text-purple-300/70 bg-purple-400/10 px-1.5 py-0.5 rounded mb-1">
                        Artist
                      </span>
                    )}
                    <p className="text-white font-semibold text-sm truncate">
                      {item.title || (isArtist ? 'Unknown artist' : 'Unknown track')}
                    </p>
                    {!isArtist && (
                      <p className="text-white/60 text-xs truncate">{item.artistName}</p>
                    )}
                    {isArtist && item.genreName && (
                      <p className="text-white/60 text-xs truncate">{item.genreName}</p>
                    )}
                    <p className="text-white/30 text-xs mt-0.5 truncate">
                      from @{item.senderUsername} · {formatAgo(item.createdAt)}
                    </p>
                    {item.message && (
                      <p className="text-white/70 text-xs mt-1 italic truncate">“{item.message}”</p>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex flex-col gap-2 shrink-0">
                    {item.previewUrl && (
                      <button
                        onClick={() => handlePlay(item)}
                        className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center text-white hover:bg-white/20 transition"
                      >
                        {isPlaying ? '⏸' : '▶'}
                      </button>
                    )}
                    {!isArtist && (
                      <button
                        onClick={() => handleLike(item)}
                        disabled={item.liked}
                        className={`w-9 h-9 rounded-full flex items-center justify-center transition ${
                          item.liked
                            ? 'bg-green-500/20 text-green-400'
                            : 'bg-white/10 text-white/60 hover:bg-green-500/20 hover:text-green-400'
                        }`}
                      >
                        ♥
                      </button>
                    )}
                    {/* Artist shares have nothing to play, so give them a way to
                        clear the unread dot. */}
                    {isArtist && !item.seen && (
                      <button
                        onClick={() => markRead(item.id)}
                        className="w-9 h-9 rounded-full bg-white/10 text-white/60 flex items-center justify-center hover:bg-white/20 transition text-xs"
                        title="Mark as seen"
                      >
                        ✓
                      </button>
                    )}
                  </div>
                </div>

                {/* Progress bar (when playing) */}
                {isLoaded && (
                  <div className="mx-3 mb-3">
                    <div
                      className="h-1 bg-white/10 rounded-full overflow-hidden cursor-pointer"
                      onClick={e => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        audio.seekTo((e.clientX - rect.left) / rect.width);
                      }}
                    >
                      <div
                        className="h-full bg-white/60 rounded-full transition-all"
                        style={{ width: `${audio.progress * 100}%` }}
                      />
                    </div>
                  </div>
                )}
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}
