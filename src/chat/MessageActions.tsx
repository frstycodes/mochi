import type { ComponentType } from 'react';
import { CopyStack, Pushpin, RotateLeft, Stars, type IconProps } from '@/icons';
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { toast } from '@/toast/store';
import { cn } from '@/lib/utils';
import { authorName, type Thread } from '../model';
import { timeAgo } from '../progress';
import { useDispatch, useHarnessSelector } from '../store';
import { rewindBlockedReason, type RewindMode } from '../rewind/checkpoints';
import { REWIND_MODE_ORDER, REWIND_MODES } from '../rewind/modes';
import { openRewind } from '../rewind/requests';
import { useRewindActions } from '../rewind/useRewindActions';
import { usePrefs } from '../settings/prefs';
import { ForkIcon, TooltipIconButton } from '../ui';
import { isMessagePinned, togglePin, useThreadPins } from './pins';
import { ReadMark } from './SteerBubble';
import { simplify as simplifyReply, useIsSimplifying } from '../simplify/useSimplify';

export interface MessageAction {
  id: 'copy' | 'pin' | 'fork' | 'simplify' | `rewind-${RewindMode}`;
  label: string;
  hint?: string;
  icon: ComponentType<IconProps>;
  isActive?: boolean;
  /** Shown but not runnable, with this reason (the agent is working). */
  disabledReason?: string;
  run: () => void;
}

/** Everything you can do with one chat message. The hover bar renders these; a context menu can reuse the same list. */
export function useMessageActions(thread: Thread, index: number): MessageAction[] {
  const pins = useThreadPins(thread.id);
  const { rewind } = useRewindActions();
  const dispatch = useDispatch();
  const isSimplifying = useIsSimplifying(thread.id, index);
  const entry = thread.activity[index];
  if (!entry) return [];
  const isPinned = isMessagePinned(pins, index);
  const copy: MessageAction = { id: 'copy', label: 'Copy', icon: CopyStack, run: () => copyText(entry.text) };
  const disabledReason = rewindBlockedReason(thread);
  // Chat-only rewinds run at once (Undo brings it back); a files rewind first shows which files change.
  const rewinds = REWIND_MODE_ORDER.map((mode): MessageAction => ({
    id: `rewind-${mode}`,
    ...REWIND_MODES[mode],
    disabledReason,
    run: () => (mode === 'chat' ? void rewind(thread, { kind: 'message', index }, 'chat') : openRewind({ kind: 'rewind', threadId: thread.id, message: index, mode })),
  }));
  const fork: MessageAction = { id: 'fork', label: 'Fork from here', hint: 'A new thread on its own branch with everything up to this message.', icon: ForkIcon, run: () => openRewind({ kind: 'fork', threadId: thread.id, point: { kind: 'message', index } }) };
  const pin: MessageAction = {
    id: 'pin',
    label: isPinned ? 'Unpin' : 'Pin',
    hint: isPinned ? undefined : 'Marks it on the outline rail at the right edge so you can jump back. Select text first to pin just that passage.',
    icon: TiltedPin,
    isActive: isPinned,
    run: () => togglePin(thread.id, index),
  };
  const isShown = !!entry.simplified?.isShown;
  const simplify: MessageAction = {
    id: 'simplify',
    label: isShown ? 'Show original' : 'Simplify',
    hint: isShown ? undefined : 'A plainer version for you to read, made by your Simplify settings. The agent never sees it.',
    icon: Stars,
    isActive: isShown,
    disabledReason: isSimplifying ? 'Simplifying…' : undefined,
    run: () => void simplifyReply(thread, index, dispatch),
  };
  // Rewind only goes back to your own messages, which return to the composer to edit.
  const actions = entry.who === 'you' ? [copy, ...rewinds, fork, pin] : [copy, simplify, fork, pin];
  return actions;
}

/** Shows on hover or keyboard focus under a message; pinned messages are marked on the outline rail instead. */
export function MessageActions({ thread, index, align }: { thread: Thread; index: number; align: 'start' | 'end' }) {
  const actions = useMessageActions(thread, index);
  const now = useHarnessSelector((s) => s.now);
  const rewinds = actions.filter((a) => a.id.startsWith('rewind-'));
  return (
    <div role="toolbar" aria-label="Message actions" className={cn('flex items-center gap-0.5', align === 'end' && 'justify-end')}>
      <time className="mr-1 type-caption text-subtle-foreground tabular opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-within/row:opacity-100">{timeAgo(now - (thread.activity[index]?.at ?? now))}</time>
      {!!thread.activity[index]?.isSeen && <ReadMark agent={authorName(thread.providers[0])} isRead />}
      {actions.map((a) => {
        if (a.id.startsWith('rewind-')) return a === rewinds[0] && <RewindModeMenu key="rewind" actions={rewinds} />;
        return (
          <TooltipIconButton key={a.id} label={a.label} hint={a.disabledReason ?? a.hint} disabled={!!a.disabledReason && !a.id.startsWith('rewind-')} aria-pressed={a.id === 'pin' || a.id === 'simplify' ? !!a.isActive : undefined} onClick={a.run} className={cn(BAR_BUTTON, a.isActive && 'text-foreground')}>
            <a.icon filled={a.isActive} />
          </TooltipIconButton>
        );
      })}
    </div>
  );
}

const BAR_REVEAL = 'opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-within/row:opacity-100';
const BAR_BUTTON = cn('size-6 text-subtle-foreground hover:text-foreground focus-visible:opacity-100 [&_svg]:size-3.5', BAR_REVEAL);

/** One Rewind button opening the two modes; the one you ran last is checked and remembered for next time. */
function RewindModeMenu({ actions }: { actions: MessageAction[] }) {
  const { rewindMode } = usePrefs();
  const reason = actions[0].disabledReason;
  // The reveal sits on a wrapper: a disabled button's own opacity would override it and show the icon without hover.
  return (
    <span className={cn('inline-flex', BAR_REVEAL)}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild disabled={!!reason}>
          <TooltipIconButton label="Rewind to here" hint={reason ?? 'Back to just before this message, which returns to the composer. Undo brings everything back.'} disabled={!!reason} className="size-6 text-subtle-foreground hover:text-foreground [&_svg]:size-3.5">
            <RotateLeft />
          </TooltipIconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel className="type-caption text-subtle-foreground">Rewind to before this message</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={rewindMode}>
            {actions.map((a) => (
              <DropdownMenuRadioItem key={a.id} value={a.id.slice('rewind-'.length)} onSelect={a.run} className="items-start">
                <a.icon className="mt-0.5" />
                <span className="flex min-w-0 flex-col">
                  {a.label}
                  <span className="type-caption text-pretty text-muted-foreground">{a.hint}</span>
                </span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  );
}

/** The upright pushpin, tilted like a pin stuck into the page. */
function TiltedPin(props: IconProps) {
  return <Pushpin {...props} className={cn('rotate-45', props.className)} />;
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Copied');
  } catch {
    toast.error('Could not copy');
  }
}
