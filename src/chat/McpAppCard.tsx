import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { Warning } from 'reicon-react';
import { AppBridge, buildAllowAttribute, PostMessageTransport, type McpUiHostContext, type McpUiResourceCsp, type McpUiResourcePermissions } from '@modelcontextprotocol/ext-apps/app-bridge';
import { withCsp } from './mcpApps';
import { Skeleton } from '@/components/ui/skeleton';
import { openExternally } from '../browser/systemBrowser';
import { host } from '../host';
import type { McpWidget, McpWidgetResource } from '../model';
import type { ThemeSlot } from '../themes/model';
import { useColorTheme } from '../themes/store';

const HOST = { name: 'Mochi', version: '1' };
/** Before the view reports its size. */
const START_HEIGHT = 160;

/**
 * A tool call's MCP App view (SEP-1865): the server's own HTML in a sandboxed frame, handed the call's input and result over
 * `AppBridge`. The frame has no origin of its own (no `allow-same-origin`) and a CSP built from what the resource asked for.
 */
export function McpAppCard({ threadId, widget }: { threadId: string; widget: McpWidget }) {
  const { resource, error } = useWidgetResource(threadId, widget);
  if (error) return <WidgetError server={widget.server} error={error} />;
  if (!resource) return <Skeleton style={{ height: START_HEIGHT }} className="w-full rounded-xl" />;
  return <McpAppFrame widget={widget} resource={resource} />;
}

function useWidgetResource(threadId: string, { server, uri }: McpWidget) {
  const [state, setState] = useState<{ resource?: McpWidgetResource; error?: string }>({});
  useEffect(() => {
    let isCurrent = true;
    host.agent.readWidget(threadId, server, uri).then(
      (resource) => isCurrent && setState({ resource }),
      (error: unknown) => isCurrent && setState({ error: error instanceof Error ? error.message : String(error) }),
    );
    return () => void (isCurrent = false);
  }, [threadId, server, uri]);
  return state;
}

export function McpAppFrame({ widget, resource }: { widget: McpWidget; resource: McpWidgetResource }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const bridge = useRef<AppBridge>(null);
  const [height, setHeight] = useState(START_HEIGHT);
  const { mode } = useColorTheme();
  const ui = resource.meta?.ui as { csp?: McpUiResourceCsp; permissions?: McpUiResourcePermissions } | undefined;
  const startContext = useEffectEvent(() => hostContext(mode));

  useEffect(() => {
    const view = frame.current?.contentWindow;
    if (!view) return;
    const b = new AppBridge(null, HOST, { openLinks: {} }, { hostContext: startContext() });
    b.addEventListener('sizechange', (size) => size.height !== undefined && setHeight(size.height));
    b.addEventListener('initialized', () => {
      void b.sendToolInput({ arguments: widget.input });
      void b.sendToolResult(widget.result);
    });
    b.onopenlink = async ({ url }) => {
      if (!/^https?:\/\//i.test(url)) return { isError: true };
      openExternally(url);
      return {};
    };
    // The frame's window outlives its srcdoc load, so connecting now catches the view's first message.
    void b.connect(new PostMessageTransport(view, view));
    bridge.current = b;
    return () => {
      bridge.current = null;
      void b.close();
    };
  }, [widget, resource]);

  useEffect(() => bridge.current?.setHostContext(hostContext(mode)), [mode]);

  return <iframe ref={frame} title={`${widget.server} view`} sandbox="allow-scripts allow-forms" allow={buildAllowAttribute(ui?.permissions)} srcDoc={withCsp(resource.html, ui?.csp)} style={{ height }} className="block w-full" />;
}

const hostContext = (theme: ThemeSlot): McpUiHostContext => ({ theme, displayMode: 'inline', availableDisplayModes: ['inline'], platform: 'desktop', locale: navigator.language, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone });

function WidgetError({ server, error }: { server: string; error: string }) {
  return (
    <div className="flex gap-2 type-caption text-muted-foreground">
      <Warning aria-hidden className="mt-px size-3.5 shrink-0" />
      <p className="min-w-0">
        Couldn't open {server}'s view
        <span className="block text-subtle-foreground">{error}</span>
      </p>
    </div>
  );
}
