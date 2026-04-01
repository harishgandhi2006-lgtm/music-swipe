export default function Controls({ isPlaying, onTogglePlay, onSwipe, onRewind, canRewind }) {
  return (
    <div className="flex items-center justify-center gap-4 py-2 flex-wrap">
      {/* Reject button */}
      <button
        onClick={() => onSwipe('reject')}
        className="w-16 h-16 rounded-full bg-white/10 border-2 border-red-400/60 text-red-400 text-2xl font-bold flex items-center justify-center hover:bg-red-400/20 hover:border-red-400 active:scale-95 transition-all"
        aria-label="Reject"
      >
        ✕
      </button>

      {onRewind != null && (
        <button
          type="button"
          onClick={onRewind}
          disabled={!canRewind}
          className="w-12 h-12 rounded-full bg-white/10 border border-white/20 text-white/80 text-lg flex items-center justify-center hover:bg-white/20 disabled:opacity-25 disabled:pointer-events-none active:scale-95 transition-all"
          aria-label="Rewind last swipe"
        >
          ↩
        </button>
      )}

      {/* Play/Pause button */}
      <button
        onClick={onTogglePlay}
        className="w-14 h-14 rounded-full bg-white/15 border border-white/20 text-white text-xl flex items-center justify-center hover:bg-white/25 active:scale-95 transition-all"
        aria-label={isPlaying ? 'Pause' : 'Play'}
      >
        {isPlaying ? '⏸' : '▶'}
      </button>

      {/* Like button */}
      <button
        onClick={() => onSwipe('like')}
        className="w-16 h-16 rounded-full bg-white/10 border-2 border-green-400/60 text-green-400 text-2xl flex items-center justify-center hover:bg-green-400/20 hover:border-green-400 active:scale-95 transition-all"
        aria-label="Like"
      >
        ♥
      </button>
    </div>
  );
}
