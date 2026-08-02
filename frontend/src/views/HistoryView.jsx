import { useState, useEffect, useCallback } from 'react';
import { AnimatePresence } from 'framer-motion';
import { fetchLikedArchive } from '../api.js';
import { useAudio } from '../hooks/useAudio.js';
import { useSessionHistory } from '../hooks/useSessionHistory.js';
import { clearSessionHistory } from '../sessionHistory.js';
import { buildShareUrl } from '../share.js';
import TrackHistoryRow from '../components/TrackHistoryRow.jsx';
import FeedbackToast from '../components/FeedbackToast.jsx';

const PAGE_SIZE = 50;

function formatAgo(ms) {
  const diff = Math.floor((Date.now() - ms) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export default function HistoryView() {
  const [tab, setTab] = useState('session');

  const sessionEntries = useSessionHistory();

  const [archive, setArchive] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const [loaded, setLoaded] = useState(false);

  // One player shared by both tabs. Keyed by track so the row that owns the
  // audio is unambiguous when the same song appears in the session log and the
  // archive at once.
  const [playing, setPlaying] = useState(null);
  const audio = useAudio(playing);
  const [shareToast, setShareToast] = useState(null);

  function showShareToast(message) {
    setShareToast(message);
    setTimeout(() => setShareToast(null), 1600);
  }

  // Zero server involvement: the link carries the trackId (and optional note)
  // entirely in its own URL, so there's nothing to persist or link back to
  // this account — see share.js and backend/routes/public.js.
  async function handleShare(entry, note) {
    const url = buildShareUrl({ id: entry.track_id }, note);
    if (navigator.share) {
      try {
        await navigator.share({ title: entry.title, text: entry.artist_name, url });
      } catch {
        // User cancelled the native share sheet — nothing further to do.
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      showShareToast('Link copied!');
    } catch {
      showShareToast('Could not copy link');
    }
  }

  const loadArchive = useCallback(async (offset = 0) => {
    offset === 0 ? setLoading(true) : setLoadingMore(true);
    setError(null);
    try {
      const data = await fetchLikedArchive(PAGE_SIZE, offset);
      setArchive(prev => (offset === 0 ? data.items : [...prev, ...data.items]));
      setTotal(data.total);
      setLoaded(true);
    } catch (err) {
      console.error('Failed to load liked archive:', err);
      setError('Could not load your archive.');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  // Fetch on first visit to the tab, then keep what we have — the archive only
  // changes by swiping, which happens in Discover.
  useEffect(() => {
    if (tab === 'liked' && !loaded) loadArchive(0);
  }, [tab, loaded, loadArchive]);

  function handlePlay(entry) {
    const key = `${tab}:${entry.track_id}`;
    if (playing?.id === key) {
      audio.toggle();
    } else {
      // useAudio keys off `id` and reads `preview_url`; the archive API sends
      // previewUrl, so adapt at the boundary rather than in the row component.
      setPlaying({ id: key, preview_url: entry.previewUrl });
    }
  }

  function rowProps(entry) {
    const key = `${tab}:${entry.track_id}`;
    return {
      isLoaded: playing?.id === key,
      isPlaying: playing?.id === key && audio.isPlaying,
      progress: audio.progress,
      onPlay: () => handlePlay(entry),
      onSeek: audio.seekTo,
      onShare: (note) => handleShare(entry, note),
    };
  }

  const likedThisSession = sessionEntries.filter(e => e.action === 'like').length;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 pt-6 pb-3 shrink-0">
        <h1 className="text-white font-bold text-xl tracking-tight">History</h1>
        <p className="text-white/40 text-xs mt-0.5">Everything you've swiped</p>
      </div>

      {/* Layer switch */}
      <div className="px-4 pb-3 shrink-0">
        <div className="flex bg-white/5 rounded-xl p-1 gap-1">
          <TabButton active={tab === 'session'} onClick={() => setTab('session')}>
            This Session{sessionEntries.length > 0 && ` (${sessionEntries.length})`}
          </TabButton>
          <TabButton active={tab === 'liked'} onClick={() => setTab('liked')}>
            Liked Archive{loaded && total > 0 && ` (${total})`}
          </TabButton>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-6">
        {tab === 'session' ? (
          <>
            {sessionEntries.length > 0 && (
              <div className="flex items-center justify-between mb-3">
                <p className="text-white/30 text-xs">
                  {likedThisSession} liked · {sessionEntries.length - likedThisSession} passed
                </p>
                <button
                  onClick={clearSessionHistory}
                  className="text-white/30 text-xs hover:text-white/60 transition"
                >
                  Clear
                </button>
              </div>
            )}

            {sessionEntries.length === 0 ? (
              <EmptyState
                icon="🕒"
                title="Nothing swiped yet"
                body={'Tracks you swipe will show up here\nand clear when you close the app'}
              />
            ) : (
              <AnimatePresence>
                {sessionEntries.map(entry => (
                  <TrackHistoryRow
                    key={entry.track_id}
                    entry={entry}
                    meta={formatAgo(entry.swiped_at)}
                    {...rowProps(entry)}
                  />
                ))}
              </AnimatePresence>
            )}
          </>
        ) : (
          <>
            {loading && <Spinner />}

            {error && !loading && (
              <div className="flex flex-col items-center py-16 gap-3">
                <p className="text-white/50 text-sm">{error}</p>
                <button
                  onClick={() => loadArchive(0)}
                  className="px-4 py-2 bg-white/10 rounded-xl text-white text-sm hover:bg-white/20 transition"
                >
                  Retry
                </button>
              </div>
            )}

            {!loading && !error && archive.length === 0 && (
              <EmptyState
                icon="💚"
                title="No liked tracks yet"
                body={'Songs you like are kept here for good,\nacross every session'}
              />
            )}

            <AnimatePresence>
              {archive.map(entry => (
                <TrackHistoryRow
                  key={entry.track_id}
                  entry={{ ...entry, action: 'like' }}
                  meta={formatAgo(entry.liked_at)}
                  {...rowProps(entry)}
                />
              ))}
            </AnimatePresence>

            {archive.length < total && !loading && (
              <button
                onClick={() => loadArchive(archive.length)}
                disabled={loadingMore}
                className="w-full py-3 mt-1 bg-white/5 rounded-xl text-white/60 text-sm hover:bg-white/10 transition disabled:opacity-50"
              >
                {loadingMore ? 'Loading…' : `Load more (${total - archive.length} left)`}
              </button>
            )}
          </>
        )}
      </div>

      <FeedbackToast toast={shareToast} />
    </div>
  );
}

function TabButton({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 py-2 rounded-lg text-xs font-semibold transition ${
        active ? 'bg-white text-black' : 'text-white/50 hover:text-white/80'
      }`}
    >
      {children}
    </button>
  );
}

function Spinner() {
  return (
    <div className="flex justify-center py-16">
      <div className="w-7 h-7 border-2 border-white/20 border-t-white rounded-full animate-spin" />
    </div>
  );
}

function EmptyState({ icon, title, body }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-3">
      <div className="text-5xl">{icon}</div>
      <p className="text-white/60 text-sm font-medium">{title}</p>
      <p className="text-white/30 text-xs text-center whitespace-pre-line">{body}</p>
    </div>
  );
}
