import { useLayoutEffect, useRef } from 'react';
import { animate, mix } from 'motion/react';
import type { EditorView } from '@codemirror/view';
import { prefersReducedMotion } from '../settings/prefs';
import {
  claimSend,
  finishSend,
  handOnSend,
  recordSend,
  type SendOrigin,
} from './sendFlight';

/** iMessage's send: a quarter second, no bounce, since nothing threw it. */
export const SEND_SPRING = {
  type: 'spring',
  visualDuration: 0.25,
  bounce: 0,
} as const;

/** Notes where the composer's text sits as you send, for the bubble that shows it to fly from. Reduced motion: it just appears. */
export function launchSend(threadId: string, view: EditorView | null) {
  if (!view || prefersReducedMotion()) return;
  const text = view.coordsAtPos(0);
  const card = view.dom.closest('[data-composer]');
  if (!text || !card) return;
  recordSend(threadId, {
    box: view.dom.getBoundingClientRect(),
    text: { left: text.left, top: text.top, height: text.bottom - text.top },
    radius: parseFloat(getComputedStyle(card).borderTopLeftRadius),
    opacity: 0,
  });
}

/** Put the ref on the bubble of the message `key`; if it is the one just sent in `threadId`, it lands from the composer. */
export function useSendLanding(threadId: string, key: string | undefined) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const bubble = ref.current;
    if (!key || !bubble) return;
    const origin = claimSend(threadId, key);
    if (origin) return fly(origin, bubble, key);
  }, [threadId, key]);
  return ref;
}

/**
 * A copy of the bubble flies above the composer while the real one stays hidden in place: the transcript sits under the composer's
 * glass, so the bubble itself can't rise out of it. The fill scales from the composer's text area to the bubble with its corners
 * counter-scaled; the text only travels, so it never stretches. It aims at the bubble's live box, which the chat scrolls as it lands.
 */
function fly(origin: SendOrigin, bubble: HTMLElement, key: string) {
  const end = bubble.getBoundingClientRect();
  const style = getComputedStyle(bubble);
  const radius = parseFloat(style.borderTopLeftRadius);
  // From the first character's box to the bubble's corner.
  const inset = {
    left: parseFloat(style.paddingLeft),
    top:
      parseFloat(style.paddingTop) +
      (parseFloat(style.lineHeight) - origin.text.height) / 2,
  };
  const { ghost, fill, text } = ghostOf(bubble, end, style);
  bubble.style.visibility = 'hidden';
  fadeInImages(bubble);

  let now = origin;
  const place = (p: number) => {
    const to = bubble.getBoundingClientRect();
    const box = new DOMRect(
      mix(origin.box.left, to.left, p),
      mix(origin.box.top, to.top, p),
      mix(origin.box.width, to.width, p),
      mix(origin.box.height, to.height, p),
    );
    const left = mix(origin.text.left - inset.left, to.left, p);
    const top = mix(origin.text.top - inset.top, to.top, p);
    now = {
      box,
      text: { ...origin.text, left: left + inset.left, top: top + inset.top },
      radius: mix(origin.radius, radius, p),
      opacity: mix(origin.opacity, 1, p),
    };
    const scaleX = box.width / end.width;
    const scaleY = box.height / end.height;
    fill.style.transform = `translate(${box.left}px, ${box.top}px) scale(${scaleX}, ${scaleY})`;
    fill.style.borderRadius = `${now.radius / scaleX}px / ${now.radius / scaleY}px`;
    fill.style.opacity = String(now.opacity);
    text.style.transform = `translate(${left}px, ${top}px)`;
  };
  place(0);
  const flight = animate(0, 1, { ...SEND_SPRING, onUpdate: place });
  const show = () => {
    flight.stop();
    ghost.remove();
    bubble.style.visibility = '';
  };
  let isLanded = false;
  void flight.then(() => {
    isLanded = true;
    finishSend(key);
    show();
  });
  return () => {
    if (!isLanded) handOnSend(key, now);
    show();
  };
}

/** A fixed copy of the bubble with its fill as its own layer. The root takes the message's classes so `group-[.is-user]` styles still apply. */
function ghostOf(
  bubble: HTMLElement,
  end: DOMRect,
  style: CSSStyleDeclaration,
) {
  const ghost = document.createElement('div');
  ghost.className = bubble.closest('.is-user')?.className ?? '';
  ghost.ariaHidden = 'true';
  Object.assign(ghost.style, {
    position: 'fixed',
    inset: '0 auto auto 0',
    width: `${end.width}px`,
    height: `${end.height}px`,
    maxWidth: 'none',
    margin: '0',
    pointerEvents: 'none',
    zIndex: '50',
  });
  const fill = document.createElement('div');
  Object.assign(fill.style, {
    position: 'absolute',
    inset: '0',
    transformOrigin: '0 0',
    background: style.backgroundColor,
  });
  const text = bubble.cloneNode(true) as HTMLElement;
  Object.assign(text.style, {
    position: 'absolute',
    inset: '0',
    margin: '0',
    background: 'transparent',
  });
  ghost.append(fill, text);
  document.body.append(ghost);
  return { ghost, fill, text };
}

/** Images sent with the message don't fly; they fade in under it. */
function fadeInImages(bubble: HTMLElement) {
  const images = bubble
    .closest('.is-user')
    ?.parentElement?.querySelector('[data-message-images]');
  images?.animate(
    { opacity: [0, getComputedStyle(images).opacity] },
    { duration: 200, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' },
  );
}
