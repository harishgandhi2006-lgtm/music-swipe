import { AnimatePresence, motion } from 'framer-motion';

export default function FeedbackToast({ message }) {
  const style =
    message === 'like'
      ? 'bg-green-500 text-white'
      : message === 'undo_fail'
        ? 'bg-amber-600 text-white'
        : 'bg-red-500 text-white';
  const text =
    message === 'like' ? '❤️ Liked!' : message === 'undo_fail' ? "Couldn't rewind" : '✕ Passed';
  return (
    <AnimatePresence>
      {message && (
        <motion.div
          key={message + Date.now()}
          className={`fixed top-8 left-1/2 -translate-x-1/2 px-6 py-3 rounded-2xl font-bold text-lg z-50 pointer-events-none ${style}`}
          initial={{ opacity: 0, y: -20, scale: 0.85 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -10, scale: 0.9 }}
          transition={{ duration: 0.2 }}
        >
          {text}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
