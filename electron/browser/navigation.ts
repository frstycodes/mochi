const ALLOWED = ['http:', 'https:', 'about:', 'file:'];

export const isAllowedUrl = (url: string) => ALLOWED.includes(protocol(url) ?? '');

/** Page-initiated hops: a web page can't send the tab to a local file; only the user, the agent or another file: page can. */
export const canNavigate = (from: string, to: string) => isAllowedUrl(to) && (protocol(to) !== 'file:' || protocol(from) === 'file:');

function protocol(url: string) {
  try {
    return new URL(url).protocol;
  } catch {
    return null;
  }
}
