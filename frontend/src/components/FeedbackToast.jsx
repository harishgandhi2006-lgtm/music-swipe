import { AnimatePresence, motion } from 'framer-motion';

export default function FeedbackToast({ toast }) {
  let content, className;

  if (!toast) {
    return (
      <AnimatePresence>
        <span key="empty" />
      </AnimatePresence>
    );
  }

  if (toast?.type === 'badge') {
    content = `${toast.emoji} ${toast.label} unlocked!`;
    className = 'bg-amber-500 text-white';
  } else if (toast === 'like') {
    content = '❤️ Liked!';
    className = 'bg-green-500 text-white';
  } else if (toast === 'reject') {
    content = '✕ Passed';
    className = 'bg-red-500 text-white';
  } else {
    // generic string message (e.g. "Friend added!")
    content = toast;
    className = 'bg-white/20 backdrop-blur-sm text-white';
  }

  return (
    <AnimatePresence>
      <motion.div
        key={JSON.stringify(toast) + Date.now()}
        className={`fixed top-8 left-1/2 -translate-x-1/2 px-6 py-3 rounded-2xl font-bold text-base z-50 pointer-events-none whitespace-nowrap ${className}`}
        initial={{ opacity: 0, y: -20, scale: 0.85 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -10, scale: 0.9 }}
        transition={{ duration: 0.2 }}
      >
        {content}
      </motion.div>
    </AnimatePresence>
  );
}
