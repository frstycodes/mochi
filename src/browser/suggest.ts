import { displayUrl } from './url.ts';

/** Something the address bar can offer: an open tab to switch to, a running dev server, or a page from history. */
export interface Candidate {
  kind: 'tab' | 'server' | 'history';
  url: string;
  title: string;
  /** The pane tab an open-tab candidate switches to. */
  tabId?: string;
}

const LIMIT = 6;
const KIND_BONUS = { tab: 15, server: 10, history: 0 } satisfies Record<
  Candidate['kind'],
  number
>;

/**
 * Candidates matching `query`, best first, one per URL. The URL's start beats a word in the title beats anywhere in either;
 * open tabs and dev servers beat history, recent history beats old, and shorter URLs win ties so a site's root completes
 * before its deep pages. An empty query lists open tabs, then servers, then recent history.
 */
export function rankSuggestions(
  query: string,
  candidates: Candidate[],
  limit = LIMIT,
) {
  const q = query.trim().toLowerCase();
  const scored = candidates.flatMap((c, i) => {
    const score = matchScore(q, c);
    if (score === null) return [];
    // Recency only counts within history, which arrives most recent first.
    const recency = c.kind === 'history' ? Math.max(0, 5 - i * 0.1) : 0;
    return [
      {
        c,
        score: score + KIND_BONUS[c.kind] + recency - bare(c.url).length * 0.1,
      },
    ];
  });
  scored.sort((a, b) => b.score - a.score);
  const seen = new Set<string>();
  return scored
    .filter(({ c }) => {
      const key = bare(c.url);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit)
    .map(({ c }) => c);
}

function matchScore(q: string, c: Candidate) {
  if (!q) return 0;
  const url = bare(c.url).toLowerCase();
  const title = c.title.toLowerCase();
  if (url.startsWith(q)) return 100;
  if (url.split(/[./?#=&:-]/).some((part) => part.startsWith(q))) return 70;
  if (title.split(/\s+/).some((word) => word.startsWith(q))) return 60;
  if (url.includes(q)) return 40;
  if (title.includes(q)) return 30;
  return null;
}

/**
 * The rest of `url` after what was typed, for inline completion in the field: `gith` + `https://www.github.com/` → `ub.com`.
 * Null unless the URL as shown (no scheme, no `www.`) starts with the typed text; spaces mean a search, never a completion.
 */
export function inlineCompletion(typed: string, url: string) {
  if (!typed || /\s/.test(typed)) return null;
  const shown = bare(url);
  if (
    !shown.toLowerCase().startsWith(typed.toLowerCase()) ||
    shown.length === typed.length
  )
    return null;
  return shown.slice(typed.length);
}

/** The URL as people type it: no scheme, no `www.`, no trailing slash. */
export function bare(url: string) {
  return displayUrl(url).replace(/^www\./, '');
}
