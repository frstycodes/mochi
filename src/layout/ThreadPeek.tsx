import { useRef, useState, type ReactNode } from 'react';
import { Eye, EyeOff, MagicStar } from '@/icons';
import { Button } from '@/components/ui/button';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import { cn } from '@/lib/utils';
import type { Thread } from '../model';
// Not PANE_TABS: the chat's sub-thread rows use this peek, and pane/tabs imports the chat, so going through it is a cycle.
import { BrowserTab } from '../pane/BrowserTab';
import { useHarness } from '../store';
import { PreviewContext } from './SplitContext';
import { ProviderMark, ThreadStatusIcon } from '../ui';
import { BoundShortcut } from '../Shortcut';
import { isCommandId, pinnedCommand } from '../keymap';
import { ThreadMessageIcon } from '../chat/ThreadMessage';
import { useRenameSurface } from '../rename';

const PEEK_OPEN_MS = 700;
const PEEK_CLOSE_MS = 150;
const TAIL = 3;
const THUMB_SCALE = 1 / 3;
// A part of the row with its own hover card (the PR stack) keeps the peek shut, so the two cards never stack.
const NESTED_PREVIEW = '[data-nested-preview]';
const NESTED_PREVIEW_ACTIVE = `${NESTED_PREVIEW}:hover, ${NESTED_PREVIEW}:focus-within`;

/** Hover a thread in the sidebar: its transcript tail and preview without switching to it, plus the watch toggle; pinned ones show their ⌘ digit. */
export function ThreadPeek({ thread, pinNumber, isDisabled, side = 'right', children }: { thread: Thread; pinNumber?: number; isDisabled: boolean; side?: 'right' | 'top'; children: ReactNode }) {
  const { state, dispatch } = useHarness();
  const isWatched = state.watched.includes(thread.id);
  const tail = thread.activity.filter((a) => a.kind === 'message').slice(-TAIL);
  const [isOpen, setOpen] = useState(false);
  // The trigger opens on focus too, and renaming focuses the row's field.
  const isRenaming = useRenameSurface(thread.id) === 'row';
  // Clicking the row shuts the peek until the pointer leaves, so Radix's pending open timer can't reopen it over the chat.
  const isDismissedRef = useRef(false);

  return (
    <HoverCard openDelay={PEEK_OPEN_MS} closeDelay={PEEK_CLOSE_MS} open={!isDisabled && !isRenaming && isOpen} onOpenChange={(open) => setOpen(open && !isDismissedRef.current && !document.querySelector(NESTED_PREVIEW_ACTIVE))}>
      <HoverCardTrigger
        asChild
        onPointerOver={(e) => e.target instanceof Element && e.target.closest(NESTED_PREVIEW) && setOpen(false)}
        onPointerDown={() => {
          isDismissedRef.current = true;
          setOpen(false);
        }}
        onPointerLeave={() => (isDismissedRef.current = false)}
        // Radix opens on any focus; a click, a window refocus or a menu handing focus back would open it with the pointer elsewhere. Only keyboard focus opens it.
        onFocus={(e) => !(e.target as Element).matches(':focus-visible') && e.preventDefault()}
      >
        {children}
      </HoverCardTrigger>
      <HoverCardContent side={side} align="start" sideOffset={side === 'right' ? 12 : 4} className="flex w-80 flex-col gap-2.5 p-3">
        <div className="flex items-center gap-2">
          <ThreadStatusIcon status={thread.status} />
          <span className="min-w-0 flex-1 truncate type-title">{thread.title}</span>
          {!!pinNumber && isCommandId(pinnedCommand(pinNumber)) && <BoundShortcut command={pinnedCommand(pinNumber)} />}
        </div>
        {/* A preview never drives the live browser view, or the real pane loses it. */}
        <PreviewContext.Provider value={true}>
          <PreviewThumb thread={thread} />
        </PreviewContext.Provider>
        {tail.length > 0 && (
          <ul className="flex flex-col gap-2">
            {tail.map((a) => (
              <li key={a.at + a.text} className="flex gap-2">
                <span className="flex w-6 shrink-0 pt-0.5 type-caption text-subtle-foreground">{a.who === 'claude' || a.who === 'codex' ? <ProviderMark provider={a.who} size={14} /> : a.from ? <ThreadMessageIcon direction="from" /> : a.autofix ? <MagicStar aria-hidden className="size-4 text-muted-foreground" /> : a.who === 'you' && 'You'}</span>
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
  return (
    <div aria-hidden inert className="pointer-events-none -mx-3 h-40 overflow-hidden bg-sidebar">
      <div className="origin-top-left" style={{ width: `${100 / THUMB_SCALE}%`, height: `${100 / THUMB_SCALE}%`, scale: THUMB_SCALE }}>
        <BrowserTab thread={thread} pane={pane} tab={tab} />
      </div>
    </div>
  );
}
