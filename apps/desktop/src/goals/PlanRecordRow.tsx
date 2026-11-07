import { useState, type ReactNode } from 'react';
import { ClipboardList } from '@/icons';
import { cn } from '@/lib/utils';
import type { Assumption, PlanRecord, Step, Thread } from '../model';
import { Expand, FoldChevron } from '../Fold';
import { SectionLabel } from '../ui';
import { AssumptionDot } from './Assumptions';
import { PlanIcon } from './NextMove';
import {
  count,
  recordLayout,
  recordTitle,
  type RecordItem,
  type RecordStep,
} from './planRecord';

/**
 * What a turn's plan leaves in the transcript once the turn ends: one folded row, lined up with the work log. Opening it shows the
 * steps with their decisions and answered assumptions; open assumptions are in the wrap-up box until you answer them.
 */
export function PlanRecordRow({
  thread,
  record,
}: {
  thread: Thread;
  record: PlanRecord;
}) {
  const [isOpen, setOpen] = useState(false);
  const layout = recordLayout(record, thread.assumptions);
  const title = recordTitle(layout);
  if (!layout.steps.length && !layout.unplaced.length) return null;
  return (
    // Pulled out by the row padding so its icon lines up with the work log above it.
    <section aria-label="Plan record" className="-mx-2 flex flex-col">
      <StepLine
        isLog
        icon={
          <ClipboardList aria-hidden className="size-4 text-muted-foreground" />
        }
        title={title}
        titleClass="text-muted-foreground"
        isOpen={isOpen}
        onToggle={() => setOpen(!isOpen)}
      />
      <Expand isOpen={isOpen}>
        <ol aria-label="Plan" className="flex flex-col pl-6">
          {layout.steps.map((entry) => (
            <RecordStepRow key={entry.n} entry={entry} />
          ))}
          {layout.unplaced.length > 0 && (
            <li className="mt-1 flex flex-col">
              <SectionLabel className="px-3 py-1.5">Not on a step</SectionLabel>
              {layout.unplaced.map((item, i) => (
                <ItemIndent key={i}>
                  <ItemLine item={item} />
                </ItemIndent>
              ))}
            </li>
          )}
        </ol>
      </Expand>
    </section>
  );
}

function RecordStepRow({ entry }: { entry: RecordStep }) {
  const [isOpen, setOpen] = useState(false);
  const { step, items } = entry;
  const isDone = step.status === 'done';
  const decisions = items.filter((i) => i.kind === 'decision').length;
  const answered = items.length - decisions;
  return (
    <li className="flex flex-col">
      <StepLine
        icon={<PlanIcon status={recordStatus(step)} slot={1} />}
        title={step.title}
        titleClass={isDone ? 'text-muted-foreground' : 'text-foreground/75'}
        meta={[
          !!decisions && count(decisions, 'decision'),
          !!answered && `${answered} answered`,
          !isDone && 'Not done',
        ]}
        isOpen={isOpen}
        onToggle={items.length ? () => setOpen(!isOpen) : undefined}
      />
      {items.length > 0 && (
        <Expand isOpen={isOpen}>
          <div className="flex flex-col">
            {items.map((item, i) => (
              <ItemIndent key={i}>
                <ItemLine item={item} />
              </ItemIndent>
            ))}
          </div>
        </Expand>
      )}
    </li>
  );
}

/** A settled step: done, stopped partway, or never started. */
const recordStatus = (step: Step) =>
  step.status === 'done'
    ? 'done'
    : step.startedAt === undefined
      ? 'pending'
      : 'paused';

/** One row, the same height and columns as the live plan's, so a step never changes shape when the turn ends. */
function StepLine({
  icon,
  title,
  titleClass,
  meta,
  isLog,
  isOpen,
  onToggle,
}: {
  icon: ReactNode;
  title: string;
  titleClass?: string;
  meta?: ReactNode;
  /** The record's own line in the transcript: a log line's height and inset, like every event beside it. */
  isLog?: boolean;
  isOpen?: boolean;
  onToggle?: () => void;
}) {
  const parts = (Array.isArray(meta) ? meta : [meta]).filter(Boolean);
  return (
    <div
      className={cn(
        'relative flex h-9 min-w-0 items-center gap-2.5 rounded-md px-3 type-meta',
        isLog && 'h-7 w-fit max-w-full gap-2 rounded-lg px-2',
        !!onToggle && 'hover:bg-accent/60',
      )}
    >
      {!!onToggle && (
        <button
          type="button"
          aria-expanded={isOpen}
          aria-label={title}
          onClick={onToggle}
          className="absolute inset-0 cursor-default rounded-md focus-visible:outline-2 focus-visible:-outline-offset-2"
        />
      )}
      <span className="flex size-4 shrink-0 items-center justify-center">
        {icon}
      </span>
      <span className={cn('min-w-0 flex-1 truncate', titleClass)}>{title}</span>
      {parts.length > 0 && (
        <span className="shrink-0 type-caption text-subtle-foreground tabular-nums">
          {parts.flatMap((p, i) => (i ? [' · ', p] : [p]))}
        </span>
      )}
      <span className="flex w-[0.85em] shrink-0 justify-center">
        {!!onToggle && (
          <FoldChevron isOpen={isOpen} className="text-subtle-foreground" />
        )}
      </span>
    </div>
  );
}

/** Items sit under their step's title column. */
function ItemIndent({ children }: { children: ReactNode }) {
  return <div className="py-1.5 pl-9">{children}</div>;
}

function ItemLine({ item }: { item: RecordItem }) {
  if (item.kind === 'decision')
    return (
      <div className="flex min-w-0 items-start gap-2.5 type-meta text-foreground/80">
        <span className="flex h-5 w-3.5 shrink-0 items-center justify-center">
          <span aria-hidden className="size-1.5 rounded-full bg-chart-1" />
        </span>
        <span className="min-w-0 flex-1 text-pretty [overflow-wrap:anywhere]">
          <span className="sr-only">Decided: </span>
          {item.text}
        </span>
      </div>
    );
  return <AnsweredLine assumption={item.assumption} />;
}

/** An assumption you answered: what it is now, with the agent's words struck under it when you changed them. */
function AnsweredLine({ assumption: a }: { assumption: Assumption }) {
  const isChanged = a.state === 'changed' && !!a.correction;
  return (
    <div className="flex min-w-0 items-start gap-2.5 type-meta text-muted-foreground">
      <AssumptionDot state={a.state} />
      <span className="flex min-w-0 flex-1 flex-col text-pretty [overflow-wrap:anywhere]">
        <span>
          <span className="sr-only">
            {isChanged ? 'Changed: ' : 'Accepted: '}
          </span>
          {isChanged ? a.correction : a.text}
        </span>
        {isChanged && (
          <span className="text-subtle-foreground line-through">{a.text}</span>
        )}
      </span>
    </div>
  );
}
