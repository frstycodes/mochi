import type { Step, Thread } from '../model';
import { boardColumns } from '../progress';
import { lineColor } from '../ui';
import { DiffStat } from '../WorkLog';
import type { DiffSpec } from './fence';
import { plural } from '../lib/format.ts';

const GUTTER = 132;
const COL = 104;
const ROW = 52;
const TOP = 14;
const LABEL_CHARS = 15;

/** A slice of the metro board: one line per thread. */
export function MetroVisual({ threads }: { threads: Thread[] }) {
  const lines = threads.map((t) =>
    t.steps.filter((s) => s.status !== 'dropped'),
  );
  const cols = boardColumns(lines);
  const lastCol = Math.max(0, ...cols.values());
  const width = GUTTER + (lastCol + 1) * COL;
  const height = TOP + threads.length * ROW;
  const x = (step: Step) => GUTTER + cols.get(step.id)! * COL + COL / 2;
  const y = (row: number) => TOP + row * ROW + 8;

  return (
    <div className="overflow-x-auto">
      <svg
        data-visual-svg
        width={width}
        height={height}
        role="img"
        aria-label={`Metro of ${threads.map((t) => t.title).join(', ')}`}
        className="block"
      >
        {threads.map((thread, row) => {
          const steps = lines[row];
          const color = lineColor(thread.line);
          return (
            <g key={thread.id}>
              <text
                x={0}
                y={y(row) + 4}
                className="fill-foreground text-xs font-medium"
              >
                {truncate(thread.title, 18)}
              </text>
              {steps.slice(1).map((s, i) => (
                <line
                  key={s.id}
                  x1={x(steps[i])}
                  x2={x(s)}
                  y1={y(row)}
                  y2={y(row)}
                  stroke={color}
                  strokeWidth={3}
                  strokeOpacity={steps[i].status === 'done' ? 1 : 0.35}
                />
              ))}
              {steps.map((s) => (
                <g key={s.id}>
                  <title>{`${s.title} · ${s.status}`}</title>
                  <circle
                    cx={x(s)}
                    cy={y(row)}
                    r={s.status === 'running' ? 6 : 5}
                    fill={s.status === 'done' ? color : 'var(--card)'}
                    stroke={color}
                    strokeWidth={s.status === 'running' ? 3 : 2}
                    strokeDasharray={s.status === 'blocked' ? '2 2' : undefined}
                  />
                  <text
                    x={x(s)}
                    y={y(row) + 22}
                    textAnchor="middle"
                    className="fill-muted-foreground text-[11px]"
                  >
                    {truncate(s.title, LABEL_CHARS)}
                  </text>
                </g>
              ))}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function truncate(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function DiffVisual({ spec }: { spec: DiffSpec }) {
  const added = spec.files.reduce((n, f) => n + f.added, 0);
  const removed = spec.files.reduce((n, f) => n + f.removed, 0);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2 pb-1 type-meta text-muted-foreground">
        <span className="tabular">
          {spec.files.length} {plural(spec.files.length, 'file', 'files')}{' '}
          changed
        </span>
        <span className="ml-auto">
          <DiffStat added={added} removed={removed} withBar />
        </span>
      </div>
      {spec.files.map((f) => (
        <div
          key={f.path}
          className="flex h-7 items-center gap-2 rounded-md px-1 hover:bg-accent"
        >
          <FilePath path={f.path} />
          <span className="ml-auto shrink-0">
            <DiffStat added={f.added} removed={f.removed} withBar />
          </span>
        </div>
      ))}
    </div>
  );
}

function FilePath({ path }: { path: string }) {
  const cut = path.lastIndexOf('/') + 1;
  return (
    <span className="min-w-0 truncate font-mono text-xs">
      <span className="text-subtle-foreground">{path.slice(0, cut)}</span>
      <span className="text-foreground">{path.slice(cut)}</span>
    </span>
  );
}
