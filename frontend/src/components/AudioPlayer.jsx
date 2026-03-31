import { useEffect } from 'react';

const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 2];

export default function AudioPlayer({ audio, onNeedsGesture }) {
  const { isPlaying, toggle, speed, setSpeed, progress, needsGesture, seekTo } = audio;

  useEffect(() => {
    if (needsGesture && onNeedsGesture) onNeedsGesture();
  }, [needsGesture]); // eslint-disable-line

  const elapsed = Math.floor((progress || 0) * 30);
  const mins = Math.floor(elapsed / 60);
  const secs = String(elapsed % 60).padStart(2, '0');

  return (
    <div className="w-full px-6">
      {/* Progress bar */}
      <div
        className="w-full h-1.5 bg-white/20 rounded-full mb-3 cursor-pointer"
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          seekTo((e.clientX - rect.left) / rect.width);
        }}
      >
        <div
          className="h-full bg-white rounded-full transition-all duration-100"
          style={{ width: `${(progress || 0) * 100}%` }}
        />
      </div>

      <div className="flex items-center justify-between text-white/50 text-xs mb-4">
        <span>{mins}:{secs}</span>
        <span>0:30</span>
      </div>

      {/* Speed selector */}
      <div className="flex items-center justify-center gap-2">
        {SPEED_OPTIONS.map((s) => (
          <button
            key={s}
            onClick={() => setSpeed(s)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              speed === s
                ? 'bg-white text-black'
                : 'bg-white/10 text-white/60 hover:bg-white/20'
            }`}
          >
            {s}×
          </button>
        ))}
      </div>
    </div>
  );
}
