import { useQuery } from '@tanstack/react-query';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { Grid, WarningAlt } from '@/icons';
import {
  AppBridge,
  buildAllowAttribute,
  PostMessageTransport,
  type McpUiHostContext,
  type McpUiResourceCsp,
  type McpUiResourcePermissions,
} from '@modelcontextprotocol/ext-apps/app-bridge';
import { withCsp } from './mcpApps';
import { Skeleton } from '@/components/ui/skeleton';
import { openExternally } from '../browser/systemBrowser';
import { host } from '../host';
import { namesNow, useLibraryNames } from '../library/names';
import type { McpWidget, McpWidgetResource } from '../model';
import type { ThemeSlot } from '@mochi/domain/themes/model';
import { useColorTheme } from '../themes/store';
import { EmbedFrame } from '../viz/EmbedFrame';
import { useFrameDocument } from '../viz/frameDocument';
import { queryKeys } from '../queryKeys';

const HOST = { name: 'Mochi', version: '1' };
/** Before the view reports its size. */
const START_HEIGHT = 160;

/**
 * A tool call's MCP App view (SEP-1865): the server's own HTML in a sandboxed frame, handed the call's input and result over
 * `AppBridge`. The frame has no origin of its own (no `allow-same-origin`) and a CSP built from what the resource asked for.
 */
export function McpAppCard({
  threadId,
  widget,
}: {
  threadId: string;
  widget: McpWidget;
}) {
  const { resource, error } = useWidgetResource(threadId, widget);
  const { title } = useLibraryNames().server(widget.server);
  if (error) return <WidgetError title={title} error={error} />;
  return (
    <EmbedFrame icon={Grid} title={title}>
      {resource ? (
        <McpAppFrame key={resource.html} widget={widget} resource={resource} />
      ) : (
        <Skeleton
          style={{ height: START_HEIGHT }}
          className="w-full rounded-none"
        />
      )}
    </EmbedFrame>
  );
}

function useWidgetResource(threadId: string, { server, uri }: McpWidget) {
  const widgetQuery = useQuery({
    queryKey: queryKeys.agent.widget(threadId, server, uri),
    queryFn: () => host.agent.readWidget(threadId, server, uri),
  });
  return { resource: widgetQuery.data, error: widgetQuery.error?.message };
}

export function McpAppFrame({
  widget,
  resource,
}: {
  widget: McpWidget;
  resource: McpWidgetResource;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const bridge = useRef<AppBridge>(null);
  const [height, setHeight] = useState(START_HEIGHT);
  const { mode } = useColorTheme();
  const ui = resource.meta?.ui as
    | { csp?: McpUiResourceCsp; permissions?: McpUiResourcePermissions }
    | undefined;
  const startContext = useEffectEvent(() => hostContext(mode));

  useEffect(() => {
    const view = frame.current?.contentWindow;
    if (!view) return;
    const b = new AppBridge(
      null,
      HOST,
      { openLinks: {} },
      { hostContext: startContext() },
    );
    b.addEventListener(
      'sizechange',
      (size) => size.height !== undefined && setHeight(size.height),
    );
    b.addEventListener('initialized', () => {
      void b.sendToolInput({ arguments: widget.input });
      void b.sendToolResult(widget.result);
    });
    b.onopenlink = async ({ url }) => {
      if (!/^https?:\/\//i.test(url)) return { isError: true };
      openExternally(url);
      return {};
    };
    // The frame's window outlives its document's load, so connecting now catches the view's first message.
    void b.connect(new PostMessageTransport(view, view));
    bridge.current = b;
    return () => {
      bridge.current = null;
      void b.close();
    };
  }, [widget]);

  useEffect(() => bridge.current?.setHostContext(hostContext(mode)), [mode]);
  const frameDocument = useFrameDocument(
    frame,
    'mcpApp',
    withCsp(resource.html, ui?.csp),
  );

  return (
    <iframe
      ref={frame}
      title={`${namesNow().server(widget.server).title} view`}
      sandbox="allow-scripts allow-forms"
      allow={buildAllowAttribute(ui?.permissions)}
      {...frameDocument}
      style={{ height }}
      className="block w-full"
    />
  );
}

const hostContext = (theme: ThemeSlot): McpUiHostContext => ({
  theme,
  displayMode: 'inline',
  availableDisplayModes: ['inline'],
  platform: 'desktop',
  locale: navigator.language,
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
});

function WidgetError({ title, error }: { title: string; error: string }) {
  return (
    <div className="flex gap-2 type-caption text-muted-foreground">
      <WarningAlt aria-hidden className="mt-px size-3.5 shrink-0" />
      <p className="min-w-0">
        Couldn't open {title}'s view
        <span className="block text-subtle-foreground">{error}</span>
      </p>
    </div>
  );
}
