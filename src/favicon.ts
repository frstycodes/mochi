import { getDomain } from 'tldts';

export function faviconUrl(host: string, size = 32) {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=${size}`;
}

export function faviconFallback(src: string) {
  if (!src.startsWith('https://www.google.com/s2/favicons?')) return null;
  const url = new URL(src);
  const host = url.searchParams.get('domain') ?? '';
  // Private suffixes count too, so `my-mcp.vercel.app` stops at itself instead of borrowing Vercel's icon.
  const domain = getDomain(host, { allowPrivateDomains: true });
  if (!domain || domain === host) return null;
  url.searchParams.set('domain', domain);
  return url.href;
}
