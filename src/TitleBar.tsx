import { useImperativeHandle, useRef, type ComponentProps } from 'react';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { cn } from '@/lib/utils';
import { LIGHTS_RESERVE, useToggleSlot } from './SidebarToggle';
import { useCaptionInset } from './windowCaptions';

/** The 44px bar every page starts with: drags the window on desktop, and while the sidebar is hidden clears the traffic lights and carries its trigger. `isFirst`: only the leftmost split sits under the lights; `isMulti`: several splits, so no trigger. */
export function TitleBar({ ref, isFirst = true, isMulti = false, className, children, ...props }: ComponentProps<'header'> & { isFirst?: boolean; isMulti?: boolean }) {
  const { hasTrigger, clearsLights } = useToggleSlot(isFirst, isMulti);
  const header = useRef<HTMLElement>(null);
  useImperativeHandle(ref, () => header.current!, []);
  useCaptionInset(header);
  return (
    // The reserve goes last: tailwind-merge would let a caller's `px-*` drop it.
    <header ref={header} className={cn(TITLE_BAR, className, clearsLights && LIGHTS_RESERVE)} {...props}>
      {hasTrigger && <SidebarTrigger className="text-muted-foreground" />}
      {children}
    </header>
  );
}

export const TITLE_BAR = 'app-drag flex h-11 shrink-0 items-center gap-2 px-3';

/** For a page with no bar: an invisible 44px drag strip over its top. Render it before the page's content, which `index.css` keeps clickable through it. */
export function DragStrip() {
  return <div aria-hidden data-drag-strip className="app-drag pointer-events-none absolute inset-x-0 top-0 h-11" />;
}
