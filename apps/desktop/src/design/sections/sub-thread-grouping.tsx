import { useState, type DragEvent, type ReactNode } from 'react';
import { XSquare, Copy, DiagramTree } from '@/icons';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { Thread } from '../../model';
import { TooltipIconButton } from '../../ui';
import { Block } from '../layout';
import { Branch, ChildRow, ParentRow, type RowFixture } from './sub-threads';

/** Grouping you confirm: the drafter's suggestion on the goal card, and dragging a row onto another. Mock data; nothing is wired. */
export function SubThreadGroupingBlock({ rl }: { rl: Thread }) {
  return (
    <Block
      title="Sub-threads · grouping you confirm"
      use="Mochi never regroups the sidebar on its own. When the drafter finds a related thread whose goal covers this one, the goal card's Similar row offers to nest it, naming the criterion it would cover; same work stays a warning with no nest. Dragging a row onto another nests it, dragging it off moves it out, both with Undo. The row's menu has Make sub-thread of… for keyboards."
      wide
    >
      <div className="flex flex-wrap items-start gap-6">
        <figure className="flex w-[min(100%,520px)] flex-col gap-2">
          <figcaption className="type-caption text-muted-foreground">
            Goal card · Similar, on “Load test the rate limiter”
          </figcaption>
          <div className="flex flex-col gap-3 rounded-xl border bg-card p-4">
            <p className="type-body text-pretty">
              The limiter holds 2k req/s per key with p99 under 50ms, measured
              with k6 against staging.
            </p>
            <SimilarSuggestions />
          </div>
        </figure>
        <figure className="flex w-[256px] flex-col gap-2">
          <figcaption className="type-caption text-muted-foreground">
            Drag a row onto another to nest it; drag it off to move it out
          </figcaption>
          <NestSandbox rl={rl} />
        </figure>
      </div>
    </Block>
  );
}

const PARENT = 'Public API rate limiting';
const COVERS = 'Holds 2k req/s with p99 under 50ms';

/** The Similar list with the new Nest action on a related thread, turning into a record with Undo once taken. */
function SimilarSuggestions() {
  const [isNested, setNested] = useState(false);
  return (
    <ul aria-label="Similar work" className="flex flex-col gap-1">
      {isNested ? (
        <li className="flex items-center gap-2 rounded-lg bg-muted/40 py-1 pr-1 pl-2.5">
          <DiagramTree
            aria-hidden
            className="size-3.5 shrink-0 text-muted-foreground"
          />
          <span className="min-w-0 flex-1 truncate type-meta text-muted-foreground">
            Sub-thread of <span className="text-foreground">{PARENT}</span>, for
            “{COVERS}”
          </span>
          <Button variant="ghost" size="sm" onClick={() => setNested(false)}>
            Undo
          </Button>
        </li>
      ) : (
        <SimilarRow
          relation="Related: "
          title={PARENT}
          status="In progress"
          detail={`Its goal covers this one: “${COVERS}”`}
        >
          <Button variant="outline" size="sm" onClick={() => setNested(true)}>
            Nest under it
          </Button>
        </SimilarRow>
      )}
      <SimilarRow
        relation="Already in "
        title="Benchmark the gateway under load"
        status="Settled, PR #98 merged"
      />
    </ul>
  );
}

/** The shipped Similar row's look, with a second line for why it fits and room for the nest action. */
function SimilarRow({
  relation,
  title,
  status,
  detail,
  children,
}: {
  relation: string;
  title: string;
  status: string;
  detail?: string;
  children?: ReactNode;
}) {
  return (
    <li className="flex items-center gap-2 rounded-lg bg-muted/40 py-1 pr-1 pl-2.5">
      <Copy aria-hidden className="size-3.5 shrink-0 text-warning" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate type-meta">
          <span className="text-muted-foreground">{relation}</span>
          <span className="text-foreground">{title}</span>
          <span className="text-subtle-foreground"> · {status}</span>
        </span>
        {!!detail && (
          <span className="truncate type-caption text-subtle-foreground">
            {detail}
          </span>
        )}
      </span>
      {children}
      <Button variant="ghost" size="sm">
        Open
      </Button>
      <TooltipIconButton
        label="Dismiss"
        hint="Not the same work; stop showing it here"
      >
        <XSquare />
      </TooltipIconButton>
    </li>
  );
}

interface SandboxRow extends RowFixture {
  id: string;
  parentId?: string;
}

const START: SandboxRow[] = [
  {
    id: 'rl',
    title: PARENT,
    met: 2,
    total: 5,
    tone: null,
    isWorking: true,
    status: 'Working',
    reason: 'Wiring per-key overrides',
  },
  {
    id: 'hd',
    parentId: 'rl',
    title: 'Return RateLimit-* headers',
    met: 2,
    total: 2,
    tone: 'success',
    status: 'In review',
    reason: 'PR #141 in review',
    pr: { number: 141, status: 'open' },
  },
  {
    id: 'lt',
    title: 'Load test the rate limiter',
    met: 0,
    total: 2,
    tone: null,
    isWorking: true,
    status: 'Working',
    reason: 'Running k6 at 2k req/s',
  },
  {
    id: 'fx',
    title: 'Fix flaky checkout e2e',
    met: 1,
    total: 2,
    tone: 'warning',
    status: 'Needs you',
    reason: 'Answer 2 questions',
  },
];

type Drop = { kind: 'nest'; parentId: string } | { kind: 'out' };

/**
 * A sidebar you can regroup by dragging. One level deep: a row with sub-threads can't be nested, and only a top-level row takes
 * one. Each drop leaves an Undo line naming what changed.
 */
function NestSandbox({ rl }: { rl: Thread }) {
  const [rows, setRows] = useState(START);
  const [dragged, setDragged] = useState<string | null>(null);
  const [over, setOver] = useState<Drop | null>(null);
  const [last, setLast] = useState<{
    before: SandboxRow[];
    text: string;
  } | null>(null);
  const roots = rows.filter((r) => !r.parentId);
  const moving = rows.find((r) => r.id === dragged);
  const canNestUnder = (target: SandboxRow) =>
    !!moving &&
    target.id !== moving.id &&
    !target.parentId &&
    moving.parentId !== target.id &&
    !rows.some((r) => r.parentId === moving.id);
  const drop = (to: Drop) => {
    if (!moving) return;
    const title = (id: string) => rows.find((r) => r.id === id)!.title;
    const text =
      to.kind === 'nest'
        ? `${moving.title} is now a sub-thread of ${title(to.parentId)}`
        : `${moving.title} is a thread of its own again`;
    setLast({ before: rows, text });
    setRows(
      rows.map((r) =>
        r.id === moving.id
          ? { ...r, parentId: to.kind === 'nest' ? to.parentId : undefined }
          : r,
      ),
    );
  };
  const end = () => {
    setDragged(null);
    setOver(null);
  };
  // Over the list but not a top-level row: a sub-thread dropped here moves out.
  const onListOver = (e: DragEvent) => {
    if (!moving?.parentId) return;
    e.preventDefault();
    setOver({ kind: 'out' });
  };
  return (
    <div className="flex flex-col gap-2">
      <ul
        className={cn(
          'flex flex-col gap-0.5 rounded-xl border bg-sidebar p-2',
          over?.kind === 'out' && 'border-foreground/20',
        )}
        onDragOver={onListOver}
        onDragLeave={(e) =>
          !e.currentTarget.contains(e.relatedTarget as Node | null) &&
          setOver(null)
        }
        onDrop={(e) => {
          e.preventDefault();
          if (over) drop(over);
          end();
        }}
      >
        {roots.map((root) => {
          const children = rows.filter((r) => r.parentId === root.id);
          const isTarget = over?.kind === 'nest' && over.parentId === root.id;
          return (
            <li key={root.id} className="flex flex-col">
              <DragRow
                row={root}
                isDragged={dragged === root.id}
                isTarget={isTarget}
                onStart={() => setDragged(root.id)}
                onEnd={end}
                onOver={(e) => {
                  // Over a top-level row nothing else happens: it nests here or the drop isn't allowed (onto its own parent, say).
                  e.stopPropagation();
                  if (!canNestUnder(root)) return setOver(null);
                  e.preventDefault();
                  setOver({ kind: 'nest', parentId: root.id });
                }}
              >
                <ParentRow row={root} rl={rl} />
              </DragRow>
              {children.length > 0 && (
                <ul
                  aria-label={`Sub-threads of ${root.title}`}
                  className="-mt-1 ml-[15px] flex flex-col gap-0.5"
                >
                  {children.map((c, i) => (
                    <Branch key={c.id} isLast={i === children.length - 1}>
                      <DragRow
                        row={c}
                        isDragged={dragged === c.id}
                        onStart={() => setDragged(c.id)}
                        onEnd={end}
                      >
                        <ChildRow row={c} rl={rl} />
                      </DragRow>
                    </Branch>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
      <p
        role="status"
        className="flex min-h-7 items-center gap-2 px-1 type-caption text-muted-foreground"
      >
        {over ? (
          <span className="min-w-0 flex-1">
            {over.kind === 'nest'
              ? `Drop to nest under ${rows.find((r) => r.id === over.parentId)!.title}`
              : 'Drop to move it out'}
          </span>
        ) : (
          !!last && (
            <>
              <span className="min-w-0 flex-1">{last.text}</span>
              <Button
                variant="ghost"
                size="xs"
                onClick={() => (setRows(last.before), setLast(null))}
              >
                Undo
              </Button>
            </>
          )
        )}
      </p>
    </div>
  );
}

/** A draggable row; while it's a drop target an inside hairline marks it, and the row being dragged dims. */
function DragRow({
  row,
  isDragged,
  isTarget,
  onStart,
  onEnd,
  onOver,
  children,
}: {
  row: RowFixture;
  isDragged: boolean;
  isTarget?: boolean;
  onStart: () => void;
  onEnd: () => void;
  onOver?: (e: DragEvent) => void;
  children: ReactNode;
}) {
  return (
    <div
      draggable
      aria-label={row.title}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        onStart();
      }}
      onDragEnd={onEnd}
      onDragOver={onOver}
      className={cn(
        'rounded-lg border border-transparent',
        isTarget && 'border-foreground/20 bg-sidebar-accent',
        isDragged && 'opacity-50',
      )}
    >
      {children}
    </div>
  );
}
