// Pure helpers for the system browser and search suggestions; no electron import, so tests run under plain node.

const SUFFIX = /\.(app|exe|desktop)$/i;

/**
 * The default browser's display name from what the OS reports (`app.getApplicationNameForProtocol`): "Arc", "Google Chrome".
 * Windows and Linux can report a file or desktop id (`chrome.exe`, `org.mozilla.firefox.desktop`); those are tidied into a name.
 * Empty when there is nothing usable, so callers fall back to "your browser".
 */
export function browserLabel(reported: string, self: string) {
  const name = reported.trim().replace(SUFFIX, '');
  if (!name || name.toLowerCase() === self.toLowerCase() || /^electron$/i.test(name)) return '';
  if (/\s/.test(name) || /[A-Z]/.test(name)) return name;
  // A lowercase id: its last dotted part, dashes as spaces, capitalised (`google-chrome` → "Google Chrome").
  const last = name.split('.').pop()!;
  return last.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export const SUGGEST_URLS = {
  duckduckgo: 'https://duckduckgo.com/ac/?type=list&q=',
  google: 'https://suggestqueries.google.com/complete/search?client=firefox&q=',
  bing: 'https://api.bing.com/osjson.aspx?query=',
  kagi: 'https://kagi.com/api/autosuggest?q=',
} as const;

export type SuggestEngine = keyof typeof SUGGEST_URLS;

const SUGGEST_LIMIT = 6;

/** Every engine answers in the OpenSearch shape `[query, [suggestion, …], …]`; anything else is no suggestions. */
export function parseSuggestions(body: unknown) {
  if (!Array.isArray(body) || !Array.isArray(body[1])) return [];
  return body[1].filter((s): s is string => typeof s === 'string' && s.length > 0 && s.length <= 200).slice(0, SUGGEST_LIMIT);
}
