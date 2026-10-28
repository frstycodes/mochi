/** Local means this machine or a dev domain: the agent browses those freely; anything else is logged, and forms there ask. */
export function isLocalUrl(url: string) {
  try {
    const { protocol, hostname } = new URL(url);
    if (protocol === 'about:' || protocol === 'file:') return true;
    return (
      /^(localhost|0\.0\.0\.0|\[::1\]|127(\.\d{1,3}){3})$/.test(hostname) ||
      /\.(localhost|test)$/.test(hostname)
    );
  } catch {
    return false;
  }
}

/**
 * Clicks that may not be undoable on someone else's site ask first: paying, sending, publishing, deleting. Ordinary steps
 * (Next, Create, Save, Continue, Allow, Sign in) go through; the user watches them in the pane.
 */
export const IRREVERSIBLE =
  /\b(pay|buy|purchase|order|checkout|check out|subscribe|send|publish|post|delete|remove|transfer|merge|deploy|withdraw|cancel (my )?(subscription|account)|close (my )?account)\b/i;

/** What the user typed in the address bar → a loadable URL. Bare hosts get a scheme, absolute paths become file:, anything else a search at `searchUrl`. */
export function toUrl(input: string, searchUrl: string) {
  const text = input.trim();
  if (!text) return 'about:blank';
  if (/^(https?|about|file):/i.test(text)) return text;
  if (text.startsWith('/')) return `file://${encodeURI(text)}`;
  if (
    /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0|[\w-]+\.(localhost|test))(:\d+)?(\/|$)/i.test(
      text,
    ) ||
    /^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/|$)/.test(text)
  )
    return `http://${text}`;
  if (/^:\d+(\/|$)/.test(text)) return `http://localhost${text}`;
  if (!/\s/.test(text) && /^[\w-]+(\.[\w-]+)+(:\d+)?(\/.*)?$/.test(text))
    return `https://${text}`;
  return searchUrl + encodeURIComponent(text);
}
