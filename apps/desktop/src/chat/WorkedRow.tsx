import { FoldChevron } from '../Fold';
import { useElapsed } from '../agents/parts';
import { formatElapsed } from '../progress';
import type { ChatRow } from './rows';

/** "Working for 12s" while the turn runs, "Worked for 3m 12s" after; it folds the turn's work above the final reply. */
export function WorkedRow({
  row,
  onToggle,
}: {
  row: Extract<ChatRow, { kind: 'worked' }>;
  onToggle: (key: string) => void;
}) {
  const isRunning = row.durationMs === undefined;
  // An ended turn passes an end, so only the running one ticks.
  const elapsed = useElapsed(row.startMs ?? 0, isRunning ? undefined : 0);
  const time = isRunning
    ? row.startMs !== undefined && formatElapsed(elapsed)
    : formatElapsed(row.durationMs!);
  return (
    <div className="-mx-4 border-b border-border pb-2 md:-mx-6">
      <button
        type="button"
        aria-expanded={row.isOpen}
        onClick={() => onToggle(row.key)}
        className="mx-2 md:mx-4 flex h-7 w-fit cursor-default items-center gap-2 rounded-lg px-2 type-meta text-muted-foreground hover:bg-accent/60 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        <span>
          {isRunning ? 'Working' : 'Worked'}
          {!!time && (
            <>
              {' for '}
              <span className="tabular">{time}</span>
            </>
          )}
        </span>
        <FoldChevron isOpen={row.isOpen} className="text-subtle-foreground" />
      </button>
    </div>
  );
}
