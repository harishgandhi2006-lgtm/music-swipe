import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchNextTrack, postInteraction } from '../api.js';
import { useAudio } from '../hooks/useAudio.js';
import { useAuth } from '../auth/AuthContext.jsx';
import CardStack from '../components/CardStack.jsx';
import AudioPlayer from '../components/AudioPlayer.jsx';
import Controls from '../components/Controls.jsx';
import ShareModal from '../components/ShareModal.jsx';

export default function DiscoverView({ onBadgeUnlocked, showToast }) {
  const { user } = useAuth();
  const [currentTrack, setCurrentTrack] = useState(null);
  const [nextTrack, setNextTrack] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [needsGesture, setNeedsGesture] = useState(false);
  const [swipeCount, setSwipeCount] = useState(0);
  const [shareTrack, setShareTrack] = useState(null);

  const swipeRef = useRef({});
  const audio = useAudio(currentTrack);

  const loadTrack = useCallback(async (retries = 3) => {
    try {
      return await fetchNextTrack();
    } catch (err) {
      if (err.message === 'rate_limited' && retries > 0) {
        await new Promise(r => setTimeout(r, 5000));
        return loadTrack(retries - 1);
      }
      console.error('Failed to load track:', err);
      setError('Failed to load tracks. Is the backend running?');
      return null;
    }
  }, []);

  useEffect(() => {
    (async () => {
      setIsLoading(true);
      const first = await loadTrack();
      setCurrentTrack(first);
      setIsLoading(false);
      const second = await loadTrack();
      setNextTrack(second);
    })();
  }, []); // eslint-disable-line

  const handleSwipe = useCallback(async (action) => {
    if (!currentTrack) return;
    setSwipeCount(c => c + 1);
    showToast?.(action);

    setCurrentTrack(nextTrack);
    setNextTrack(null);
    loadTrack().then(setNextTrack);

    postInteraction(currentTrack.id, action)
      .then(data => {
        if (data.newBadges?.length > 0) {
          data.newBadges.forEach(badge => onBadgeUnlocked?.(badge));
        }
      })
      .catch(console.error);
  }, [currentTrack, nextTrack, loadTrack, onBadgeUnlocked]);

  const handleButtonSwipe = useCallback((action) => {
    if (swipeRef.current?.triggerSwipe) {
      swipeRef.current.triggerSwipe(action);
    } else {
      handleSwipe(action);
    }
  }, [handleSwipe]);

  const handleFirstGesture = useCallback(() => {
    setNeedsGesture(false);
    audio.toggle();
  }, [audio]);

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 px-6 text-center">
        <div className="text-5xl">⚠️</div>
        <p className="text-white/80 text-lg">{error}</p>
        <button
          onClick={() => window.location.reload()}
          className="mt-4 px-6 py-3 bg-white/10 rounded-xl text-white hover:bg-white/20 transition"
        >
          Retry
        </button>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <div className="w-12 h-12 border-4 border-white/20 border-t-white rounded-full animate-spin" />
        <p className="text-white/50 text-sm">Loading your music...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full px-4 py-6 gap-4 select-none">
      {/* Header */}
      <div className="flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-white font-bold text-xl tracking-tight">Discover</h1>
          <p className="text-white/40 text-xs mt-0.5">
            {swipeCount === 0
              ? `Welcome back, ${user?.username || 'there'}`
              : `${swipeCount} song${swipeCount !== 1 ? 's' : ''} explored`}
          </p>
        </div>
        <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-sm">
          🎵
        </div>
      </div>

      {/* Card area */}
      <div className="flex-1 relative" style={{ minHeight: 0 }}>
        {needsGesture && (
          <button
            className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-black/60 rounded-3xl backdrop-blur-sm gap-3"
            onClick={handleFirstGesture}
          >
            <div className="text-4xl animate-bounce">▶</div>
            <p className="text-white/80 text-sm font-medium">Tap to start playing</p>
          </button>
        )}
        {currentTrack ? (
          <CardStack
            currentTrack={currentTrack}
            nextTrack={nextTrack}
            onSwipe={handleSwipe}
            swipeRef={swipeRef.current}
            onShare={() => setShareTrack(currentTrack)}
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-white/40">
            <div className="text-4xl">🎧</div>
            <p className="text-sm">No more tracks right now</p>
          </div>
        )}
      </div>

      {/* Audio player */}
      <AudioPlayer audio={audio} onNeedsGesture={() => setNeedsGesture(true)} />

      {/* Controls */}
      <Controls
        isPlaying={audio.isPlaying}
        onTogglePlay={audio.toggle}
        onSwipe={handleButtonSwipe}
        onShare={currentTrack ? () => setShareTrack(currentTrack) : null}
      />

      {/* Swipe hint */}
      {swipeCount === 0 && !needsGesture && (
        <p className="text-center text-white/25 text-xs pb-1 shrink-0">
          ← drag to pass  ·  drag to like →
        </p>
      )}

      {/* Share modal */}
      {shareTrack && (
        <ShareModal
          track={shareTrack}
          onClose={() => setShareTrack(null)}
        />
      )}
    </div>
  );
}
