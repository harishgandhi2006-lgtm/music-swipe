import { AnimatePresence, motion } from 'framer-motion';
import SwipeCard from './SwipeCard.jsx';

export default function CardStack({ currentTrack, nextTrack, onSwipe, swipeRef }) {
  return (
    <div className="relative w-full h-full">
      {/* Back card (next track preview) */}
      {nextTrack && (
        <div className="absolute inset-0 rounded-3xl overflow-hidden"
          style={{ transform: 'scale(0.94) translateY(12px)', opacity: 0.5 }}>
          <div
            className="absolute inset-0 bg-cover bg-center"
            style={{ backgroundImage: `url(${nextTrack.cover_url})` }}
          />
          <div className="absolute inset-0 bg-black/40" />
        </div>
      )}

      {/* Front card */}
      <AnimatePresence mode="wait">
        {currentTrack && (
          <motion.div
            key={currentTrack.id}
            className="absolute inset-0"
            initial={{ scale: 0.92, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
          >
            <SwipeCard
              track={currentTrack}
              onSwipe={onSwipe}
              audioControls={swipeRef}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
