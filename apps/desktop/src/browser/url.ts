import { getPrefs, type Prefs } from '../settings/prefs.ts';
import { toUrl } from './sites.ts';

const HISTORY_LIMIT = 50;

/** What the user typed in the address bar → a loadable URL, searching with the user's engine. */
export const normalizeUrl = (
  input: string,
  engine: Prefs['searchEngine'] = getPrefs().searchEngine,
) => toUrl(input, SEARCH_ENGINES[engine].url);

export const SEARCH_ENGINES = {
  duckduckgo: { name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=' },
  google: { name: 'Google', url: 'https://www.google.com/search?q=' },
  bing: { name: 'Bing', url: 'https://www.bing.com/search?q=' },
  kagi: { name: 'Kagi', url: 'https://kagi.com/search?q=' },
} satisfies Record<Prefs['searchEngine'], { name: string; url: string }>;

/** The address bar shows URLs without the scheme noise. */
export function displayUrl(url: string) {
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

/** Most recent first, deduplicated, capped. */
export function pushHistory(history: string[], url: string) {
  if (!url || url === 'about:blank') return history;
  return [url, ...history.filter((h) => h !== url)].slice(0, HISTORY_LIMIT);
}

/** The same path, query and hash on another server: the thread's page on the base branch's dev server. */
export function swapOrigin(url: string, origin: string) {
  try {
    const { pathname, search, hash } = new URL(url);
    return `${origin}${pathname}${search}${hash}`;
  } catch {
    return origin;
  }
}
