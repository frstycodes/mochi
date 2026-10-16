import { useEffect, useState } from 'react';
import { AlertCircle, Bell, Hourglass, Clock, BellOff, CheckCircle, XCircle, Eye, Flash, Settings, Warning, Trash, type IconComponent } from '@/icons';
import { Button } from '@/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/components/ui/item';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { SidebarMenuBadge, SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar';
import { cn } from '@/lib/utils';
import { UnreadDot } from '../ui';
import { host } from '../host';
import type { NotifyPermission } from '../host/types/notify';
import { duration } from '../progress';
import { openSettings } from '../settings/open';
import { useHarness } from '../store';
import { GitPullRequestIcon } from '@/icons/github';
import { ThreadPrHoverCard } from '../chat/RefHoverCard';
import { groupBursts, hourLabel, type Burst, type NoticeKind } from './model';
import { useJump } from './useNotifications';
import type { VerdictKind } from '../goals/verdict';

const KIND_ICONS = {
  'needs-you': { icon: AlertCircle, className: 'text-warning' },
  limit: { icon: Hourglass, className: 'text-warning' },
  'step-done': { icon: CheckCircle, className: 'text-success' },
  review: { icon: Eye, className: 'text-muted-foreground' },
  ci: { icon: XCircle, className: 'text-destructive' },
  'pr-review': { icon: GitPullRequestIcon, className: 'text-muted-foreground' },
  overlap: { icon: Warning, className: 'text-warning' },
  'race-lost': { icon: Flash, className: 'text-muted-foreground' },
  run: { icon: Clock, className: 'text-muted-foreground' },
  idle: { icon: CheckCircle, className: 'text-success' },
} satisfies Record<NoticeKind, { icon: IconComponent; className: string }>;

/** An idle notice takes its verdict's look; done keeps the `idle` default. */
const VERDICT_ICONS = {
  gaps: { icon: Warning, className: 'text-warning' },
  'needs-you': { icon: AlertCircle, className: 'text-warning' },
  stalled: { icon: Hourglass, className: 'text-destructive' },
} satisfies Partial<Record<VerdictKind, { icon: IconComponent; className: string }>>;

export function NotificationBell({ spaceId }: { spaceId: string }) {
  const { state, dispatch } = useHarness();
  const spaceThreads = new Set(state.threads.filter((t) => t.spaceId === spaceId).map((t) => t.id));
  const notices = state.notifications.items.filter((n) => spaceThreads.has(n.threadId));
  const unread = notices.filter((n) => !n.isRead).length;
  const bursts = groupBursts(notices);
  const [isOpen, setOpen] = useState(false);

  return (
    <SidebarMenuItem>
      <Popover open={isOpen} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <SidebarMenuButton aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}>
            <Bell />
            <span>Notifications</span>
          </SidebarMenuButton>
        </PopoverTrigger>
        <PopoverContent side="right" align="start" sideOffset={8} collisionPadding={8} className="max-h-(--radix-popover-content-available-height) w-88 gap-0 overflow-hidden p-0">
          <div className="flex items-center gap-1 py-2 pr-2 pl-3">
            <h2 className="flex-1 type-title">Notifications</h2>
            <Button variant="ghost" size="xs" disabled={unread === 0} onClick={() => dispatch({ type: 'notify-read', ids: notices.map((n) => n.id) })}>
              Mark all read
            </Button>
            <Button variant="ghost" size="icon-xs" aria-label="Clear notifications" disabled={notices.length === 0} onClick={() => dispatch({ type: 'notify-clear' })}>
              <Trash />
            </Button>
          </div>
          {bursts.length === 0 ? (
            <NoNotices />
          ) : (
            <ScrollArea type="scroll" className="flex min-h-0 flex-col *:data-[slot=scroll-area-viewport]:max-h-96">
              <div className="flex flex-col gap-0.5 px-1.5 pb-1.5">
                {bursts.map((b) => (
                  <BurstRow key={b.id} burst={b} onJump={() => setOpen(false)} />
                ))}
              </div>
            </ScrollArea>
          )}
          <NotifyFooter
            onOpenSettings={() => {
              setOpen(false);
              openSettings('notifications', 'quietHours');
            }}
          />
        </PopoverContent>
      </Popover>
      {unread > 0 && <SidebarMenuBadge className="tabular font-medium text-sidebar-foreground">{unread}</SidebarMenuBadge>}
    </SidebarMenuItem>
  );
}

function BurstRow({ burst, onJump }: { burst: Burst; onJump: () => void }) {
  const { state, dispatch } = useHarness();
  const jump = useJump();
  const [head, ...rest] = burst.notices;
  const { icon: Icon, className } = (head.verdict && head.verdict in VERDICT_ICONS ? VERDICT_ICONS[head.verdict as keyof typeof VERDICT_ICONS] : undefined) ?? KIND_ICONS[head.kind];
  const isUnread = burst.notices.some((n) => !n.isRead);
  const isMuted = state.notifications.muted.includes(burst.threadId);
  const thread = state.threads.find((t) => t.id === burst.threadId);
  const threadTitle = thread?.title;
  const pr = head.kind === 'pr-review' ? thread?.prs.find((p) => p.number === head.prNumber) : undefined;
  const open = () => {
    dispatch({ type: 'notify-read', ids: rest.map((n) => n.id) });
    jump(head);
    onJump();
  };

  const row = (
    <Item size="xs" className="group/notice relative isolate items-start gap-2.5 px-2 py-1.5 hover:bg-accent/60">
      <ItemMedia className="pt-0.5">
        <Icon className={cn('size-4', className)} aria-hidden />
      </ItemMedia>
      <ItemContent className="min-w-0 gap-0.5">
        <ItemTitle className={cn('w-full min-w-0 font-normal', isUnread ? 'text-foreground' : 'text-muted-foreground')}>
          {/* Stretched over the row so the whole item jumps, while the mute action stays its own button above it. */}
          <button type="button" className="min-w-0 truncate text-left outline-none after:absolute after:inset-0 after:rounded-md focus-visible:after:ring-2 focus-visible:after:ring-ring/50" onClick={open}>
            {head.title}
          </button>
        </ItemTitle>
        <ItemDescription className="line-clamp-1 type-caption">{rest.length > 0 ? `${threadTitle ?? head.body} · +${rest.length} more` : head.body}</ItemDescription>
      </ItemContent>
      <ItemActions className="relative z-10 gap-1 self-center">
        <span className="tabular type-caption text-subtle-foreground group-hover/notice:hidden">{state.now - head.at < 1 ? 'now' : duration(state.now - head.at)}</span>
        {isUnread && <UnreadDot className="group-hover/notice:hidden" />}
        <Button
          variant="ghost"
          size="icon-xs"
          className="hidden group-focus-within/notice:inline-flex group-hover/notice:inline-flex"
          aria-label={isMuted ? `Unmute ${threadTitle ?? 'thread'}` : `Mute ${threadTitle ?? 'thread'}`}
          aria-pressed={isMuted}
          onClick={() => dispatch({ type: 'notify-mute', threadId: burst.threadId })}
        >
          {isMuted ? <Bell /> : <BellOff />}
        </Button>
      </ItemActions>
    </Item>
  );
  if (!thread || !pr) return row;
  return (
    <ThreadPrHoverCard thread={thread} pr={pr} side="right" align="start">
      {row}
    </ThreadPrHoverCard>
  );
}

function NoNotices() {
  return (
    <Empty className="gap-2 p-6">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Bell />
        </EmptyMedia>
        <EmptyTitle className="type-title">All caught up</EmptyTitle>
        <EmptyDescription className="type-caption">Threads that need you, reviews, CI failures and overlaps show up here.</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

/** Quiet hours, muted threads and which kinds alert live in Settings › Notifications; the popover says what's in effect and links there. */
function NotifyFooter({ onOpenSettings }: { onOpenSettings: () => void }) {
  const { state } = useHarness();
  const { quiet, muted } = state.notifications;
  const status = [quiet.isOn && `Quiet ${hourLabel(quiet.start)}–${hourLabel(quiet.end)}`, muted.length > 0 && `${muted.length} muted`].filter(Boolean).join(' · ');
  return (
    <div className="flex flex-col gap-2 bg-muted/40 px-3 py-2">
      <div className="flex items-center gap-2">
        <p className="flex-1 truncate type-caption text-muted-foreground">{status || 'Alerts arrive while Mochi is in the background.'}</p>
        <Button variant="ghost" size="xs" onClick={onOpenSettings}>
          <Settings data-icon="inline-start" />
          Settings
        </Button>
      </div>
      {!host.isDesktop && <BrowserPermission />}
    </div>
  );
}

function BrowserPermission() {
  const [permission, setPermission] = useState<NotifyPermission>('default');
  useEffect(() => {
    host.notify.permission().then(setPermission);
  }, []);
  if (permission === 'granted') return null;
  if (permission === 'denied') return <p className="type-caption text-subtle-foreground">Browser alerts are blocked in this site's settings.</p>;
  return (
    <Button variant="outline" size="sm" className="self-start" onClick={() => host.notify.requestPermission().then(setPermission)}>
      Turn on browser alerts
    </Button>
  );
}
