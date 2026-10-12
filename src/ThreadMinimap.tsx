import { useEffect, useState } from 'react';
import { useStickToBottomContext } from 'use-stick-to-bottom';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { revealIn } from '@/lib/revealIn';
import { cn } from '@/lib/utils';

/** One tick per chat row down the chat's right edge; rows in view light up, clicking a tick jumps to its row. */
export function ThreadMinimap({ labels, className }: { labels: string[]; className?: string }) {
  const { scrollRef } = useStickToBottomContext();
  const inView = useRowsInView(scrollRef, labels.length);
  if (labels.length < 2) return null;

  const jump = (i: number) => {
    const chat = scrollRef.current;
    const row = chat?.querySelector(`[data-chat-row="${i}"]`);
    if (chat && row) revealIn(chat, row, { align: 'start', behavior: 'smooth' });
  };

  return (
    <nav aria-label="Thread outline" className={cn('flex flex-col justify-center', className)}>
      {labels.map((label, i) => (
        <Tooltip key={i}>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={label}
              aria-current={inView.has(i) || undefined}
              onClick={() => jump(i)}
              className="group flex max-h-2.5 min-h-[3px] flex-1 cursor-default items-center justify-end px-2"
            >
              <span
                className={cn(
                  'h-0.5 w-2 rounded-full bg-subtle-foreground/50 transition-[width,background-color] duration-150 group-hover:w-3.5 group-hover:bg-foreground',
                  inView.has(i) && 'bg-foreground/80',
                )}
              />
            </button>
          </TooltipTrigger>
          <TooltipContent side="left" className="max-w-64 truncate">
            {label}
          </TooltipContent>
        </Tooltip>
      ))}
    </nav>
  );
}

function useRowsInView(scrollRef: React.RefObject<HTMLElement | null>, count: number) {
  const [inView, setInView] = useState<Set<number>>(new Set());

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const view = el.getBoundingClientRect();
      const next = new Set<number>();
      el.querySelectorAll<HTMLElement>('[data-chat-row]').forEach((row) => {
        const r = row.getBoundingClientRect();
        if (r.bottom > view.top && r.top < view.bottom) next.add(Number(row.dataset.chatRow));
      });
      setInView((prev) => (prev.size === next.size && [...next].every((i) => prev.has(i)) ? prev : next));
    };
    const schedule = () => (frame ||= requestAnimationFrame(measure));
    const ro = new ResizeObserver(schedule);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    el.addEventListener('scroll', schedule, { passive: true });
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      el.removeEventListener('scroll', schedule);
    };
  }, [scrollRef, count]);

  return inView;
}
