import { CheckCircle, Pencil, Warning } from '@/icons';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { Assumption, Thread } from '../model';
import { SectionLabel } from '../ui';

/** This turn's assumptions in any state, then older ones still open; turn-less reports count as this turn. */
export function splitAssumptions(thread: Thread) {
  const all = thread.assumptions ?? [];
  const turn = thread.report?.turn;
  const isCurrent = (a: Assumption) => turn === undefined || a.turn === turn;
  return {
    current: all.filter(isCurrent),
    earlier: all.filter((a) => !isCurrent(a) && a.state === 'open'),
  };
}

/**
 * What the agent filled in that you didn't specify, as rows: open ones ask for Accept or Change, answered ones go muted.
 * Older open ones follow under Still open, so an unanswered assumption keeps asking until you answer it. Pass no `current`
 * when the turn's spine already shows them.
 */
export function AssumptionList({
  current = [],
  earlier,
  onSet,
  onChange,
}: {
  current?: Assumption[];
  earlier: Assumption[];
  onSet: (a: Assumption, state: Assumption['state']) => void;
  onChange: (a: Assumption) => void;
}) {
  if (!current.length && !earlier.length) return null;
  const rows = (items: Assumption[], label: string) => (
    <ul aria-label={label} className="flex flex-col gap-1">
      {items.map((a) => (
        <AssumptionRow
          key={a.id}
          assumption={a}
          onAccept={() => onSet(a, 'accepted')}
          onChange={() => onChange(a)}
        />
      ))}
    </ul>
  );
  return (
    <section aria-label="Assumptions" className="flex flex-col gap-1.5">
      {!!current.length && (
        <>
          <SectionLabel>Assumptions</SectionLabel>
          {rows(current, 'Assumptions from this turn')}
        </>
      )}
      {!!earlier.length && (
        <>
          <SectionLabel className={cn(!!current.length && 'pt-1.5')}>
            Still open ·{' '}
            <span className="text-warning">{`${earlier.length} to check`}</span>
          </SectionLabel>
          {rows(earlier, 'Assumptions still open from earlier turns')}
        </>
      )}
    </section>
  );
}

/** One assumption as its own row, its icon on the spine's node column and its text on the step titles'. */
export function AssumptionRow(props: AssumptionLineProps) {
  return (
    <li className="min-h-9 py-2">
      <AssumptionLine {...props} />
    </li>
  );
}

export type AssumptionLineProps = {
  assumption: Assumption;
  onAccept: () => void;
  onChange: () => void;
};

/**
 * An assumption's icon, text and answers. It wraps instead of truncating: you can't accept what you can't read. An open one
 * leads with "Assumed" in amber, the way a pivot leads with its name; its answers end on the spine's caption column.
 */
export function AssumptionLine({
  assumption: a,
  onAccept,
  onChange,
}: AssumptionLineProps) {
  const isOpen = a.state === 'open';
  return (
    <div
      className={cn(
        'flex min-w-0 items-start gap-2.5 type-meta',
        !isOpen && 'text-muted-foreground',
      )}
    >
      <span className="flex h-5 shrink-0 items-center">
        <AssumptionIcon state={a.state} />
      </span>
      <span
        className={cn(
          'min-w-0 flex-1 text-pretty [overflow-wrap:anywhere]',
          isOpen && 'text-foreground/80',
        )}
      >
        {isOpen ? (
          <AssumedText text={a.text} />
        ) : (
          <>
            <span className="sr-only">{`${STATE_LABEL[a.state]}: `}</span>
            {a.text}
          </>
        )}
      </span>
      {isOpen ? (
        <span className="flex shrink-0 items-center gap-0.5 pr-6">
          <Button size="xs" variant="ghost" onClick={onChange}>
            Change
          </Button>
          <Button size="xs" variant="ghost" onClick={onAccept}>
            Accept
          </Button>
        </span>
      ) : (
        a.state === 'changed' && (
          <span aria-hidden className="shrink-0 pr-8 type-caption leading-5">
            Changed
          </span>
        )
      )}
    </div>
  );
}

/** "Assumed timestamps are UTC" with its first word in amber; text that doesn't start with it gets "Assumed ·" before it. */
function AssumedText({ text }: { text: string }) {
  const rest = /^assumed\b/i.test(text) ? text.slice(7) : ` · ${text}`;
  return (
    <>
      <span className="font-medium text-warning">Assumed</span>
      {rest}
    </>
  );
}

const STATE_LABEL = {
  open: 'Assumed',
  accepted: 'Accepted',
  changed: 'Changed',
} satisfies Record<Assumption['state'], string>;

function AssumptionIcon({ state }: { state: Assumption['state'] }) {
  if (state === 'accepted')
    return (
      <CheckCircle
        aria-hidden
        className="size-3.5 shrink-0 text-subtle-foreground"
      />
    );
  if (state === 'changed')
    return (
      <Pencil
        aria-hidden
        className="size-3.5 shrink-0 text-subtle-foreground"
      />
    );
  return <Warning aria-hidden className="size-3.5 shrink-0 text-warning" />;
}
