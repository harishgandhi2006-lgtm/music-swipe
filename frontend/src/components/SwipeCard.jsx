import { motion } from 'framer-motion';
import { useSwipe } from '../hooks/useSwipe.js';

export default function SwipeCard({ track, onSwipe, audioControls, onShare }) {
  const { controls, x, rotate, likeOpacity, rejectOpacity, triggerSwipe, handleDragEnd } =
    useSwipe(onSwipe);

  if (audioControls) audioControls.triggerSwipe = triggerSwipe;

  return (
    <motion.div
      className="absolute inset-0 rounded-3xl overflow-hidden cursor-grab active:cursor-grabbing select-none"
      style={{ x, rotate }}
      drag="x"
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={0.85}
      onDragEnd={handleDragEnd}
      animate={controls}
      whileDrag={{ scale: 1.03 }}
    >
      {/* Album art background */}
      <div
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: `url(${track.cover_url})` }}
      />

      {/* Gradient overlay */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent" />

      {/* Share button */}
      {onShare && (
        <button
          onPointerDown={e => e.stopPropagation()}
          onClick={e => { e.stopPropagation(); onShare(); }}
          className="absolute top-4 right-4 w-9 h-9 rounded-full bg-black/40 backdrop-blur-sm border border-white/20 flex items-center justify-center text-white hover:bg-black/60 transition z-10"
          aria-label="Share this track"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="22" y1="2" x2="11" y2="13"/>
            <polygon points="22 2 15 22 11 13 2 9 22 2"/>
          </svg>
        </button>
      )}

      {/* LIKE badge */}
      <motion.div
        className="absolute top-12 left-8 border-4 border-green-400 text-green-400 font-black text-3xl px-4 py-2 rounded-xl rotate-[-20deg] tracking-wider"
        style={{ opacity: likeOpacity }}
      >
        LIKE
      </motion.div>

      {/* NOPE badge */}
      <motion.div
        className="absolute top-12 right-8 border-4 border-red-400 text-red-400 font-black text-3xl px-4 py-2 rounded-xl rotate-[20deg] tracking-wider"
        style={{ opacity: rejectOpacity }}
      >
        NOPE
      </motion.div>

      {/* Track info */}
      <div className="absolute bottom-0 left-0 right-0 p-6 pb-8">
        {track.genre_name && (
          <span className="inline-block bg-white/20 backdrop-blur-sm text-white/90 text-xs font-semibold px-3 py-1 rounded-full mb-3 tracking-wide uppercase">
            {track.genre_name}
          </span>
        )}
        <h2 className="text-white font-bold text-2xl leading-tight mb-1 drop-shadow-lg">
          {track.title}
        </h2>
        <p className="text-white/80 font-medium text-base drop-shadow">
          {track.artist_name}
        </p>
        <p className="text-white/50 text-sm mt-1">
          {track.album_title} · {Math.floor(track.duration / 60)}:{String(track.duration % 60).padStart(2, '0')}
        </p>
      </div>
    </motion.div>
  );
}
