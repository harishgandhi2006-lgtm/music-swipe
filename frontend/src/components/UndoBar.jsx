import { AnimatePresence, motion } from 'framer-motion';

const UNDO_WINDOW_MS = 4000;

// Distinct from FeedbackToast: that one is pointer-events-none and expires on
// a fixed short timer, which is the wrong shape for a control someone needs
// to actually click within a window.
export default function UndoBar({ pendingUndo, onUndo }) {
  return (
    <AnimatePresence>
      {pendingUndo && (
        <motion.div
          key={pendingUndo.track.id}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 12 }}
          transition={{ duration: 0.2 }}
          className="relative overflow-hidden flex items-center justify-between gap-3 bg-white/10 backdrop-blur-sm rounded-xl px-4 py-2.5 shrink-0"
        >
          <motion.div
            className="absolute inset-y-0 left-0 bg-white/10"
            initial={{ width: '100%' }}
            animate={{ width: '0%' }}
            transition={{ duration: UNDO_WINDOW_MS / 1000, ease: 'linear' }}
          />
          <p className="relative text-white/70 text-sm">
            {pendingUndo.action === 'like' ? 'Liked' : 'Passed'} “{pendingUndo.track.title}”
          </p>
          <button
            onClick={onUndo}
            className="relative text-white font-semibold text-sm px-3 py-1 rounded-lg bg-white/15 hover:bg-white/25 transition shrink-0"
          >
            Undo
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export { UNDO_WINDOW_MS };
