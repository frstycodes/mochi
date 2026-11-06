import { useEffect, useEffectEvent, useRef, useState } from 'react';
import {
  AppBridge,
  buildAllowAttribute,
  PostMessageTransport,
  type McpUiHostContext,
  type McpUiResourceCsp,
  type McpUiResourcePermissions,
} from '@modelcontextprotocol/ext-apps/app-bridge';
import type { ThemeSlot } from '@mochi/domain/themes/model';
import { START_HEIGHT, withCsp } from './mcpApps';
import { openExternally } from '../browser/systemBrowser';
import { namesNow } from '../library/names';
import type { McpWidget, McpWidgetResource } from '../model';
import { useColorTheme } from '../themes/store';
import { useFrameDocument } from '../viz/frameDocument';

const HOST = { name: 'Mochi', version: '1' };

/** The server's view, connected over `AppBridge` and sized to what it reports. */
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
