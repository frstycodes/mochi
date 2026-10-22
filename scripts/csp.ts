import { createHash } from 'node:crypto';
import type { Plugin } from 'vite-plus';

// The app window's Content Security Policy, as a <meta> first in <head>.
// The Electron build loads its chunks as files, so script-src is 'self'; any inline script (a single-file build) is allowed by hash.
export function csp(): Plugin {
  return {
    name: 'mochi-csp',
    enforce: 'post',
    transformIndexHtml: {
      order: 'post',
      handler: (html, { server }) => (server ? withPolicy(html, DEV) : html),
    },
    generateBundle(_, bundle) {
      for (const file of Object.values(bundle)) {
        if (file.type !== 'asset' || !file.fileName.endsWith('.html')) continue;
        const html = String(file.source);
        file.source = withPolicy(html, { ...BASE, 'script-src': ["'self'", ...inlineScriptHashes(html)] });
      }
    },
  };
}

const BASE = {
  'default-src': ["'none'"],
  'script-src': ["'self'"],
  // React style props, katex, mermaid's SVG <style> and shiki's token colours are all inline styles.
  'style-src': ["'self'", "'unsafe-inline'"],
  // Favicons of any site (browser tabs, connectors, avatars) and http dev servers'; blob: for files read through the host.
  'img-src': ["'self'", 'data:', 'blob:', 'https:', 'http://localhost:*', 'http://127.0.0.1:*'],
  // Fonts (Inter, katex) are inlined as data: URLs by the build.
  'font-src': ["'self'", 'data:'],
  'media-src': ["'self'", 'data:', 'blob:'],
  // Image copies and attachments fetch their own data:/blob: URLs; Open VSX is the theme gallery and its CDN.
  'connect-src': ["'self'", 'data:', 'blob:', 'https://open-vsx.org', 'https://openvsx.eclipsecontent.org'],
  // Widgets and MCP app views get their own policy from electron/frameProtocol.ts; PDF previews are blob: URLs.
  'frame-src': ['mochi-widget:', 'blob:'],
  'base-uri': ["'none'"],
  'form-action': ["'none'"],
} satisfies Record<string, string[]>;

// Vite's client and the React Refresh preamble are inline scripts, and HMR talks over a websocket.
const DEV = { ...BASE, 'script-src': ["'self'", "'unsafe-inline'"], 'connect-src': [...BASE['connect-src'], 'ws://localhost:*'] };

function withPolicy(html: string, policy: Record<string, string[]>) {
  const content = Object.entries(policy)
    .map(([directive, sources]) => [directive, ...sources].join(' '))
    .join('; ');
  // A <meta> policy binds only what the parser meets after it.
  return html.replace(/<head>/i, `<head><meta http-equiv="Content-Security-Policy" content="${content}">`);
}

// Same end-of-script rule as the HTML parser: the first `</script>` closes it, so the bundle has it escaped.
function inlineScriptHashes(html: string) {
  return [...html.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(([, body]) => `'sha256-${createHash('sha256').update(body).digest('base64')}'`);
}
