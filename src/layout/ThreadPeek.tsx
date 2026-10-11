import type { ReactNode } from 'react';
import { Eye, EyeOff } from 'reicon-react';
import { Button } from '@/components/ui/button';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import { Kbd, KbdGroup } from '@/components/ui/kbd';
import { cn } from '@/lib/utils';
import type { Thread } from '../model';
import { PANE_TABS } from '../pane/tabs';
import { useHarness } from '../store';
import { ProviderMark, ThreadStatusIcon } from '../ui';

const PEEK_OPEN_MS = 500;
const PEEK_CLOSE_MS = 240;
const TAIL = 3;
const THUMB_SCALE = 1 / 3;

/** Hover a pinned thread: its transcript tail and preview without switching to it, plus the watch toggle. */
export function ThreadPeek({ thread, pinNumber, isDisabled, children }: { thread: Thread; pinNumber: number; isDisabled: boolean; children: ReactNode }) {
  const { state, dispatch } = useHarness();
  const isWatched = state.watched.includes(thread.id);
  const tail = thread.activity.filter((a) => a.kind === 'message').slice(-TAIL);

  return (
    <HoverCard openDelay={PEEK_OPEN_MS} closeDelay={PEEK_CLOSE_MS} open={isDisabled ? false : undefined}>
      <HoverCardTrigger asChild>{children}</HoverCardTrigger>
      <HoverCardContent side="right" align="start" sideOffset={12} className="flex w-80 flex-col gap-2.5 p-3">
        <div className="flex items-center gap-2">
          <ThreadStatusIcon status={thread.status} />
          <span className="min-w-0 flex-1 truncate type-title">{thread.title}</span>
          {pinNumber <= 9 && (
            <KbdGroup>
              <Kbd>Cmd</Kbd>
              <Kbd>{pinNumber}</Kbd>
            </KbdGroup>
          )}
        </div>
        <PreviewThumb thread={thread} />
        {tail.length > 0 && (
          <ul className="flex flex-col gap-2">
            {tail.map((a) => (
              <li key={a.at + a.text} className="flex gap-2">
                <span className="flex w-6 shrink-0 pt-0.5 type-caption text-subtle-foreground">{a.who === 'claude' || a.who === 'codex' ? <ProviderMark provider={a.who} size={14} /> : a.who === 'you' && 'You'}</span>
                <p className={cn('line-clamp-2 type-meta', a.who === 'you' ? 'text-foreground' : 'text-muted-foreground')}>{a.text}</p>
              </li>
            ))}
          </ul>
        )}
        <Button variant="secondary" size="sm" aria-pressed={isWatched} onClick={() => dispatch({ type: 'watch-toggle', threadId: thread.id })} className="self-start">
          {isWatched ? <EyeOff /> : <Eye />}
          {isWatched ? 'Stop watching' : 'Watch for needs you and done'}
        </Button>
      </HoverCardContent>
    </HoverCard>
  );
}

/** The thread's preview tab rendered at a third of its size, live and inert. */
function PreviewThumb({ thread }: { thread: Thread }) {
  const { state } = useHarness();
  const pane = state.panes.find((p) => p.threadId === thread.id);
  const tab = pane?.tabs.find((t) => t.kind === 'browser');
  if (!pane || !tab) return null;
  const Content = PANE_TABS.browser.component;
  return (
    <div aria-hidden inert className="pointer-events-none h-40 overflow-hidden rounded-lg bg-sidebar ring-1 ring-border">
      <div className="origin-top-left" style={{ width: `${100 / THUMB_SCALE}%`, height: `${100 / THUMB_SCALE}%`, scale: THUMB_SCALE }}>
        <Content thread={thread} pane={pane} tab={tab} />
      </div>
    </div>
  );
}
