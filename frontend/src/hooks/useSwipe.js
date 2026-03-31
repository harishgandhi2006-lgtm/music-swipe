import { useAnimation, useMotionValue, useTransform } from 'framer-motion';

export function useSwipe(onSwipe) {
  const controls = useAnimation();
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-250, 250], [-20, 20]);
  const likeOpacity = useTransform(x, [30, 120], [0, 1]);
  const rejectOpacity = useTransform(x, [-120, -30], [1, 0]);

  async function triggerSwipe(direction) {
    const target = direction === 'like' ? 700 : -700;
    await controls.start({
      x: target,
      opacity: 0,
      transition: { duration: 0.35, ease: 'easeInOut' },
    });
    onSwipe(direction);
    // Reset for the next card render
    x.set(0);
    controls.set({ x: 0, opacity: 1 });
  }

  function handleDragEnd(_, info) {
    if (info.offset.x > 100) {
      triggerSwipe('like');
    } else if (info.offset.x < -100) {
      triggerSwipe('reject');
    } else {
      controls.start({
        x: 0,
        transition: { type: 'spring', stiffness: 500, damping: 30 },
      });
    }
  }

  return { controls, x, rotate, likeOpacity, rejectOpacity, triggerSwipe, handleDragEnd };
}
