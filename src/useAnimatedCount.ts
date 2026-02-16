import { useState, useRef, useEffect, useCallback } from "react";

/**
 * Smoothly animates between count values.
 *
 * - First call to setTarget jumps instantly (page load).
 * - Subsequent calls spread the delta as random increments over `duration` ms.
 * - addImmediate() is always instant (for your own clicks).
 */
export function useAnimatedCount(duration = 2000) {
  const [displayCount, setDisplayCount] = useState(0);
  const targetRef = useRef(0);
  const displayRef = useRef(0);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const initializedRef = useRef(false);

  const clearTimers = useCallback(() => {
    for (const t of timersRef.current) clearTimeout(t);
    timersRef.current = [];
  }, []);

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

      // Clear any pending animations
      clearTimers();

      // How many increments remain from current display to new target
      const delta = newTarget - displayRef.current;
      if (delta <= 0) return;

      // Ensure the first tick following a poll is instant so the counter feels responsive.
      const immediate = Math.min(delta, 1);
      if (immediate > 0) {
        displayRef.current = Math.min(
          displayRef.current + immediate,
          targetRef.current,
        );
        setDisplayCount(displayRef.current);
      }

      const animationDelta = delta - immediate;
      if (animationDelta <= 0) return;

      // Batch: if delta is huge (>500), group into fewer increments
      if (animationDelta > 500) {
        const batchCount = 200;
        const perBatch = Math.ceil(animationDelta / batchCount);
        for (let i = 0; i < batchCount; i++) {
          const delay = (i / batchCount) * duration;
          const inc =
            i === batchCount - 1
              ? animationDelta - perBatch * i
              : perBatch;
          if (inc <= 0) continue;
          const timer = setTimeout(() => {
            displayRef.current = Math.min(
              displayRef.current + inc,
              targetRef.current,
            );
            setDisplayCount(displayRef.current);
          }, delay);
          timersRef.current.push(timer);
        }
      } else {
        // Schedule individual increments at random times spread across `duration`
        const times: number[] = [];
        for (let i = 0; i < animationDelta; i++) {
          times.push(Math.random() * duration);
        }
        times.sort((a, b) => a - b);

        for (let i = 0; i < animationDelta; i++) {
          const timer = setTimeout(() => {
            displayRef.current += 1;
            setDisplayCount(displayRef.current);
          }, times[i]);
          timersRef.current.push(timer);
        }
      }
    },
    [duration, clearTimers],
  );

  // Immediately add local clicks (no animation delay for your own clicks)
  const addImmediate = useCallback((n: number) => {
    targetRef.current += n;
    displayRef.current += n;
    setDisplayCount(displayRef.current);
    // Mark as initialized so we don't jump again on first poll
    initializedRef.current = true;
  }, []);

  useEffect(() => {
    return clearTimers;
  }, [clearTimers]);

  return { displayCount, setTarget, addImmediate };
}
