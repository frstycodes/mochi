import { bestPassage } from './bestPassage.ts';

const HIGHLIGHT = 'harness-logbook';
const BLOCKS = 'p, li, pre, blockquote, h1, h2, h3, h4, td';
// Rows mount after the scroll lands: about a second of frames.
const TRIES = 60;

let clear = () => {};

/**
 * Paints the passage of the message at activity `index` that `about` came from (CSS Custom Highlight API, like pins), and
 * brings it into view; the whole message when no passage stands out. It stays until the next click.
 */
export function highlightPassage(
  scope: HTMLElement,
  index: number,
  about: string,
) {
  if (typeof CSS === 'undefined' || !('highlights' in CSS)) return;
  clear();
  let frame = 0;
  let tries = 0;
  let isShown = false;
  const paint = () => {
    frame = 0;
    const target = passageOf(scope, index, about);
    if (!target) {
      if (!isShown && ++tries < TRIES) frame = requestAnimationFrame(paint);
      return;
    }
    const range = new Range();
    range.selectNodeContents(target);
    CSS.highlights.set(HIGHLIGHT, new Highlight(range));
    if (isShown) return;
    isShown = true;
    target.scrollIntoView({ block: 'center' });
  };
  // Messages render their markdown asynchronously and replace their nodes, which empties a range set on the old ones.
  const observer = new MutationObserver(
    () => (frame ||= requestAnimationFrame(paint)),
  );
  observer.observe(scope, { childList: true, subtree: true });
  clear = () => {
    observer.disconnect();
    cancelAnimationFrame(frame);
    CSS.highlights.delete(HIGHLIGHT);
    window.removeEventListener('pointerdown', clear, true);
    clear = () => {};
  };
  window.addEventListener('pointerdown', clear, true);
  paint();
}

function passageOf(scope: HTMLElement, index: number, about: string) {
  const message = scope.querySelector(`[data-activity-index="${index}"]`);
  if (!message) return null;
  const blocks = leafBlocks(message);
  const best = bestPassage(
    blocks.map((b) => b.textContent ?? ''),
    about,
  );
  return blocks[best] ?? message;
}

// A list item holding paragraphs is not a passage of its own: its paragraphs are.
const leafBlocks = (message: Element) =>
  [...message.querySelectorAll(BLOCKS)].filter((b) => !b.querySelector(BLOCKS));
