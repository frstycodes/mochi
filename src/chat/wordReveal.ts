import { useReducedMotionConfig } from 'motion/react';
import { useLayoutEffect, type RefObject } from 'react';

/** Fades in each word Streamdown wraps (`data-sd-animate`, needs `animated` + `isAnimating`) as it streams into `ref`. */
export function useWordReveal(ref: RefObject<HTMLElement | null>, isRevealing: boolean) {
  const reduceMotion = useReducedMotionConfig();
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root || !isRevealing) return;
    const keyframes = reduceMotion ? OPACITY_ONLY : FEATHER;
    const started = new WeakSet<Element>();
    // Start times by word index: markdown that reshapes mid-stream (a paragraph turning into a list) remounts its spans, and a remounted word resumes its fade instead of restarting it.
    const starts: number[] = [];
    const reveal = () => {
      const words = root.querySelectorAll('[data-sd-animate]');
      const now = performance.now();
      const fresh = words.length - starts.length;
      if (fresh > 0) starts.push(...scheduleStarts(starts.at(-1) ?? -Infinity, now, fresh));
      words.forEach((word, i) => {
        if (started.has(word)) return;
        started.add(word);
        word.animate(keyframes, { duration: WORD_REVEAL.duration, easing: WORD_REVEAL.easing, delay: starts[i] - now, fill: 'backwards' });
      });
    };
    reveal();
    // MutationObserver callbacks run before paint, so a new word never shows a frame at full opacity.
    const observer = new MutationObserver(reveal);
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [ref, isRevealing, reduceMotion]);
}

export const WORD_REVEAL = { duration: 600, easing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)', stagger: 30, minStagger: 6, maxBacklogMs: 900 };

/** Start times for `count` new words: `stagger` apart after the last one, squeezed so none starts more than `maxBacklogMs` after `now`. */
export function scheduleStarts(lastStart: number, now: number, count: number, { stagger, minStagger, maxBacklogMs }: Pick<typeof WORD_REVEAL, 'stagger' | 'minStagger' | 'maxBacklogMs'> = WORD_REVEAL) {
  const first = Math.max(now, lastStart + stagger);
  const room = now + maxBacklogMs - first;
  const step = count > 1 ? Math.min(stagger, Math.max(minStagger, room / (count - 1))) : stagger;
  return Array.from({ length: count }, (_, i) => first + i * step);
}

const FEATHER: Keyframe[] = [
  { opacity: 0, filter: 'blur(2px)' },
  { filter: 'blur(0)', offset: 0.6 },
  { opacity: 1, filter: 'blur(0)' },
];
const OPACITY_ONLY: Keyframe[] = [{ opacity: 0 }, { opacity: 1 }];
