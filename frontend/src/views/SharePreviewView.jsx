import { useEffect, useState } from 'react';
import { useAudio } from '../hooks/useAudio.js';
import { parseShareParams } from '../share.js';

// Deliberately bypasses api.js's request() helper: that always attaches auth
// headers and owns 401-teardown logic that has nothing to do with a
// recipient who very likely has no account at all.
async function fetchPublicPreview(trackId) {
  const res = await fetch(`/api/tracks/${trackId}/public-preview`);
  if (!res.ok) throw new Error(`Failed to load preview: ${res.status}`);
  return res.json();
}

export default function SharePreviewView() {
  const { trackId, note } = parseShareParams(window.location.search);
  const [track, setTrack] = useState(null);
  const [error, setError] = useState(null);
  const audio = useAudio(track && { ...track, preview_url: track.previewUrl });

  useEffect(() => {
    if (!trackId) {
      setError('This link is missing a track.');
      return;
    }
    fetchPublicPreview(trackId)
      .then(setTrack)
      .catch(() => setError('Could not load this track.'));
  }, [trackId]);

  return (
    <div className="flex flex-col h-screen max-w-sm mx-auto bg-[#0f0f0f] select-none items-center justify-center px-6 text-center gap-4">
      {error && <p className="text-white/60 text-sm">{error}</p>}

      {!error && !track && (
        <div className="w-10 h-10 border-4 border-white/20 border-t-white rounded-full animate-spin" />
      )}

      {track && (
        <>
          <div
            className="w-48 h-48 rounded-3xl bg-cover bg-center bg-white/10 shadow-2xl"
            style={track.cover_url ? { backgroundImage: `url(${track.cover_url})` } : undefined}
          />
          <div>
            <h1 className="text-white font-bold text-xl">{track.title}</h1>
            <p className="text-white/60 text-sm mt-1">{track.artist_name}</p>
          </div>
          {/* React escapes interpolated text by default — this is never passed
              through dangerouslySetInnerHTML, so a note can't carry markup. */}
          {note && <p className="text-white/50 text-sm italic max-w-xs">&ldquo;{note}&rdquo;</p>}
          <button
            onClick={audio.toggle}
            className="mt-2 w-16 h-16 rounded-full bg-white/10 flex items-center justify-center text-white text-2xl hover:bg-white/20 transition"
            aria-label={audio.isPlaying ? 'Pause preview' : 'Play preview'}
          >
            {audio.isPlaying ? '⏸' : '▶'}
          </button>
          <p className="text-white/25 text-xs mt-2">Shared from Music Swipe</p>
        </>
      )}
    </div>
  );
}
