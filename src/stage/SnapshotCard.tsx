import { useQuery } from '@tanstack/react-query';
import { memo } from 'react';
import { GlobeAlt } from '@/icons';
import { host } from '@/host';
import { cn } from '@/lib/utils';
import { pageKey, usePage } from '../browser/pages';
import { LiveDot, ProgressRing, ProviderMark } from '../ui';
import type { ThreadSnapshot } from './snapshot';
import { queryKeys } from '../queryKeys';

/** A thread as a card: title, progress, the step in flight, the last message and a preview frame, all from a snapshot. */
export const SnapshotCard = memo(function SnapshotCard({ snap, className }: { snap: ThreadSnapshot; className?: string }) {
  const needsYou = snap.status === 'needs-you';
  return (
    <div className={cn('flex flex-col overflow-hidden rounded-xl bg-card text-left shadow-popover', className)}>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-1.5 p-3">
        <div className="flex items-center gap-2">
          <ProgressRing met={snap.met} total={snap.total} slot={snap.line} size={14} isWorking={snap.isWorking} />
          <span className="min-w-0 flex-1 truncate type-title">{snap.title}</span>
          {needsYou && <LiveDot className="text-warning" />}
        </div>
        <p className="flex min-w-0 gap-1.5 type-meta text-muted-foreground">
          {!!snap.total && <span className="shrink-0 tabular">{snap.met}/{snap.total}</span>}
          <span className={cn('truncate', needsYou && 'text-foreground')}>{snap.nowStep}</span>
        </p>
        {!!snap.lastMessage && (
          <p className="flex min-h-0 gap-1.5 type-meta text-subtle-foreground">
            {(snap.lastMessage.who === 'claude' || snap.lastMessage.who === 'codex') && <ProviderMark provider={snap.lastMessage.who} size={12} className="mt-[3px] shrink-0" />}
            <span className="line-clamp-2">{snap.lastMessage.text}</span>
          </p>
        )}
      </div>
      {!!snap.preview && <PreviewFrame threadId={snap.id} tabId={snap.preview.tabId} url={snap.preview.url} />}
    </div>
  );
});

const CAPTURE_MS = 1000;

/**
 * The preview tab's last frame. Desktop captures the native view once a second; the web build has no view to capture
 * (its pages are React trees, and cards never mount one), so it shows the address only.
 */
function PreviewFrame({ threadId, tabId, url }: { threadId: string; tabId: string; url: string }) {
  const hostId = usePage(pageKey(threadId, tabId), url).hostId;
  const frameQuery = useQuery({ queryKey: queryKeys.stage.previewFrame(hostId), queryFn: () => host.browser.capture(hostId!, { fullPage: false }), enabled: !!hostId, refetchInterval: CAPTURE_MS });
  const frame = frameQuery.data;

  return (
    <div className="flex min-h-0 shrink flex-col overflow-hidden bg-sidebar">
      <span className="flex items-center gap-1 px-3 py-1 font-mono type-caption text-subtle-foreground">
        <GlobeAlt className="size-3 shrink-0" />
        <span className="truncate">{url}</span>
      </span>
      {!!frame && <img src={frame} alt="" className="min-h-0 w-full object-cover object-top" />}
    </div>
  );
}
