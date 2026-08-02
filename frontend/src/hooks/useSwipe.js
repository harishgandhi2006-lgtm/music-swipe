import { useAnimation, useMotionValue, useTransform } from 'framer-motion';

export function useSwipe(onSwipe) {
  const controls = useAnimation();
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-250, 250], [-20, 20]);
  const likeOpacity = useTransform(x, [30, 120], [0, 1]);
  const rejectOpacity = useTransform(x, [-120, -30], [1, 0]);

  const EXIT_MS = 350;

  async function triggerSwipe(direction) {
    const target = direction === 'like' ? 700 : -700;

    // The exit animation is decoration; the swipe itself must commit either
    // way. Awaiting the animation alone meant that whenever the promise didn't
    // settle — a detached control, an interrupted card — onSwipe was never
    // reached and the button silently did nothing at all.
    await Promise.race([
      controls.start({
        x: target,
        opacity: 0,
        transition: { duration: EXIT_MS / 1000, ease: 'easeInOut' },
      }),
      new Promise(resolve => setTimeout(resolve, EXIT_MS + 100)),
    ]);

    onSwipe(direction);
    // Reset for the next card render
    x.set(0);
    controls.set({ x: 0, opacity: 1 });
  }

  const OFFSET_THRESHOLD = 100;
  // A quick flick can commit well before the offset threshold — without this,
  // a fast short drag just springs back, which reads as the gesture failing.
  const VELOCITY_THRESHOLD = 600; // px/s

  function handleDragEnd(_, info) {
    const offsetCommits = Math.abs(info.offset.x) > OFFSET_THRESHOLD;
    const velocityCommits = Math.abs(info.velocity.x) > VELOCITY_THRESHOLD;

    if (offsetCommits || velocityCommits) {
      // Velocity wins the direction call when it's the one crossing threshold —
      // covers a fast flick that overshoots and corrects before release.
      const sign = velocityCommits ? Math.sign(info.velocity.x) : Math.sign(info.offset.x);
      triggerSwipe(sign > 0 ? 'like' : 'reject');
    } else {
      controls.start({
        x: 0,
        transition: { type: 'spring', stiffness: 500, damping: 30 },
      });
    }
  }

  return { controls, x, rotate, likeOpacity, rejectOpacity, triggerSwipe, handleDragEnd };
}
