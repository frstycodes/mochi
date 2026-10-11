const HISTORY_LIMIT = 50;

/** What the user typed in the address bar → a loadable URL. Bare hosts get a scheme, anything else becomes a search. */
export function normalizeUrl(input: string) {
  const text = input.trim();
  if (!text) return 'about:blank';
  if (/^(https?|about):/i.test(text)) return text;
  if (/^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0|[\w-]+\.(localhost|test))(:\d+)?(\/|$)/i.test(text) || /^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/|$)/.test(text)) return `http://${text}`;
  if (/^:\d+(\/|$)/.test(text)) return `http://localhost${text}`;
  if (!/\s/.test(text) && /^[\w-]+(\.[\w-]+)+(:\d+)?(\/.*)?$/.test(text)) return `https://${text}`;
  return `https://duckduckgo.com/?q=${encodeURIComponent(text)}`;
}

/** The address bar shows URLs without the scheme noise. */
export function displayUrl(url: string) {
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

/** Most recent first, deduplicated, capped. */
export function pushHistory(history: string[], url: string) {
  if (!url || url === 'about:blank') return history;
  return [url, ...history.filter((h) => h !== url)].slice(0, HISTORY_LIMIT);
}
