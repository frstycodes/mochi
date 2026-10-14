import type { ComponentProps } from 'react';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { cn } from '@/lib/utils';
import { TOGGLE_RESERVE, useToggleSlot } from './SidebarToggle';

/** The 44px bar every page starts with: drags the window on desktop, clears the traffic lights and the fixed sidebar toggle while the sidebar is collapsed, and carries the phone's sidebar trigger. `isFirst`: only the leftmost split sits under the toggle. */
export function TitleBar({ isFirst = true, className, children, ...props }: ComponentProps<'header'> & { isFirst?: boolean }) {
  const { hasTrigger, reservesToggle } = useToggleSlot(isFirst);
  return (
    // The reserve goes last: tailwind-merge would let a caller's `px-*` drop it.
    <header className={cn(TITLE_BAR, className, reservesToggle && TOGGLE_RESERVE)} {...props}>
      {hasTrigger && <SidebarTrigger className="-ml-1 text-muted-foreground" />}
      {children}
    </header>
  );
}

export const TITLE_BAR = 'app-drag flex h-11 shrink-0 items-center gap-2 px-3';

/** For a page with no bar: an invisible 44px drag strip over its top. Render it before the page's content, which `index.css` keeps clickable through it. */
export function DragStrip() {
  return <div aria-hidden data-drag-strip className="app-drag pointer-events-none absolute inset-x-0 top-0 h-11" />;
}
