import type { ComponentType } from 'react';
import { Copy3, createIcon, PinTack, RotateLeft, type IconProps } from 'reicon-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import type { Thread } from '../model';
import { timeAgo } from '../progress';
import { useHarness } from '../store';
import { openRewind } from '../rewind/requests';
import { useRewindActions } from '../rewind/useRewindActions';
import { TooltipIconButton } from '../ui';
import { isMessagePinned, togglePin, useThreadPins } from './pins';

export interface MessageAction {
  id: 'copy' | 'pin' | 'fork' | 'rewind';
  label: string;
  hint?: string;
  icon: ComponentType<IconProps>;
  isActive?: boolean;
  run: () => void;
}

/** Everything you can do with one chat message. The hover bar renders these; a context menu can reuse the same list. */
export function useMessageActions(thread: Thread, index: number): MessageAction[] {
  const pins = useThreadPins(thread.id);
  const { rewindToMessage } = useRewindActions();
  const entry = thread.activity[index];
  if (!entry) return [];
  const isPinned = isMessagePinned(pins, index);
  const copy: MessageAction = { id: 'copy', label: 'Copy', icon: Copy3, run: () => copyText(entry.text) };
  const rewind: MessageAction = { id: 'rewind', label: 'Rewind to here', hint: 'Goes back to just before this message and puts it in the composer to edit and send again. Undo brings everything back.', icon: RotateLeft, run: () => void rewindToMessage(thread, index) };
  const fork: MessageAction = { id: 'fork', label: 'Fork from here', hint: 'A new thread on its own branch with everything up to this message.', icon: ForkArrow, run: () => openRewind({ kind: 'fork', threadId: thread.id, point: { kind: 'message', index } }) };
  const pin: MessageAction = {
    id: 'pin',
    label: isPinned ? 'Unpin' : 'Pin',
    hint: isPinned ? undefined : 'Marks it on the outline rail at the right edge so you can jump back. Select text first to pin just that passage.',
    icon: TiltedPin,
    isActive: isPinned,
    run: () => togglePin(thread.id, index),
  };
  // Rewind only goes back to your own messages, which return to the composer to edit.
  const actions = entry.who === 'you' ? [copy, rewind, fork, pin] : [copy, fork, pin];
  return actions;
}

/** Shows on hover or keyboard focus under a message; pinned messages are marked on the outline rail instead. */
export function MessageActions({ thread, index, align }: { thread: Thread; index: number; align: 'start' | 'end' }) {
  const actions = useMessageActions(thread, index);
  const { now } = useHarness().state;
  return (
    <div role="toolbar" aria-label="Message actions" className={cn('flex items-center gap-0.5', align === 'end' && 'justify-end')}>
      <time className="mr-1 type-caption text-subtle-foreground tabular opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-within/row:opacity-100">{timeAgo(now - (thread.activity[index]?.at ?? now))}</time>
      {actions.map((a) => (
        <TooltipIconButton
          key={a.id}
          label={a.label}
          hint={a.hint}
          aria-pressed={a.id === 'pin' ? !!a.isActive : undefined}
          onClick={a.run}
          className={cn(
            'size-6 text-subtle-foreground opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-within/row:opacity-100 hover:text-foreground focus-visible:opacity-100 [&_svg]:size-3.5',
            a.isActive && 'text-foreground',
          )}
        >
          <a.icon weight={a.isActive ? 'Filled' : 'Outline'} />
        </TooltipIconButton>
      ))}
    </div>
  );
}

// reicon has no fork arrow (a line that splits in two, like `-<`): drawn on its 24px grid at its 1.5 stroke.
const ForkArrow = createIcon('ForkArrow', {
  O: `<path d="M3.75 12h5.5l6.5-6.25M9.25 12l6.5 6.25M13.25 5.75h2.5v2.5M13.25 18.25h2.5v-2.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`,
});

/** reicon's upright pushpin, tilted like a pin stuck into the page. */
function TiltedPin(props: IconProps) {
  return <PinTack {...props} className={cn('rotate-45', props.className)} />;
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Copied');
  } catch {
    toast.error('Could not copy');
  }
}
