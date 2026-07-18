export default function Controls({ isPlaying, onTogglePlay, onSwipe, onShare }) {
  return (
    <div className="flex items-center justify-center gap-4 py-2 shrink-0">
      {/* Reject */}
      <button
        onClick={() => onSwipe('reject')}
        className="w-16 h-16 rounded-full bg-white/10 border-2 border-red-400/60 text-red-400 text-2xl font-bold flex items-center justify-center hover:bg-red-400/20 hover:border-red-400 active:scale-95 transition-all"
        aria-label="Reject"
      >
        ✕
      </button>

      {/* Play/Pause */}
      <button
        onClick={onTogglePlay}
        className="w-14 h-14 rounded-full bg-white/15 border border-white/20 text-white text-xl flex items-center justify-center hover:bg-white/25 active:scale-95 transition-all"
        aria-label={isPlaying ? 'Pause' : 'Play'}
      >
        {isPlaying ? '⏸' : '▶'}
      </button>

      {/* Like */}
      <button
        onClick={() => onSwipe('like')}
        className="w-16 h-16 rounded-full bg-white/10 border-2 border-green-400/60 text-green-400 text-2xl flex items-center justify-center hover:bg-green-400/20 hover:border-green-400 active:scale-95 transition-all"
        aria-label="Like"
      >
        ♥
      </button>

      {/* Share (optional) */}
      {onShare && (
        <button
          onClick={onShare}
          className="w-11 h-11 rounded-full bg-white/10 border border-white/20 text-white/60 flex items-center justify-center hover:bg-white/20 hover:text-white active:scale-95 transition-all"
          aria-label="Share track"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="22" y1="2" x2="11" y2="13"/>
            <polygon points="22 2 15 22 11 13 2 9 22 2"/>
          </svg>
        </button>
      )}
    </div>
  );
}
