import type { McpUiResourceCsp } from '@modelcontextprotocol/ext-apps/app-bridge';

// A source the server names goes into the policy as is; anything that could close the directive or the attribute is dropped.
const SOURCE = /^[a-z0-9*.:/_-]+$/i;

/** The resource's HTML behind a CSP meta tag: only the domains `_meta.ui.csp` declares, nothing else from the network. */
export function withCsp(html: string, csp: McpUiResourceCsp = {}) {
  const list = (domains: string[] | undefined, none = "'none'") => domains?.filter((d) => SOURCE.test(d)).join(' ') || none;
  const resources = list(csp.resourceDomains, '');
  const policy = [`default-src 'none'`, `script-src 'unsafe-inline' ${resources}`, `style-src 'unsafe-inline' ${resources}`, `img-src data: blob: ${resources}`, `font-src data: ${resources}`, `media-src data: blob: ${resources}`, `connect-src ${list(csp.connectDomains)}`, `frame-src ${list(csp.frameDomains)}`, `base-uri ${list(csp.baseUriDomains)}`].join('; ');
  const meta = `<meta http-equiv="Content-Security-Policy" content="${policy}">`;
  // The policy binds only what comes after it, so it goes first in <head>.
  return /<head(\s[^>]*)?>/i.test(html) ? html.replace(/<head(\s[^>]*)?>/i, (head) => head + meta) : meta + html;
}
