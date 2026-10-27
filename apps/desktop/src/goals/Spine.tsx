import { useState, type ReactNode } from 'react';
import { CheckCircle, ChevronRight, Route } from '@/icons';
import { cn } from '@/lib/utils';
import type { Assumption } from '../model';
import { SectionLabel } from '../ui';
import { Expand } from '../WorkLog';
import { AssumptionLine } from './Assumptions';

/** Something the agent did on a step that you'd otherwise only find in its prose. Assumptions point into the thread's ledger. */
export type SpineItem =
  | { kind: 'decision'; text: string }
  | { kind: 'assumption'; id: string };

/** The turn's plan as it went: steps with what was decided and assumed on each, and pivots where the plan changed. */
export type SpineNode =
  | {
      kind: 'step';
      title: string;
      status: 'done' | 'pending';
      items?: SpineItem[];
    }
  | { kind: 'pivot'; why: string; dropped: string[] };

/**
 * The plan is the spine: one rail with a node per step, decisions and assumptions hanging off the step they were made on.
 * A pivot is a node on the rail with its reason; the steps it dropped fork off it, dashed, before the steps that replaced them.
 * Only what asks for you stays out: assumptions open when the card mounts hang below their step whether it's folded or not,
 * and stay there once answered. Decisions, answered assumptions and dropped steps start folded behind their row's count.
 */
export function TurnSpine({
  assumptions,
  nodes,
  onSet,
  onChange,
}: {
  assumptions: Assumption[];
  nodes: SpineNode[];
  onSet: (a: Assumption, state: Assumption['state']) => void;
  onChange: (a: Assumption) => void;
}) {
  const ledger = new Map(assumptions.map((a) => [a.id, a]));
  // Captured once, so an assumption you just accepted doesn't fold away under your cursor.
  const [pinnedIds] = useState(
    () =>
      new Set(assumptions.flatMap((a) => (a.state === 'open' ? [a.id] : []))),
  );
  const isPinned = (i: SpineItem) =>
    i.kind === 'assumption' && pinnedIds.has(i.id);
  const [open, setOpen] = useState(() => new Set<number>());
  const toggle = (i: number) =>
    setOpen((was) => {
      const next = new Set(was);
      if (!next.delete(i)) next.add(i);
      return next;
    });
  const itemRow = (item: SpineItem, j: number) => {
    if (item.kind === 'decision')
      return <DecisionRow key={j} text={item.text} />;
    const a = ledger.get(item.id);
    return (
      !!a && (
        <ItemRail key={j}>
          <AssumptionLine
            assumption={a}
            onAccept={() => onSet(a, 'accepted')}
            onChange={() => onChange(a)}
          />
        </ItemRail>
      )
    );
  };
  const last = nodes.length - 1;
  const groups = nodes.map((node, i) => {
    const isOpen = open.has(i);
    const items = node.kind === 'step' ? (node.items ?? []) : [];
    const pinned = items.filter(isPinned);
    const folded =
      node.kind === 'pivot'
        ? node.dropped.map((title) => <DroppedRow key={title} title={title} />)
        : items.filter((item) => !isPinned(item)).map(itemRow);
    const endsFolded = isOpen && folded.length > 0;
    const header = {
      isFirst: i === 0,
      isLast: i === last && !pinned.length && !endsFolded,
      isOpen,
      onToggle: folded.length > 0 ? () => toggle(i) : undefined,
    };
    const endRail =
      '[&>*:last-child>[data-rail]]:bottom-auto [&>*:last-child>[data-rail]]:h-[18px]';
    return (
      <li key={i} className="flex flex-col">
        {node.kind === 'pivot' ? (
          <PivotRow why={node.why} dropped={node.dropped.length} {...header} />
        ) : (
          <StepRow
            node={node}
            folded={items.filter((it) => !isPinned(it))}
            {...header}
          />
        )}
        {pinned.length > 0 && (
          <div
            className={cn(
              'flex flex-col',
              i === last && !endsFolded && endRail,
            )}
          >
            {pinned.map(itemRow)}
          </div>
        )}
        {!!header.onToggle && (
          <Expand isOpen={isOpen}>
            <div className={cn('flex flex-col', i === last && endRail)}>
              {folded}
            </div>
          </Expand>
        )}
      </li>
    );
  });
  return (
    <section aria-label="Plan" className="flex flex-col gap-1.5">
      <SectionLabel>Plan</SectionLabel>
      <ol className="flex flex-col">{groups}</ol>
    </section>
  );
}

const plural = (n: number, word: string) =>
  n > 0 && `${n} ${word}${n === 1 ? '' : 's'}`;

/** A step or pivot's own row: first and last cut the rail at their node; `onToggle` folds what hangs off it. */
interface HeaderProps {
  isFirst: boolean;
  isLast: boolean;
  isOpen: boolean;
  onToggle?: () => void;
}

/** A row on the rail: the line runs through every row (the first starts and the last ends at its node), the node sits on the first line. */
function Rail({
  node,
  isFirst,
  isLast,
  className,
  children,
}: {
  node?: ReactNode;
  isFirst?: boolean;
  isLast?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        'relative grid min-h-9 grid-cols-[14px_minmax(0,1fr)] gap-x-2.5 py-2 type-meta',
        className,
      )}
    >
      <span
        data-rail
        aria-hidden
        className={cn(
          'absolute top-0 bottom-0 left-[6.5px] w-px bg-border',
          isFirst && 'top-[18px]',
          isLast && 'bottom-auto h-[18px]',
        )}
      />
      <span className="relative flex h-5 items-center justify-center">
        {node}
      </span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** A header row: the whole row toggles, with what it holds and a chevron at the end. */
function HeaderRail({
  node,
  label,
  meta,
  isFirst,
  isLast,
  isOpen,
  onToggle,
  children,
}: HeaderProps & {
  node: ReactNode;
  label: string;
  meta?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Rail
      node={node}
      isFirst={isFirst}
      isLast={isLast}
      className={cn('rounded-md', !!onToggle && 'hover:bg-accent/60')}
    >
      {!!onToggle && (
        <button
          type="button"
          aria-expanded={isOpen}
          aria-label={label}
          onClick={onToggle}
          className="absolute inset-0 z-10 cursor-default rounded-md focus-visible:outline-2 focus-visible:-outline-offset-2"
        />
      )}
      <span className="flex min-w-0 items-start gap-2.5">
        <span className="min-w-0 flex-1 text-pretty">{children}</span>
        {!!meta && (
          <span className="shrink-0 type-caption leading-5 text-subtle-foreground">
            {meta}
          </span>
        )}
        <span className="flex h-5 shrink-0 items-center pr-2">
          {onToggle ? (
            <ChevronRight
              aria-hidden
              className={cn(
                'size-3.5 text-subtle-foreground transition-transform duration-150',
                isOpen && 'rotate-90',
              )}
            />
          ) : (
            <span aria-hidden className="size-3.5" />
          )}
        </span>
      </span>
    </Rail>
  );
}

/** `folded` is what sits behind the chevron; the row counts it, since pinned assumptions already show. */
function StepRow({
  node,
  folded,
  ...header
}: HeaderProps & {
  node: Extract<SpineNode, { kind: 'step' }>;
  folded: SpineItem[];
}) {
  const { title, status } = node;
  const decisions = folded.filter((i) => i.kind === 'decision').length;
  const answered = folded.length - decisions;
  const meta = [
    status === 'pending' && 'Not done',
    plural(decisions, 'decision'),
    answered > 0 && `${answered} answered`,
  ]
    .filter(Boolean)
    .flatMap((part, i) => (i ? [' · ', part] : [part]));
  return (
    <HeaderRail
      {...header}
      label={title}
      meta={meta.length > 0 && meta}
      node={
        status === 'done' ? (
          <CheckCircle
            filled
            aria-hidden
            className="size-3.5 bg-card text-subtle-foreground"
          />
        ) : (
          <span className="size-3 rounded-full border border-subtle-foreground bg-card" />
        )
      }
    >
      <span className="text-muted-foreground">
        <span className="sr-only">
          {status === 'done' ? 'Done: ' : 'Not done: '}
        </span>
        {title}
      </span>
    </HeaderRail>
  );
}

/** Hangs off the step above: a short tick from the rail, then the item. */
function ItemRail({ children }: { children: ReactNode }) {
  return (
    <Rail className="pl-0">
      <span
        aria-hidden
        className="absolute top-[18px] left-[7px] h-px w-[13px] bg-border"
      />
      <div className="pl-3">{children}</div>
    </Rail>
  );
}

function DecisionRow({ text }: { text: string }) {
  return (
    <ItemRail>
      <div className="flex min-w-0 items-start gap-2.5 text-foreground/80">
        <span className="flex h-5 w-3.5 shrink-0 items-center justify-center">
          <span aria-hidden className="size-1.5 rounded-full bg-chart-1" />
        </span>
        <span className="min-w-0 flex-1 text-pretty [overflow-wrap:anywhere]">
          <span className="sr-only">Decided: </span>
          {text}
        </span>
      </div>
    </ItemRail>
  );
}

/** A step the agent planned and dropped: it forks off the rail, dashed, and stays muted. */
function DroppedRow({ title }: { title: string }) {
  return (
    <Rail>
      <span
        aria-hidden
        className="absolute top-0 left-[6.5px] h-[18px] w-[18px] rounded-bl-lg border-b border-l border-dashed border-subtle-foreground/60"
      />
      <div className="flex min-w-0 items-start gap-2.5 pl-3 text-subtle-foreground">
        <span className="flex h-5 shrink-0 items-center">
          <span
            aria-hidden
            className="size-3 rounded-full border border-dashed border-subtle-foreground"
          />
        </span>
        <span className="min-w-0 flex-1 text-pretty">
          <span className="sr-only">Dropped: </span>
          {title}
        </span>
      </div>
    </Rail>
  );
}

/** Where the plan changed, and why: the dropped steps fork off below it. */
function PivotRow({
  why,
  dropped,
  ...header
}: HeaderProps & { why: string; dropped: number }) {
  return (
    <HeaderRail
      {...header}
      label={`Pivot: ${why}`}
      meta={`${dropped} dropped`}
      node={<Route aria-hidden className="size-3.5 bg-card text-info" />}
    >
      <span className="font-medium text-info">Pivot · </span>
      <span className="text-foreground/80">{why}</span>
    </HeaderRail>
  );
}
