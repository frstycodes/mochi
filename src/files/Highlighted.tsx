import { cn } from '@/lib/utils';

/** `text` with each `[from, to)` range wrapped in a `<mark>`; ranges sorted and non-overlapping. */
export function Highlighted({ text, ranges, className, markClassName }: { text: string; ranges: [number, number][]; className?: string; markClassName?: string }) {
  let at = 0;
  const parts = ranges.flatMap(([from, to]) => {
    const before = text.slice(at, from);
    at = to;
    return [
      before,
      <mark key={from} className={cn('bg-transparent text-inherit', markClassName)}>
        {text.slice(from, to)}
      </mark>,
    ];
  });
  return (
    <span className={className}>
      {parts}
      {text.slice(at)}
    </span>
  );
}
