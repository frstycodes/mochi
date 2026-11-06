import { useReducedMotionConfig } from 'motion/react';
import { useEffect, useRef, useState } from 'react';

/** The slowest a reveal runs, in characters a second: a little above Claude's own pace, so a slow stream never waits on it. */
const MIN_CHARS_PER_SECOND = 90;
/**
 * The backlog drains with this time constant, so the reveal sits about this far behind the stream however fast it writes:
 * long enough to spread a 50ms batch (`BATCH_MS` in store/replica.ts) or a bursty network chunk over several frames.
 */
const LAG_MS = 200;
/** More unshown text than this (a reconnect, a window shown again) appears at once up to the last this-many characters. */
const MAX_BACKLOG = 1200;

/**
 * Where a reveal at `shown` characters stands `ms` later, chasing `target`: faster as the backlog grows (it decays with
 * `LAG_MS`, frame-rate independent), never slower than `MIN_CHARS_PER_SECOND`, never past `target`. Fractional.
 */
export function revealStep(shown: number, target: number, ms: number) {
  const backlog = target - shown;
  if (backlog <= 0) return target;
  if (backlog > MAX_BACKLOG) return target - MAX_BACKLOG;
  const step = Math.max(
    (MIN_CHARS_PER_SECOND * ms) / 1000,
    backlog * (1 - Math.exp(-ms / LAG_MS)),
  );
  return Math.min(target, shown + step);
}

/** The first `count` characters of `text`, widened so an emoji's surrogate pair is never split. */
export function revealedText(text: string, count: number) {
  if (count >= text.length) return text;
  const code = text.charCodeAt(count - 1);
  const isHighSurrogate = code >= 0xd800 && code <= 0xdbff;
  return text.slice(0, isHighSurrogate ? count + 1 : count);
}

/**
 * Text streaming in, revealed evenly a frame at a time instead of in the chunks it arrives in. Only while `isLive`: a
 * finished or historical message, and any with reduced motion, shows its text as is. Text already there when it mounts
 * shows at once; only what arrives after is revealed.
 */
export function useSmoothText(text: string, isLive: boolean) {
  const isStill = useReducedMotionConfig() ?? false;
  const isSmooth = isLive && !isStill;
  const [count, setCount] = useState(text.length);
  const [wasSmooth, setWasSmooth] = useState(isSmooth);
  // Starting or stopping, the reveal stands at the whole text: a stop flushes, a start reveals only what comes next.
  if (wasSmooth !== isSmooth) {
    setWasSmooth(isSmooth);
    setCount(text.length);
  }
  const position = useRef(text.length);

  useEffect(() => {
    if (!isSmooth) {
      position.current = text.length;
      return;
    }
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      position.current = revealStep(position.current, text.length, now - last);
      last = now;
      setCount(Math.floor(position.current));
      if (position.current < text.length) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [text, isSmooth]);

  return isSmooth ? revealedText(text, count) : text;
}
