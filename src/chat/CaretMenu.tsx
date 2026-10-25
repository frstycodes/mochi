import { useRef, type ReactNode, type RefObject } from 'react';
import type { EditorView } from '@codemirror/view';
import { Command, CommandList } from '@/components/ui/command';
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from '@/components/ui/popover';

type CaretMenuProps = {
  isOpen: boolean;
  editor: RefObject<EditorView | null>;
  /** The cmdk root: the menu's hook forwards arrow keys to it, since focus stays in the editor. */
  listRef: RefObject<HTMLDivElement | null>;
  listId: string;
  label: string;
  value: string | undefined;
  onValueChange: (value: string) => void;
  /** Escape: closes until the text changes. Clicking elsewhere (the editor included) leaves it open. */
  onDismiss: () => void;
  children: ReactNode;
};

/**
 * A cmdk list in a popover above the editor's caret. Focus never leaves the editor: the hook owns typing and filtering
 * (`shouldFilter` off) and forwards arrows here, so cmdk keeps the highlight and scrolls it into view.
 */
export function CaretMenu({
  isOpen,
  editor,
  listRef,
  listId,
  label,
  value,
  onValueChange,
  onDismiss,
  children,
}: CaretMenuProps) {
  const anchor = useRef({
    getBoundingClientRect: () => caretRect(editor.current),
  });
  return (
    <Popover open={isOpen} onOpenChange={(open) => !open && onDismiss()}>
      <PopoverAnchor virtualRef={anchor} />
      <PopoverContent
        side="top"
        align="start"
        sideOffset={8}
        collisionPadding={8}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        onPointerDown={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        className="w-[28rem] max-w-(--radix-popover-content-available-width) gap-0 p-0"
      >
        <Command
          ref={listRef}
          shouldFilter={false}
          loop
          label={label}
          value={value}
          onValueChange={onValueChange}
          className="size-auto"
        >
          <CommandList id={listId} className="max-h-80">
            {children}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** Forward an editor key to the cmdk list so it moves its own highlight. */
export function forwardKey(list: HTMLElement | null, e: KeyboardEvent) {
  list?.dispatchEvent(
    new KeyboardEvent('keydown', { key: e.key, bubbles: true }),
  );
}

function caretRect(view: EditorView | null) {
  const caret = view?.coordsAtPos(view.state.selection.main.head);
  if (caret)
    return new DOMRect(caret.left, caret.top, 0, caret.bottom - caret.top);
  return view?.dom.getBoundingClientRect() ?? new DOMRect();
}
