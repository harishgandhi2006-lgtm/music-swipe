import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchNextTrack, fetchHistory, postInteraction, postUndo } from './api.js';
import { useAudio } from './hooks/useAudio.js';
import CardStack from './components/CardStack.jsx';
import AudioPlayer from './components/AudioPlayer.jsx';
import Controls from './components/Controls.jsx';
import FeedbackToast from './components/FeedbackToast.jsx';
import LibraryView from './components/LibraryView.jsx';

export default function App() {
  const [mainTab, setMainTab] = useState('discover');
  const [history, setHistory] = useState([]);
  const [currentTrack, setCurrentTrack] = useState(null);
  const [nextTrack, setNextTrack] = useState(null);
  const [pastStack, setPastStack] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);
  const [needsGesture, setNeedsGesture] = useState(false);

  const swipeRef = useRef({});
  const audio = useAudio(currentTrack);

  const loadTrack = useCallback(async (retries = 3) => {
    try {
      return await fetchNextTrack();
    } catch (err) {
      if (err.message === 'rate_limited' && retries > 0) {
        await new Promise((r) => setTimeout(r, 5000));
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
      try {
        const hist = await fetchHistory();
        setHistory(hist);
      } catch (e) {
        console.error(e);
      }
      const first = await loadTrack();
      setCurrentTrack(first);
      setIsLoading(false);
      const second = await loadTrack();
      setNextTrack(second);
    })();
  }, [loadTrack]);

  useEffect(() => {
    if (mainTab === 'discover') return;
    fetchHistory()
      .then(setHistory)
      .catch(console.error);
  }, [mainTab]);

  const showToast = useCallback((action) => {
    setToast(action);
    setTimeout(() => setToast(null), 1200);
  }, []);

  const handleSwipe = useCallback(
    async (action) => {
      if (!currentTrack) return;

      showToast(action);

      setPastStack((p) => [...p, { prev: currentTrack, prevNext: nextTrack }]);

      postInteraction(currentTrack.id, action)
        .then(() => fetchHistory())
        .then(setHistory)
        .catch(console.error);

      setCurrentTrack(nextTrack);
      setNextTrack(null);
      loadTrack().then(setNextTrack);
    },
    [currentTrack, nextTrack, showToast, loadTrack],
  );

  const handleRewind = useCallback(async () => {
    if (pastStack.length === 0) return;
    const top = pastStack[pastStack.length - 1];
    try {
      await postUndo();
      setPastStack((p) => p.slice(0, -1));
      setCurrentTrack(top.prev);
      setNextTrack(top.prevNext ?? null);
      if (!top.prevNext) {
        loadTrack().then(setNextTrack);
      }
      const h = await fetchHistory();
      setHistory(h);
    } catch (e) {
      console.error(e);
      setToast('undo_fail');
      setTimeout(() => setToast(null), 1600);
    }
  }, [pastStack, loadTrack]);

  const handleButtonSwipe = useCallback(
    (action) => {
      if (swipeRef.current?.triggerSwipe) {
        swipeRef.current.triggerSwipe(action);
      } else {
        handleSwipe(action);
      }
    },
    [handleSwipe],
  );

  const handleFirstGesture = useCallback(() => {
    setNeedsGesture(false);
    audio.toggle();
  }, [audio]);

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-4 px-6 text-center">
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
      <div className="flex flex-col items-center justify-center h-screen gap-4">
        <div className="w-12 h-12 border-4 border-white/20 border-t-white rounded-full animate-spin" />
        <p className="text-white/50 text-sm">Loading your music...</p>
      </div>
    );
  }

  const rated = history.length;
  const subtitle =
    rated === 0
      ? 'Swipe to explore music'
      : `Welcome back — ${rated} song${rated !== 1 ? 's' : ''} rated`;

  return (
    <div className="flex flex-col h-screen max-w-sm mx-auto px-4 py-6 gap-4 select-none">
      <div className="flex items-start justify-between gap-2 shrink-0">
        <div className="min-w-0">
          <h1 className="text-white font-bold text-xl tracking-tight">Music Swipe</h1>
          <p className="text-white/40 text-xs mt-0.5 truncate">{subtitle}</p>
        </div>
        <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-sm shrink-0">
          🎵
        </div>
      </div>

      <div className="flex rounded-xl bg-white/10 p-0.5 shrink-0">
        {[
          { id: 'discover', label: 'Discover' },
          { id: 'liked', label: 'Liked' },
          { id: 'history', label: 'History' },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setMainTab(t.id)}
            className={`flex-1 py-2 text-xs font-semibold rounded-lg transition ${
              mainTab === t.id ? 'bg-white/20 text-white' : 'text-white/50 hover:text-white/70'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {mainTab === 'discover' && (
        <>
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
              />
            ) : (
              <div className="flex flex-col items-center justify-center h-full gap-3 text-white/40">
                <div className="text-4xl">🎧</div>
                <p className="text-sm">No more tracks right now</p>
              </div>
            )}
          </div>

          <AudioPlayer audio={audio} onNeedsGesture={() => setNeedsGesture(true)} />

          <Controls
            isPlaying={audio.isPlaying}
            onTogglePlay={audio.toggle}
            onSwipe={handleButtonSwipe}
            onRewind={handleRewind}
            canRewind={pastStack.length > 0}
          />

          {rated === 0 && !needsGesture && (
            <p className="text-center text-white/25 text-xs pb-2">
              ← drag to pass · drag to like →
            </p>
          )}
        </>
      )}

      {mainTab === 'liked' && (
        <div className="flex-1 flex flex-col min-h-0">
          <LibraryView history={history} mode="liked" />
        </div>
      )}
      {mainTab === 'history' && (
        <div className="flex-1 flex flex-col min-h-0">
          <LibraryView history={history} mode="history" />
        </div>
      )}

      <FeedbackToast message={toast} />
    </div>
  );
}
