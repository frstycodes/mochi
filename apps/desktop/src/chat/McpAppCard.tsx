import { useQuery } from '@tanstack/react-query';
import { lazy, Suspense } from 'react';
import { Grid, Warning } from '@/icons';
import { START_HEIGHT } from './mcpApps';
import { Skeleton } from '@/components/ui/skeleton';
import { host } from '../host';
import { useLibraryNames } from '../library/names';
import type { McpWidget } from '../model';
import { EmbedFrame } from '../viz/EmbedFrame';
import { queryKeys } from '../queryKeys';

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
        <Suspense fallback={<FrameSkeleton />}>
          <McpAppFrame
            key={resource.html}
            widget={widget}
            resource={resource}
          />
        </Suspense>
      ) : (
        <FrameSkeleton />
      )}
    </EmbedFrame>
  );
}

// Lazy: the MCP Apps bridge brings the MCP client with it, which the app's first screen never needs.
const McpAppFrame = lazy(() =>
  import('./McpAppFrame').then((m) => ({ default: m.McpAppFrame })),
);

function useWidgetResource(threadId: string, { server, uri }: McpWidget) {
  const widgetQuery = useQuery({
    queryKey: queryKeys.agent.widget(threadId, server, uri),
    queryFn: () => host.agent.readWidget(threadId, server, uri),
  });
  return { resource: widgetQuery.data, error: widgetQuery.error?.message };
}

function FrameSkeleton() {
  return (
    <Skeleton
      style={{ height: START_HEIGHT }}
      className="w-full rounded-none"
    />
  );
}

function WidgetError({ title, error }: { title: string; error: string }) {
  return (
    <div className="flex gap-2 type-caption text-muted-foreground">
      <Warning aria-hidden className="mt-px size-3.5 shrink-0" />
      <p className="min-w-0">
        Couldn't open {title}'s view
        <span className="block text-subtle-foreground">{error}</span>
      </p>
    </div>
  );
}
