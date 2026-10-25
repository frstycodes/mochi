import { useState } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { Step, Thread } from './model';
import { isWorking } from './agentPhase';
import { boardColumns, goalProgress, progressLabel } from './progress';
import { hasGoal } from './drift';
import { useSpaceThreads, useDispatch } from './store';
import {
  ProgressRing,
  ProviderMarks,
  ThreadStatusIcon,
  lineColor,
  stepLabel,
} from './ui';

const ROW = 112;
const LABEL_ANGLE = 28;
const LABEL_CHARS = 24;
const LABEL_OVERHANG = 56;
const COL = 108;
const X0 = 68;
const LABEL_W = 'w-[168px] md:w-[248px]';

interface Hovered {
  thread: Thread;
  step: Step;
  x: number;
  y: number;
}

export function BoardView() {
  const dispatch = useDispatch();
  const threads = useSpaceThreads().filter((t) => t.status !== 'settled');
  const [hovered, setHovered] = useState<Hovered | null>(null);
  const layout = boardLayout(threads);

  if (threads.length === 0) return <EmptyBoard />;

  return (
    <ScrollArea className="h-full">
      <div className="flex min-h-0 flex-col">
        <div className="flex flex-wrap items-end gap-x-6 gap-y-2 px-4 pt-5 pb-4 md:px-8 md:pt-8">
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-semibold">Board</h1>
            <p className="text-sm text-muted-foreground">
              {threads.length} active threads
            </p>
          </div>
          <BoardLegend />
        </div>

        <div className="flex min-w-0">
          <ol className={`${LABEL_W} shrink-0 border-r border-border`}>
            {threads.map((t) => (
              <li key={t.id} style={{ height: ROW }}>
                <button
                  type="button"
                  onClick={() =>
                    dispatch({ type: 'go', view: { kind: 'thread', id: t.id } })
                  }
                  className="flex h-full w-full cursor-default flex-col justify-center gap-1 px-3 text-left hover:bg-accent/60 md:px-4"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      aria-hidden
                      className="h-4 w-1 shrink-0 rounded-full"
                      style={{ background: lineColor(t.line) }}
                    />
                    <span className="min-w-0 truncate text-sm font-medium">
                      {t.title}
                    </span>
                  </span>
                  <span className="flex items-center gap-2 pl-3 text-xs text-subtle-foreground">
                    <ThreadStatusIcon status={t.status} />
                    <ProviderMarks providers={t.providers} size={12} />
                    <GoalStatus thread={t} />
                  </span>
                </button>
              </li>
            ))}
          </ol>

          <div
            className="relative min-w-0 flex-1 overflow-x-auto"
            onPointerLeave={() => setHovered(null)}
          >
            <svg
              width={layout.width}
              height={threads.length * ROW + LABEL_OVERHANG}
              className="block"
              role="img"
              aria-label="Metro map of active threads"
            >
              {threads.map((t, row) => (
                <Line key={t.id} thread={t} row={row} cols={layout.cols} />
              ))}

              {threads.map((t, row) =>
                visibleSteps(t).map((s) => (
                  <Station
                    key={s.id}
                    thread={t}
                    step={s}
                    x={X0 + layout.cols.get(s.id)! * COL}
                    y={row * ROW + ROW / 2}
                    onHover={setHovered}
                    onOpen={() =>
                      dispatch({
                        type: 'go',
                        view: { kind: 'thread', id: t.id },
                      })
                    }
                  />
                )),
              )}
            </svg>
            {hovered && <StationTooltip hovered={hovered} />}
          </div>
        </div>
      </div>
    </ScrollArea>
  );
}

function GoalStatus({ thread }: { thread: Thread }) {
  if (!hasGoal(thread)) return null;
  const progress = goalProgress(thread);
  return (
    <span className="flex min-w-0 items-center gap-1.5 tabular">
      <ProgressRing
        met={progress.met}
        total={progress.total}
        slot={thread.line}
        size={12}
        isWorking={isWorking(thread)}
      />
      <span className="truncate">{progressLabel(progress)}</span>
    </span>
  );
}

function visibleSteps(t: Thread) {
  return t.steps.filter((s) => s.status !== 'dropped');
}

function boardLayout(threads: Thread[]) {
  const cols = boardColumns(threads.map(visibleSteps));
  const maxCol = Math.max(0, ...cols.values());
  return { cols, width: X0 + maxCol * COL + 200 };
}

function Line({
  thread,
  row,
  cols,
}: {
  thread: Thread;
  row: number;
  cols: Map<string, number>;
}) {
  const steps = visibleSteps(thread);
  if (steps.length === 0) return null;
  const y = row * ROW + ROW / 2;
  const xs = steps.map((s) => X0 + cols.get(s.id)! * COL);
  const first = xs[0];
  const last = xs[xs.length - 1];
  const lastDone = steps.findLastIndex((s) => s.status === 'done');
  const progressX = lastDone < 0 ? first : xs[lastDone];
  const color = lineColor(thread.line);

  return (
    <g>
      <line
        x1={first}
        x2={last + 40}
        y1={y}
        y2={y}
        stroke={color}
        strokeOpacity={0.3}
        strokeWidth={6}
        strokeLinecap="round"
      />
      <line
        x1={first}
        x2={Math.max(first, progressX)}
        y1={y}
        y2={y}
        stroke={color}
        strokeWidth={6}
        strokeLinecap="round"
      />
      <line
        x1={last + 40}
        x2={last + 40}
        y1={y - 10}
        y2={y + 10}
        stroke={color}
        strokeWidth={4}
        strokeLinecap="round"
      />
    </g>
  );
}

function Station({
  thread,
  step,
  x,
  y,
  onHover,
  onOpen,
}: {
  thread: Thread;
  step: Step;
  x: number;
  y: number;
  onHover: (h: Hovered | null) => void;
  onOpen: () => void;
}) {
  const color = lineColor(thread.line);
  const s = step.status;
  const label =
    step.title.length > LABEL_CHARS
      ? `${step.title.slice(0, LABEL_CHARS - 1)}…`
      : step.title;

  return (
    <g
      className="cursor-pointer"
      tabIndex={0}
      role="button"
      aria-label={`${step.title}, ${stepLabel(s)}, in ${thread.title}`}
      onPointerEnter={() => onHover({ thread, step, x, y })}
      onFocus={() => onHover({ thread, step, x, y })}
      onBlur={() => onHover(null)}
      onClick={onOpen}
      onKeyDown={(e) => e.key === 'Enter' && onOpen()}
    >
      <circle cx={x} cy={y} r={18} fill="transparent" />
      {s === 'running' && (
        <circle cx={x} cy={y} r={7} fill={color} className="station-pulse" />
      )}
      <circle
        cx={x}
        cy={y}
        r={7}
        fill={s === 'done' ? color : 'var(--background)'}
        stroke={
          s === 'blocked'
            ? 'var(--warning)'
            : s === 'done'
              ? 'var(--background)'
              : color
        }
        strokeWidth={s === 'done' ? 2 : 3}
      />
      <text
        x={x + 4}
        y={y + 18}
        transform={`rotate(${LABEL_ANGLE} ${x + 4} ${y + 18})`}
        className={
          s === 'done'
            ? 'fill-subtle-foreground text-xs'
            : 'fill-muted-foreground text-xs'
        }
      >
        {label}
      </text>
    </g>
  );
}

function StationTooltip({ hovered }: { hovered: Hovered }) {
  const { thread, step, x, y } = hovered;
  return (
    <div
      role="status"
      className="pointer-events-none absolute z-10 w-64 rounded-lg border border-border bg-background p-3 text-sm shadow-[var(--elev-popover)]"
      style={{ left: x + 18, top: y - 12 }}
    >
      <div className="font-medium text-foreground">{step.title}</div>
      <div className="text-xs text-subtle-foreground">
        {stepLabel(step.status)} · {thread.title}
      </div>
      {!!step.note && (
        <div className="mt-1.5 text-xs text-muted-foreground">{step.note}</div>
      )}
    </div>
  );
}

function BoardLegend() {
  return (
    <ul
      className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-subtle-foreground"
      aria-label="Legend"
    >
      <LegendItem label="Done">
        <circle cx="8" cy="8" r="5" fill="var(--subtle-foreground)" />
      </LegendItem>
      <LegendItem label="Running">
        <circle
          cx="8"
          cy="8"
          r="5"
          fill="var(--background)"
          stroke="var(--muted-foreground)"
          strokeWidth="2.5"
        />
      </LegendItem>
    </ul>
  );
}

function LegendItem({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex items-center gap-1.5">
      <svg width="16" height="16" aria-hidden>
        {children}
      </svg>
      {label}
    </li>
  );
}

function EmptyBoard() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1 p-8 text-center">
      <div className="text-lg font-semibold">
        No active threads in this space
      </div>
      <p className="text-sm text-muted-foreground">
        Start a thread and it shows up here as a line.
      </p>
    </div>
  );
}
