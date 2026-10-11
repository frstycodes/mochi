import { useRef, useState } from 'react';
import { cn } from '@/lib/utils';

export const SIDEBAR_DEFAULT_PX = 256;
const MIN_PX = 208;
const MAX_PX = 420;
const KEY_STEP_PX = 16;
const STORAGE_KEY = 'harness.sidebar-width';

/** Sidebar width, remembered per browser. */
export function useSidebarWidth() {
  const [width, setWidth] = useState(() => {
    try {
      return clampWidth(Number(localStorage.getItem(STORAGE_KEY)) || SIDEBAR_DEFAULT_PX);
    } catch {
      return SIDEBAR_DEFAULT_PX;
    }
  });
  const commit = (px: number) => {
    const next = clampWidth(px);
    setWidth(next);
    try {
      localStorage.setItem(STORAGE_KEY, String(next));
    } catch {
      // Storage can be blocked (private window); the width still applies for this session.
    }
  };
  return [width, commit] as const;
}

function clampWidth(px: number) {
  return Math.round(Math.min(MAX_PX, Math.max(MIN_PX, px)));
}

/**
 * Drag handle on the sidebar's right edge. While dragging it writes --sidebar-width straight to the wrapper
 * (no React render per move) and commits on release; double-click resets.
 */
export function SidebarResizer({ width, onCommit }: { width: number; onCommit: (px: number) => void }) {
  const drag = useRef<{ x: number; w: number; wrapper: HTMLElement } | null>(null);
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
        if (!wrapper) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { x: e.clientX, w: width, wrapper };
        live.current = width;
        wrapper.setAttribute('data-sidebar-resizing', '');
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        live.current = clampWidth(d.w + e.clientX - d.x);
        d.wrapper.style.setProperty('--sidebar-width', `${live.current}px`);
      }}
      onPointerUp={() => {
        const d = drag.current;
        if (!d) return;
        d.wrapper.removeAttribute('data-sidebar-resizing');
        drag.current = null;
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
