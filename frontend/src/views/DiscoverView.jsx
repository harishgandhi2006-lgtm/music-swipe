import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchNextTrack, postInteraction, deleteInteraction } from '../api.js';
import { useAudio } from '../hooks/useAudio.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { recordSwipe, removeSwipe } from '../sessionHistory.js';
import CardStack from '../components/CardStack.jsx';
import AudioPlayer from '../components/AudioPlayer.jsx';
import Controls from '../components/Controls.jsx';
import UndoBar, { UNDO_WINDOW_MS } from '../components/UndoBar.jsx';

export default function DiscoverView({ onBadgeUnlocked, showToast }) {
  const { user } = useAuth();
  const [currentTrack, setCurrentTrack] = useState(null);
  const [nextTrack, setNextTrack] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [needsGesture, setNeedsGesture] = useState(false);
  const [swipeCount, setSwipeCount] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const [pendingUndo, setPendingUndo] = useState(null);

  const swipeRef = useRef({});
  const undoTimerRef = useRef(null);
  const audio = useAudio(currentTrack);

  // The recommender sits behind Deezer's rate limit, so a burst of fast swipes
  // can outrun the quota and surface as a 429 *or* a 500 — the old code retried
  // only the 429 and gave up instantly on everything else.
  //
  // Failure is reported to the caller rather than to the view: a prefetch that
  // fails must not tear down a card the user is still looking at.
  const loadTrack = useCallback(async () => {
    let delay = 800;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        return await fetchNextTrack();
      } catch (err) {
        if (err.isUnauthorized) throw err; // session teardown owns this case
        if (attempt === 3) {
          console.error('Failed to load track:', err);
          return null;
        }
        await new Promise(r => setTimeout(r, delay));
        delay *= 2; // 0.8s → 1.6s → 3.2s, enough for the quota window to clear
      }
    }
    return null;
  }, []);

  // Refetch from nothing. Shared by the first load and by every recovery path,
  // so "try again" always means the same thing.
  const refill = useCallback(async () => {
    setError(null);
    const first = await loadTrack();
    if (!first) {
      setError('Could not reach the music service.');
      return false;
    }
    setCurrentTrack(first);
    loadTrack().then(t => t && setNextTrack(t));
    return true;
  }, [loadTrack]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      const first = await loadTrack();
      if (cancelled) return;
      setCurrentTrack(first);
      setIsLoading(false);
      if (!first) {
        setError('Could not reach the music service.');
        return;
      }
      const second = await loadTrack();
      if (!cancelled && second) setNextTrack(second);
    })();
    return () => { cancelled = true; };
  }, [loadTrack]);

  // Recovery. Swiping with an empty deck leaves currentTrack null, and nothing
  // else ever promotes a prefetch that lands late — which is how a single
  // transient 500 used to strand the view for good, even after the backend came
  // back. Watching for the pairing repairs it the moment a track arrives.
  useEffect(() => {
    if (currentTrack || !nextTrack) return;
    setCurrentTrack(nextTrack);
    setNextTrack(null);
    loadTrack().then(t => t && setNextTrack(t));
  }, [currentTrack, nextTrack, loadTrack]);

  const handleSwipe = useCallback(async (action) => {
    if (!currentTrack) return;
    const swipedTrack = currentTrack;
    setSwipeCount(c => c + 1);
    showToast?.(action);

    recordSwipe(swipedTrack, action);

    clearTimeout(undoTimerRef.current);
    setPendingUndo({ track: swipedTrack, action });
    undoTimerRef.current = setTimeout(() => setPendingUndo(null), UNDO_WINDOW_MS);

    setCurrentTrack(nextTrack);
    setNextTrack(null);
    // Only ever *add* a prefetch. Writing null back on failure is what left the
    // deck permanently empty; the recovery effect above handles the gap.
    loadTrack().then(t => t && setNextTrack(t));

    postInteraction(swipedTrack.id, action)
      .then(data => {
        if (data.newBadges?.length > 0) {
          data.newBadges.forEach(badge => onBadgeUnlocked?.(badge));
        }
      })
      .catch(console.error);
  }, [currentTrack, nextTrack, loadTrack, onBadgeUnlocked, showToast]);

  const handleButtonSwipe = useCallback((action) => {
    if (swipeRef.current?.triggerSwipe) {
      swipeRef.current.triggerSwipe(action);
    } else {
      handleSwipe(action);
    }
  }, [handleSwipe]);

  // Undo only removes the swipe's recorded effects (session history entry,
  // server interaction row, affinity counts) — the pool has already moved
  // past this track by the time undo is possible, so it does not resurrect
  // the card into the live deck.
  const handleUndo = useCallback(() => {
    if (!pendingUndo) return;
    const { track } = pendingUndo;
    clearTimeout(undoTimerRef.current);
    setPendingUndo(null);
    removeSwipe(track.id);
    if (user) {
      deleteInteraction(track.id).catch(console.error);
    }
  }, [pendingUndo, user]);

  useEffect(() => () => clearTimeout(undoTimerRef.current), []);

  // Arrow keys mirror the Controls buttons exactly — same swipeRef-first,
  // handleSwipe-fallback path, so there's no second way a swipe can commit.
  useEffect(() => {
    function onKey(e) {
      if (e.repeat || needsGesture || !currentTrack) return;
      if (e.key === 'ArrowLeft') handleButtonSwipe('reject');
      else if (e.key === 'ArrowRight') handleButtonSwipe('like');
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleButtonSwipe, needsGesture, currentTrack]);

  const handleFirstGesture = useCallback(() => {
    setNeedsGesture(false);
    audio.toggle();
  }, [audio]);

  // Only blocks when there is genuinely nothing to show. A background prefetch
  // that failed leaves the current card playable, so it must not reach here.
  if (error && !currentTrack) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 px-6 text-center">
        <div className="text-5xl">⚠️</div>
        <p className="text-white/80 text-lg">{error}</p>
        <button
          onClick={() => { setRetrying(true); refill().finally(() => setRetrying(false)); }}
          disabled={retrying}
          className="mt-4 px-6 py-3 bg-white/10 rounded-xl text-white hover:bg-white/20 transition disabled:opacity-50"
        >
          {retrying ? 'Retrying…' : 'Try again'}
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

      {/* Card area — width capped and centered from md: up so the card keeps
          its portrait shape as the app shell widens, instead of the
          absolute-inset-0 card stretching to fill the full shell width. */}
      <div className="flex-1 relative w-full md:max-w-sm md:mx-auto" style={{ minHeight: 0 }}>
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
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-white/40">
            <div className="text-4xl">🎧</div>
            <p className="text-sm">No more tracks right now</p>
            {/* The recovery effect usually refills this on its own, but a dead
                end should never be the last word — always leave a way forward. */}
            <button
              onClick={() => { setRetrying(true); refill().finally(() => setRetrying(false)); }}
              disabled={retrying}
              className="mt-1 px-5 py-2.5 bg-white/10 rounded-xl text-white text-sm hover:bg-white/20 transition disabled:opacity-50"
            >
              {retrying ? 'Looking…' : 'Find more'}
            </button>
          </div>
        )}
      </div>

      <UndoBar pendingUndo={pendingUndo} onUndo={handleUndo} />

      {/* Audio player */}
      <AudioPlayer audio={audio} onNeedsGesture={() => setNeedsGesture(true)} />

      {/* Controls */}
      <Controls
        isPlaying={audio.isPlaying}
        onTogglePlay={audio.toggle}
        onSwipe={handleButtonSwipe}
      />

      {/* Swipe hint */}
      {swipeCount === 0 && !needsGesture && (
        <p className="text-center text-white/25 text-xs pb-1 shrink-0">
          ← drag to pass  ·  drag to like →
        </p>
      )}
    </div>
  );
}
