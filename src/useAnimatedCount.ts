import { useState, useRef, useEffect, useCallback } from "react";

/**
 * Smoothly animates between count values using a continuous rAF loop.
 *
 * - First call to setTarget jumps instantly (page load).
 * - Subsequent calls feed a rAF loop that probabilistically increments,
 *   giving a random "real-time" feel with zero gaps between polls.
 * - addImmediate() is always instant (for your own clicks).
 */
export function useAnimatedCount(duration = 2000) {
  const [displayCount, setDisplayCount] = useState(0);
  const targetRef = useRef(0);
  const displayRef = useRef(0);
  const initializedRef = useRef(false);
  const rafRef = useRef(0);
  const lastFrameRef = useRef(0);

  // rAF tick: each frame, probabilistically increment toward target.
  // Rate = gap * (dt / duration), giving an organic exponential approach.
  const tick = useCallback(
    (now: number) => {
      const gap = targetRef.current - displayRef.current;
      if (gap <= 0) {
        rafRef.current = 0;
        return;
      }

      const dt = Math.min(now - lastFrameRef.current, 100); // cap dt to avoid big jumps after tab-switch
      lastFrameRef.current = now;

      // Expected increments this frame
      const expected = gap * (dt / duration);

      // Probabilistic rounding gives a natural random feel
      const floor = Math.floor(expected);
      const frac = expected - floor;
      const inc = floor + (Math.random() < frac ? 1 : 0);

      if (inc > 0) {
        displayRef.current = Math.min(displayRef.current + inc, targetRef.current);
        setDisplayCount(displayRef.current);
      }

      rafRef.current = requestAnimationFrame(tick);
    },
    [duration],
  );

  const startAnimation = useCallback(() => {
    if (rafRef.current) return; // already running
    lastFrameRef.current = performance.now();
    rafRef.current = requestAnimationFrame(tick);
  }, [tick]);

  const setTarget = useCallback(
    (newTarget: number) => {
      // Only animate upward
      if (newTarget <= targetRef.current) return;

      targetRef.current = newTarget;

      // First poll: jump instantly
      if (!initializedRef.current) {
        initializedRef.current = true;
        displayRef.current = newTarget;
        setDisplayCount(newTarget);
        return;
      }

      // Show one increment immediately for responsiveness
      if (displayRef.current < targetRef.current) {
        displayRef.current += 1;
        setDisplayCount(displayRef.current);
      }

      // Kick off the animation loop (no-op if already running)
      startAnimation();
    },
    [startAnimation],
  );

  // Immediately add local clicks (no animation delay for your own clicks)
  const addImmediate = useCallback((n: number) => {
    targetRef.current += n;
    displayRef.current += n;
    setDisplayCount(displayRef.current);
    initializedRef.current = true;
  }, []);

  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return { displayCount, setTarget, addImmediate };
}
