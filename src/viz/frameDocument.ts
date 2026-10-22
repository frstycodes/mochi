import { useRef, type RefObject } from 'react';
import { host } from '../host';

// Served by electron/frameProtocol.ts with each kind's CSP header.
const SHELLS = { widget: 'mochi-widget://widget/', mcpApp: 'mochi-widget://mcp-app/' };

/**
 * iframe props that show `html` under its own policy. On desktop the app's CSP would bind a srcdoc frame, so the frame
 * loads a shell and the HTML is posted into it on the shell's load; later loads go to `onLoad`. The web build has no app CSP.
 */
export function useFrameDocument(frame: RefObject<HTMLIFrameElement | null>, kind: keyof typeof SHELLS, html: string, onLoad?: () => void) {
  const isWritten = useRef(false);
  if (!host.isDesktop) return { srcDoc: html, onLoad };
  return {
    src: SHELLS[kind],
    onLoad: () => {
      if (isWritten.current) return onLoad?.();
      isWritten.current = true;
      frame.current?.contentWindow?.postMessage({ frameHtml: html }, '*');
    },
  };
}
