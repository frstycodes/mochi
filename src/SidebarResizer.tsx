import { persistedSlice } from './lib/uiStorage.ts';
import { useRef, useState } from 'react';
import { cn } from '@/lib/utils';

export const SIDEBAR_DEFAULT_PX = 256;
const MIN_PX = 208;
const MAX_PX = 420;
const KEY_STEP_PX = 16;
const widthSlice = persistedSlice('harness.sidebar-width', SIDEBAR_DEFAULT_PX, (raw) => clampWidth(Number(raw) || SIDEBAR_DEFAULT_PX));

/** Sidebar width, remembered per browser. */
export function useSidebarWidth() {
  const [width, setWidth] = useState(() => widthSlice.getState().value);
  const commit = (px: number) => {
    const next = clampWidth(px);
    setWidth(next);
    widthSlice.setState({ value: next });
  };
  return [width, commit] as const;
}

function clampWidth(px: number) {
  return Math.round(Math.min(MAX_PX, Math.max(MIN_PX, px)));
}

/**
 * Drag handle on the sidebar's right edge. While dragging it writes the width straight onto the sidebar's gap and container
 * (no React render per move) and commits on release; double-click resets. Not `--sidebar-width` on the wrapper: a custom property
 * there restyles every node of the app per move (~37ms with a long chat open, against ~1ms for the two widths).
 */
export function SidebarResizer({ width, onCommit }: { width: number; onCommit: (px: number) => void }) {
  const drag = useRef<{ x: number; w: number; wrapper: HTMLElement; sized: HTMLElement[] } | null>(null);
  const live = useRef(width);

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      aria-valuenow={width}
      aria-valuemin={MIN_PX}
      aria-valuemax={MAX_PX}
      tabIndex={0}
      onPointerDown={(e) => {
        const wrapper = e.currentTarget.closest<HTMLElement>('[data-slot=sidebar-wrapper]');
        const sidebar = e.currentTarget.closest<HTMLElement>('[data-slot=sidebar]');
        if (!wrapper || !sidebar) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        const sized = [...sidebar.querySelectorAll<HTMLElement>('[data-slot=sidebar-gap], [data-slot=sidebar-container]')];
        drag.current = { x: e.clientX, w: width, wrapper, sized };
        live.current = width;
        wrapper.setAttribute('data-sidebar-resizing', '');
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        live.current = clampWidth(d.w + e.clientX - d.x);
        for (const el of d.sized) el.style.width = `${live.current}px`;
      }}
      onPointerUp={() => {
        const d = drag.current;
        if (!d) return;
        d.wrapper.removeAttribute('data-sidebar-resizing');
        drag.current = null;
        // Same event as the commit, so React's re-render lands in the same frame as the inline widths clearing.
        for (const el of d.sized) el.style.width = '';
        onCommit(live.current);
      }}
      onDoubleClick={() => onCommit(SIDEBAR_DEFAULT_PX)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') onCommit(width - KEY_STEP_PX);
        if (e.key === 'ArrowRight') onCommit(width + KEY_STEP_PX);
      }}
      className={cn(
        'absolute inset-y-0 -right-1 z-20 hidden w-2 cursor-col-resize touch-none outline-none md:block',
        'after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:transition-colors hover:after:bg-border focus-visible:after:bg-ring',
      )}
    />
  );
}
