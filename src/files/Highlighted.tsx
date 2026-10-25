import { cn } from '@/lib/utils';

/** `text` with each `[from, to)` range wrapped in a `<mark>`; ranges sorted and non-overlapping. */
export function Highlighted({
  text,
  ranges,
  className,
  markClassName,
}: {
  text: string;
  ranges: [number, number][];
  className?: string;
  markClassName?: string;
}) {
  const parts = ranges.flatMap(([from, to], i) => {
    const before = text.slice(i ? ranges[i - 1][1] : 0, from);
    return [
      before,
      <mark
        key={from}
        className={cn('bg-transparent text-inherit', markClassName)}
      >
        {text.slice(from, to)}
      </mark>,
    ];
  });
  return (
    <span className={className}>
      {parts}
      {text.slice(ranges.at(-1)?.[1] ?? 0)}
    </span>
  );
}
