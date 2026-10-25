import type { ReactNode, RefObject } from 'react';
import { Command, CommandList } from '@/components/ui/command';
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from '@/components/ui/popover';

type CaretMenuProps = {
  isOpen: boolean;
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
 * A cmdk list in a popover above the composer, as wide as it. Render it inside the `relative` box that wraps the composer card:
 * that box is the anchor, so the menu sits right even before the editor has reported a caret (a draft restored with `@` in it). Focus never leaves the editor: the hook owns typing and filtering
 * (`shouldFilter` off) and forwards arrows here, so cmdk keeps the highlight and scrolls it into view.
 */
export function CaretMenu({
  isOpen,
  listRef,
  listId,
  label,
  value,
  onValueChange,
  onDismiss,
  children,
}: CaretMenuProps) {
  return (
    <Popover open={isOpen} onOpenChange={(open) => !open && onDismiss()}>
      <PopoverAnchor asChild>
        <div aria-hidden className="pointer-events-none absolute inset-0" />
      </PopoverAnchor>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={8}
        collisionPadding={8}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        onPointerDown={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        className="w-(--radix-popover-trigger-width) max-w-(--radix-popover-content-available-width) gap-0 p-0"
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
