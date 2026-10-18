export function faviconUrl(host: string, size = 32) {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=${size}`;
}

// GAP: keeps the last two labels, so a two-part suffix (`mcp.example.co.uk`) falls back to `co.uk` and shows the placeholder.
export function faviconFallback(src: string) {
  if (!src.startsWith('https://www.google.com/s2/favicons?')) return null;
  const url = new URL(src);
  const host = url.searchParams.get('domain') ?? '';
  const labels = host.split('.');
  if (labels.length <= 2 || /^[\d.]+$/.test(host)) return null;
  url.searchParams.set('domain', labels.slice(-2).join('.'));
  return url.href;
}
