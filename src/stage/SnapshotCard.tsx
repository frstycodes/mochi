import { memo, useEffect, useState } from 'react';
import { Globe, Layers } from 'reicon-react';
import { host } from '@/host';
import { cn } from '@/lib/utils';
import { pageKey, usePage } from '../browser/pages';
import { LiveDot, ProgressRing, ProviderMark } from '../ui';
import type { ThreadSnapshot } from './snapshot';

export type StripSide = 'left' | 'right' | 'top' | 'bottom';

/**
 * A thread as a card: title, progress, the step in flight, the last message and a preview frame, all from a snapshot.
 * Stage edge cards add a strip on the side facing the center, so the sliver that sticks out still shows the ring, the needs-you dot and the stack count.
 */
export const SnapshotCard = memo(function SnapshotCard({ snap, strip, stacked, className }: { snap: ThreadSnapshot; strip?: StripSide; stacked?: number | null; className?: string }) {
  const needsYou = snap.status === 'needs-you';
  const isVertical = strip === 'top' || strip === 'bottom';
  return (
    <div className={cn('flex overflow-hidden rounded-xl bg-card text-left shadow-popover', STRIP_FLEX[strip ?? 'none'], className)}>
      {!!strip && (
        <div className={cn('flex shrink-0 items-center justify-center gap-2 bg-accent/40', isVertical ? 'h-9 flex-row px-3' : 'w-9 flex-col py-3')}>
          <ProgressRing pct={snap.pct} slot={snap.line} size={14} isWorking={snap.isWorking} />
          {needsYou && <LiveDot className="text-warning" />}
          {!!stacked && (
            <span aria-label={`${stacked} more stacked`} className={cn('flex items-center gap-0.5 type-caption text-muted-foreground tabular', isVertical ? 'flex-row' : 'flex-col')}>
              <Layers className="size-3.5" />
              {stacked}
            </span>
          )}
        </div>
      )}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-1.5 p-3">
        <div className="flex items-center gap-2">
          {!strip && <ProgressRing pct={snap.pct} slot={snap.line} size={14} isWorking={snap.isWorking} />}
          <span className="min-w-0 flex-1 truncate type-title">{snap.title}</span>
          {!strip && needsYou && <LiveDot className="text-warning" />}
        </div>
        <p className="flex min-w-0 gap-1.5 type-meta text-muted-foreground">
          <span className="shrink-0 tabular">{Math.round(snap.pct * 100)}%</span>
          <span className={cn('truncate', needsYou && 'text-foreground')}>{snap.nowStep}</span>
        </p>
        {!!snap.lastMessage && (
          <p className="flex min-h-0 gap-1.5 type-meta text-subtle-foreground">
            {(snap.lastMessage.who === 'claude' || snap.lastMessage.who === 'codex') && <ProviderMark provider={snap.lastMessage.who} size={12} className="mt-[3px] shrink-0" />}
            <span className="line-clamp-2">{snap.lastMessage.text}</span>
          </p>
        )}
        {!!snap.preview && <PreviewFrame threadId={snap.id} tabId={snap.preview.tabId} url={snap.preview.url} />}
      </div>
    </div>
  );
});

// The strip is the first child: it sits on the named side.
const STRIP_FLEX = { left: 'flex-row', right: 'flex-row-reverse', top: 'flex-col', bottom: 'flex-col-reverse', none: 'flex-col' } satisfies Record<StripSide | 'none', string>;

const CAPTURE_MS = 1000;

/**
 * The preview tab's last frame. Desktop captures the native view once a second; the web build has no view to capture
 * (its pages are React trees, and cards never mount one), so it shows the address only.
 */
function PreviewFrame({ threadId, tabId, url }: { threadId: string; tabId: string; url: string }) {
  const hostId = usePage(pageKey(threadId, tabId), url).hostId;
  const [frame, setFrame] = useState<string | null>(null);
  useEffect(() => {
    if (!hostId) return;
    let isLive = true;
    const capture = () => host.browser.capture(hostId, { fullPage: false }).then((src) => isLive && setFrame(src), () => {});
    void capture();
    const id = window.setInterval(capture, CAPTURE_MS);
    return () => {
      isLive = false;
      window.clearInterval(id);
    };
  }, [hostId]);

  return (
    <div className="mt-auto flex min-h-0 flex-col overflow-hidden rounded-md bg-sidebar ring-1 ring-border">
      <span className="flex items-center gap-1 px-1.5 py-0.5 font-mono type-caption text-subtle-foreground">
        <Globe className="size-3 shrink-0" />
        <span className="truncate">{url}</span>
      </span>
      {!!frame && <img src={frame} alt="" className="min-h-0 w-full object-cover object-top" />}
    </div>
  );
}
