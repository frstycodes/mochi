import { useEffect, useState } from 'react';
import { useStickToBottomContext } from 'use-stick-to-bottom';
import { Pin } from 'reicon-react';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import { revealIn } from '@/lib/revealIn';
import { cn } from '@/lib/utils';

export type OutlineItem = { rowIndex: number; text: string; time: string; pins: string[] };

/** One tick per prompt down the chat's left edge; prompts in view light up, pinned prompts stand out, hovering shows the prompt, clicking jumps to it. */
export function ThreadMinimap({ items, className }: { items: OutlineItem[]; className?: string }) {
  const { scrollRef } = useStickToBottomContext();
  const inView = useRowsInView(scrollRef, items.length);
  if (items.length < 2) return null;

  const jump = (rowIndex: number) => {
    const chat = scrollRef.current;
    const row = chat?.querySelector(`[data-chat-row="${rowIndex}"]`);
    if (chat && row) revealIn(chat, row, { align: 'start', behavior: 'smooth' });
  };

  return (
    <nav aria-label="Prompt outline" className={cn('flex flex-col justify-center', className)}>
      {items.map(({ rowIndex, text, time, pins }) => (
        <HoverCard key={rowIndex} openDelay={150} closeDelay={80}>
          <HoverCardTrigger asChild>
            <button
              type="button"
              aria-label={text}
              aria-current={inView.has(rowIndex) || undefined}
              onClick={() => jump(rowIndex)}
              className="group flex max-h-2.5 min-h-[3px] flex-1 cursor-default items-center justify-start px-2"
            >
              <span
                className={cn(
                  'h-0.5 w-2 rounded-full bg-subtle-foreground/50 transition-[width,background-color] duration-150 group-hover:w-3.5 group-hover:bg-foreground',
                  inView.has(rowIndex) && 'bg-foreground/80',
                  pins.length > 0 && 'h-[3px] w-3 bg-foreground group-hover:w-4',
                )}
              />
            </button>
          </HoverCardTrigger>
          <HoverCardContent side="right" align="start" className="flex max-h-80 w-80 flex-col gap-2 overflow-y-auto">
            <span className="type-caption tabular text-subtle-foreground">{time}</span>
            {pins.map((pin, j) => (
              <span key={j} className="flex items-start gap-1.5 type-caption text-muted-foreground">
                <Pin className="mt-0.5 size-3 shrink-0" aria-hidden />
                <span className="line-clamp-3">{pin}</span>
              </span>
            ))}
            <p className="type-prose whitespace-pre-wrap break-words">{text}</p>
          </HoverCardContent>
        </HoverCard>
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
