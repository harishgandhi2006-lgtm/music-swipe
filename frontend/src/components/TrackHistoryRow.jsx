import { useState } from 'react';
import { motion } from 'framer-motion';
import { NOTE_MAX_LEN } from '../share.js';

// One row of history, shared by both layers. The session log and the permanent
// archive hold different data with different lifetimes, but a swiped track
// should look and behave identically in either — so the difference stays in the
// stores and never leaks into the presentation.
export default function TrackHistoryRow({
  entry,
  isLoaded,
  isPlaying,
  progress,
  onPlay,
  onSeek,
  onShare,
  meta,
}) {
  const rejected = entry.action === 'reject';
  const [sharing, setSharing] = useState(false);
  const [note, setNote] = useState('');

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="mb-3 rounded-2xl overflow-hidden bg-white/5"
    >
      <div className="flex items-center gap-3 p-3">
        {/* Artwork. Passed-on tracks are dimmed so a session list reads at a
            glance as "kept / passed" without needing to parse every label. */}
        <div
          className={`w-14 h-14 rounded-xl bg-cover bg-center bg-white/10 shrink-0 ${
            rejected ? 'opacity-40' : ''
          }`}
          style={entry.cover_url ? { backgroundImage: `url(${entry.cover_url})` } : undefined}
        />

        <div className="flex-1 min-w-0">
          <p className={`font-semibold text-sm truncate ${rejected ? 'text-white/50' : 'text-white'}`}>
            {entry.title || 'Unknown track'}
          </p>
          <p className="text-white/60 text-xs truncate">{entry.artist_name}</p>
          <p className="text-white/30 text-xs mt-0.5 truncate">
            {entry.genre_name ? `${entry.genre_name} · ` : ''}{meta}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Only the session layer carries rejects; the archive is likes only,
              so this badge simply never renders there. */}
          <span
            className={`text-xs font-bold w-7 h-7 rounded-full flex items-center justify-center ${
              rejected ? 'bg-white/5 text-white/30' : 'bg-green-500/15 text-green-400'
            }`}
            title={rejected ? 'Passed' : 'Liked'}
          >
            {rejected ? '✕' : '♥'}
          </span>

          {!rejected && onShare && (
            <button
              onClick={() => setSharing(s => !s)}
              className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center text-white hover:bg-white/20 transition"
              aria-label="Share this track"
            >
              🔗
            </button>
          )}

          {entry.previewUrl && (
            <button
              onClick={onPlay}
              className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center text-white hover:bg-white/20 transition"
              aria-label={isPlaying ? 'Pause preview' : 'Play preview'}
            >
              {isPlaying ? '⏸' : '▶'}
            </button>
          )}
        </div>
      </div>

      {sharing && (
        <div className="mx-3 mb-3 flex items-center gap-2">
          <input
            value={note}
            onChange={e => setNote(e.target.value.slice(0, NOTE_MAX_LEN))}
            placeholder="Add a note (optional)"
            className="flex-1 min-w-0 bg-white/10 rounded-lg px-3 py-1.5 text-white text-xs placeholder:text-white/30 outline-none"
          />
          <button
            onClick={() => { onShare(note); setSharing(false); setNote(''); }}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-white/15 text-white hover:bg-white/25 transition shrink-0"
          >
            Send
          </button>
        </div>
      )}

      {isLoaded && (
        <div className="mx-3 mb-3">
          <div
            className="h-1 bg-white/10 rounded-full overflow-hidden cursor-pointer"
            onClick={e => {
              const rect = e.currentTarget.getBoundingClientRect();
              onSeek((e.clientX - rect.left) / rect.width);
            }}
          >
            <div
              className="h-full bg-white/60 rounded-full transition-all"
              style={{ width: `${(progress || 0) * 100}%` }}
            />
          </div>
        </div>
      )}
    </motion.div>
  );
}
