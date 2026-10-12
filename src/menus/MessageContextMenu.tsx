import type { PointerEvent, ReactNode } from 'react';
import { Copy, MessageQuestion, QuoteUp, Routing } from 'reicon-react';
import { ContextMenu, ContextMenuContent, ContextMenuGroup, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui/context-menu';
import { sendToComposer } from '../browser/composer';
import { copyText } from '../clipboard';
import type { ActivityEntry } from '../model';
import { openRewind } from '../rewind/requests';
import { useAskInSideChat } from '../sidechat/AskInSideChat';

/** A chat message: copy it, quote it into the composer or the side chat, or fork the thread from it. Selected text keeps the native menu. */
export function MessageContextMenu({ threadId, entry, index, label, children }: { threadId: string; entry: ActivityEntry; index: number; label: string; children: ReactNode }) {
  const ask = useAskInSideChat(threadId);
  return (
    <ContextMenu>
      {/* Focusable so the menu key and Shift F10 reach it from the keyboard. */}
      <ContextMenuTrigger asChild tabIndex={0} className="rounded-xl outline-none select-text focus-visible:ring-2 focus-visible:ring-ring" onPointerDown={leaveLongPressToOrbit}>
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent className="w-60">
        <ContextMenuGroup>
          <ContextMenuItem onSelect={() => copyText(entry.text, 'Copied message')}>
            <Copy />
            Copy message
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => sendToComposer({ threadId, text: quoted(entry.text) })}>
            <QuoteUp />
            Quote in composer
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => ask({ source: 'message', label, text: entry.text })}>
            <MessageQuestion />
            Ask in side chat
          </ContextMenuItem>
        </ContextMenuGroup>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => openRewind({ kind: 'fork', threadId, point: { kind: 'message', index } })}>
          <Routing />
          Fork from here
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

const quoted = (text: string) => `${text.replace(/^/gm, '> ')}\n\n`;

// Touch long-press on a message is Orbit's (and the OS text selection's); preventDefault stops Radix starting its own long-press timer.
function leaveLongPressToOrbit(e: PointerEvent) {
  if (e.pointerType !== 'mouse') e.preventDefault();
}
