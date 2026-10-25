/// <reference types="vite/client" />
import { Capabilities } from '@mochi/schema';

/**
 * The page `mochi serve` serves: the desktop build, loaded over http with no preload. The dev server and the artifact
 * build keep the demo hosts beside this file.
 */
export const isServed =
  typeof window !== 'undefined' &&
  !window.harnessHost &&
  import.meta.env.MODE === 'electron' &&
  location.protocol.startsWith('http');

const TOKEN_KEY = 'mochi.coreToken';

/** Core's socket on the origin that served the page. The token arrives once as `#token=…` and lives for the tab. */
export function servedCoreUrl() {
  const token = takeToken();
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${scheme}://${location.host}/ws?v=${Capabilities.PROTOCOL_VERSION}#${token}`;
}

function takeToken() {
  const given = new URLSearchParams(location.hash.slice(1)).get('token');
  if (given) {
    sessionStorage.setItem(TOKEN_KEY, given);
    history.replaceState(null, '', location.pathname + location.search);
  }
  // GAP: a browser prompt until the served UI has a sign-in screen.
  const token =
    sessionStorage.getItem(TOKEN_KEY) ?? prompt('Mochi Core token') ?? '';
  sessionStorage.setItem(TOKEN_KEY, token);
  return token;
}
