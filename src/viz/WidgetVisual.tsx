import { createContext, useContext, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { useHarness } from '../store';
import { readWidgetMessage } from './fence';

/**
 * Agent-written SVG or HTML in an opaque-origin iframe: scripts run, but with no access to the app, its storage,
 * cookies or the network (CSP `default-src 'none'`). Theme tokens come in by postMessage; size and `sendPrompt` go out.
 */
export function WidgetVisual({ source, title }: { source: string; title: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const id = useId();
  const threadId = useVizThreadId();
  const { dispatch } = useHarness();
  const scheme = useColorScheme();
  const [height, setHeight] = useState(INITIAL_HEIGHT);
  const [srcDoc] = useState(() => widgetDocument(source, id, scheme));

  // The theme goes out on load too, and the widget answers it with its size: sizes posted before this component's listener attached are lost.
  const postTheme = () => frame.current?.contentWindow?.postMessage({ type: 'harness-theme', vars: themeVars(), scheme }, '*');
  useEffect(postTheme, [scheme]);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow) return;
      const message = readWidgetMessage(e.data, id);
      if (!message) return;
      if (message.type === 'size') return setHeight(Math.min(Math.max(message.height, MIN_HEIGHT), MAX_HEIGHT));
      // Focus moves into the iframe only when the reader clicks or tabs into it, so a widget can't prompt on load.
      if (document.activeElement !== frame.current) return;
      dispatch({ type: 'say', threadId, entry: { who: 'you', kind: 'message', text: message.text } });
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [id, threadId, dispatch]);

  return (
    <iframe
      ref={frame}
      title={title}
      sandbox="allow-scripts"
      srcDoc={srcDoc}
      onLoad={postTheme}
      className="block w-full rounded-md border-0 bg-transparent"
      style={{ height, colorScheme: scheme }}
    />
  );
}

const INITIAL_HEIGHT = 160;
const MIN_HEIGHT = 32;
const MAX_HEIGHT = 900;

const VizThreadContext = createContext<string | null>(null);

export const VizThreadProvider = VizThreadContext.Provider;

export function useVizThreadId() {
  const id = useContext(VizThreadContext);
  if (!id) throw new Error('Widgets must render inside <VizThreadProvider>, which names the thread sendPrompt writes to');
  return id;
}

const TOKENS = ['background', 'foreground', 'card', 'card-foreground', 'muted', 'muted-foreground', 'subtle-foreground', 'border', 'primary', 'primary-foreground', 'accent', 'success', 'warning', 'destructive', 'chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5', 'chart-grid', 'chart-axis'];

function themeVars() {
  const css = getComputedStyle(document.documentElement);
  return Object.fromEntries(TOKENS.map((t) => [`--${t}`, css.getPropertyValue(`--${t}`).trim()]));
}

// next-themes writes the resolved theme to <html data-theme> in its own effect; reading tokens on React's theme state
// instead could beat that write and send the previous theme's colours.
function useColorScheme() {
  return useSyncExternalStore(subscribeTheme, () => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'));
}

function subscribeTheme(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => observer.disconnect();
}

const CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:";

function widgetDocument(source: string, id: string, scheme: 'light' | 'dark') {
  const root = Object.entries(themeVars())
    .map(([k, v]) => `${k}:${v}`)
    .join(';');
  const bootstrap = `(() => {
  const post = (m) => parent.postMessage({ source: 'harness-widget', id: ${JSON.stringify(id)}, ...m }, '*');
  window.sendPrompt = (text) => post({ type: 'prompt', text: String(text) });
  addEventListener('message', (e) => {
    if (e.source !== parent || !e.data || e.data.type !== 'harness-theme') return;
    for (const [k, v] of Object.entries(e.data.vars)) document.documentElement.style.setProperty(k, v);
    document.documentElement.style.colorScheme = e.data.scheme;
    size();
  });
  const size = () => post({ type: 'size', height: Math.ceil(document.documentElement.getBoundingClientRect().height) });
  addEventListener('DOMContentLoaded', () => { new ResizeObserver(size).observe(document.documentElement); size(); });
})();`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${CSP}">
<style>:root{${root};color-scheme:${scheme}}html,body{margin:0;background:transparent;color:var(--foreground);font:13px/20px 'Inter Variable',system-ui,sans-serif}body>svg{display:block;max-width:100%;height:auto;margin:auto}</style>
<script>${bootstrap.replaceAll('</', '<\\/')}</script></head><body>${source}</body></html>`;
}
