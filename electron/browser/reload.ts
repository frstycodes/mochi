import { watch } from 'node:fs';
import { sep } from 'node:path';

// Build output, caches and VCS data change on every build; a reload for them would loop with the dev server's own writes.
const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', 'dist-electron', 'build', 'out', 'coverage', '.next', '.nuxt', '.svelte-kit', '.turbo', '.cache', '.vite', '.parcel-cache', '.output', 'target']);
// Editor swap and backup files, macOS metadata.
const IGNORED_FILE = /(^\.DS_Store$|~$|\.sw[a-p]$|^\.#|^#.*#$|\.tmp$)/;
// What dev servers print when they hot-swapped or reloaded the page themselves (Vite, webpack, Next's Fast Refresh, Parcel).
const HMR_LOG = /\[vite\] (hot updated|page reload|css hot updated)|\[HMR\]|\[Fast Refresh\]|\[parcel\] .*(updated|reload)/i;

export const DEBOUNCE_MS = 250;
// How long a dev server gets to hot-reload a change before Mochi reloads the page itself.
export const HMR_GRACE_MS = 1200;
// A remembered scroll position only restores a load that starts this soon after it was taken.
const SCROLL_FRESH_MS = 10_000;

/** `rel` is relative to the watched root, in the platform's separators. */
export function isIgnored(rel: string) {
  const parts = rel.split(sep).filter(Boolean);
  return parts.some((p) => IGNORED_DIRS.has(p)) || IGNORED_FILE.test(parts.at(-1) ?? '');
}

export const isHmrLog = (message: string) => HMR_LOG.test(message);

/** Trailing-edge debounce: a burst of saves (format on save, a branch switch) is one change. */
export function debounce(fn: () => void, ms: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const call = () => {
    clearTimeout(timer);
    timer = setTimeout(fn, ms);
  };
  call.cancel = () => clearTimeout(timer);
  return call;
}

/**
 * Recursive watch (native on macOS and Windows), debounced, ignoring build and VCS dirs. `onChange` gets the time of the burst's
 * first write, so a dev server that reacted inside the debounce still counts as having handled it. Returns the stop function.
 */
export function watchTree(root: string, onChange: (since: number) => void) {
  let since = 0;
  const fire = debounce(() => {
    onChange(since);
    since = 0;
  }, DEBOUNCE_MS);
  const watcher = watch(root, { recursive: true }, (_event, file) => {
    if (!file || isIgnored(file.toString())) return;
    since ||= Date.now();
    fire();
  });
  // A deleted root or a permission error ends the watch; the toggle simply stops doing anything.
  watcher.on('error', () => watcher.close());
  return () => {
    fire.cancel();
    watcher.close();
  };
}

export interface ScrollPos {
  x: number;
  y: number;
}

/** Last scroll position per URL (hash ignored), handed back once to the next load of that URL if it comes soon enough. */
export class ScrollMemory {
  #byUrl = new Map<string, ScrollPos & { at: number }>();

  remember(url: string, pos: ScrollPos, now = Date.now()) {
    this.#byUrl.set(key(url), { ...pos, at: now });
  }

  take(url: string, now = Date.now()): ScrollPos | null {
    const k = key(url);
    const found = this.#byUrl.get(k);
    this.#byUrl.delete(k);
    if (!found || now - found.at > SCROLL_FRESH_MS || (found.x === 0 && found.y === 0)) return null;
    return { x: found.x, y: found.y };
  }
}

function key(url: string) {
  return url.split('#')[0];
}

export const READ_SCROLL_SCRIPT = '({ x: Math.round(scrollX), y: Math.round(scrollY) })';

/** Retries until the page is tall enough: an SPA renders its content a few frames after the load event. */
export const restoreScrollScript = ({ x, y }: ScrollPos) =>
  `(async () => { for (let i = 0; i < 40; i++) { scrollTo(${x}, ${y}); if (Math.abs(scrollY - ${y}) < 2) return true; await new Promise((r) => setTimeout(r, 50)); } return false; })()`;
