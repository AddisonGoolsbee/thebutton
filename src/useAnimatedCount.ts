import { useState, useRef, useEffect, useCallback } from "react";

/**
 * Smoothly animates between count values.
 *
 * - First call to setTarget jumps instantly (page load).
 * - Subsequent calls animate linearly over `duration` ms with random jitter,
 *   guaranteeing the display reaches the target before the next poll.
 * - addImmediate() is always instant (for your own clicks).
 */
export function useAnimatedCount(duration = 2000) {
  const [displayCount, setDisplayCount] = useState<number | null>(null);
  const targetRef = useRef(0);
  const displayRef = useRef(0);
  const initializedRef = useRef(false);
  const rafRef = useRef(0);
  const animStartRef = useRef(0);
  const animStartDisplayRef = useRef(0);
  const animTargetRef = useRef(0);

  const tick = useCallback(
    (now: number) => {
      const elapsed = now - animStartRef.current;
      const totalGap = animTargetRef.current - animStartDisplayRef.current;

      if (totalGap <= 0 || elapsed >= duration) {
        // Animation complete — snap to current target (which may have advanced)
        if (displayRef.current < targetRef.current) {
          displayRef.current = targetRef.current;
          setDisplayCount(displayRef.current);
        }
        rafRef.current = 0;
        return;
      }

      // Linear progress with slight random jitter for organic feel
      const progress = elapsed / duration;
      const targetDisplay = animStartDisplayRef.current + Math.round(totalGap * progress);

      // Add small random jitter: sometimes +1, sometimes skip a frame
      const jitteredTarget = targetDisplay + (Math.random() < 0.3 ? 1 : 0);
      const newDisplay = Math.min(jitteredTarget, targetRef.current);

      if (newDisplay > displayRef.current) {
        displayRef.current = newDisplay;
        setDisplayCount(displayRef.current);
      }

      rafRef.current = requestAnimationFrame(tick);
    },
    [duration],
  );

  const startAnimation = useCallback(
    (fromDisplay: number, toTarget: number) => {
      animStartRef.current = performance.now();
      animStartDisplayRef.current = fromDisplay;
      animTargetRef.current = toTarget;
      if (!rafRef.current) {
        rafRef.current = requestAnimationFrame(tick);
      }
    },
    [tick],
  );

  const setTarget = useCallback(
    (newTarget: number) => {
      if (newTarget <= targetRef.current) return;

      targetRef.current = newTarget;

      // First poll: jump instantly
      if (!initializedRef.current) {
        initializedRef.current = true;
        displayRef.current = newTarget;
        setDisplayCount(newTarget);
        return;
      }

      // Start or restart animation from current display to new target
      startAnimation(displayRef.current, newTarget);
    },
    [startAnimation],
  );

  const addImmediate = useCallback((n: number) => {
    targetRef.current += n;
    displayRef.current += n;
    setDisplayCount(displayRef.current);
    initializedRef.current = true;
    // Update animation anchors so in-progress animation doesn't overshoot
    animStartDisplayRef.current += n;
    animTargetRef.current = targetRef.current;
  }, []);

  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return { displayCount, setTarget, addImmediate };
}
