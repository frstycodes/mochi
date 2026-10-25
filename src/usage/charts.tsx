import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useSize } from '../browser/PageSurface';
import { cn } from '@/lib/utils';
import { periodName } from './days';
import { compact, usd } from './Figure';
import type { SeriesPoint, UsageView } from './report';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const WEEKDAY_NAMES = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
];
const HOUR_TICKS = [0, 6, 12, 18];
const BAR_RADIUS = 3;
/** Room one date label needs on the time axis, so a narrow chart shows fewer. */
const AXIS_LABEL_WIDTH = 80;
const CLAUDE = 'var(--color-chart-2)';
const CODEX = 'var(--color-chart-1)';

export interface TipContent {
  title: string;
  rows: { label: string; value: string; color?: string }[];
}

/** A hovered mark: its id (so the chart can emphasise it), where it sits in the chart's pixels, and what to say about it. */
interface Tip extends TipContent {
  id: string;
  x: number;
  y: number;
}

type Show = (tip: Tip | null) => void;

/**
 * An SVG sized to its box: charts draw in pixels so marks stay crisp and labels stay at their type size. Colours go in
 * `fill`/`stroke` attributes, not Tailwind fill classes: the share export (html-to-image) drops class fills on SVG text.
 * Marks call `show` on hover; the tip sits above the point it names, kept inside the chart's width.
 */
function Measured({
  className,
  heightFor,
  children,
}: {
  className?: string;
  heightFor?: (width: number) => number;
  children: (
    size: { w: number; h: number },
    hover: { show: Show; active: string | null },
  ) => ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const size = useSize(ref);
  const [tip, setTip] = useState<Tip | null>(null);
  return (
    <div
      ref={ref}
      data-chart={size.w > 0 && size.h > 0 ? 'drawn' : 'measuring'}
      className={cn('relative min-w-0', className)}
      style={
        heightFor && size.w > 0 ? { height: heightFor(size.w) } : undefined
      }
      onPointerLeave={() => setTip(null)}
    >
      {size.w > 0 && (
        <svg
          className="absolute inset-0 overflow-visible"
          width={size.w}
          height={size.h}
          aria-hidden
        >
          {children(size, { show: setTip, active: tip?.id ?? null })}
        </svg>
      )}
      {!!tip && <ChartTip tip={tip} width={size.w} />}
    </div>
  );
}

/** Centred over the mark, then pushed back inside the chart when its measured width would poke out of either side. */
function ChartTip({ tip, width }: { tip: Tip; width: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [tipWidth, setTipWidth] = useState(0);
  // oxlint-disable-next-line react/exhaustive-effect-dependencies -- measures again once each new `tip` has rendered its rows
  useLayoutEffect(() => setTipWidth(ref.current?.offsetWidth ?? 0), [tip]);
  const half = tipWidth / 2;
  const left = Math.min(Math.max(tip.x, half), Math.max(half, width - half));
  return (
    <div
      ref={ref}
      className="pointer-events-none absolute z-10 flex w-max min-w-36 -translate-x-1/2 -translate-y-full flex-col gap-1 rounded-md bg-foreground px-3 py-2 text-xs whitespace-nowrap text-background shadow-popover"
      style={{ left, top: tip.y - 8 }}
    >
      <span className="font-medium">{tip.title}</span>
      {tip.rows.map((row) => (
        <span key={row.label} className="flex items-center gap-2">
          {!!row.color && (
            <i
              className="size-2 shrink-0 rounded-full"
              style={{ background: row.color }}
            />
          )}
          <span className="flex-1 opacity-80">{row.label}</span>
          <span className="tabular font-medium">{row.value}</span>
        </span>
      ))}
    </div>
  );
}

/** One bar per day (or week); the peak, or the hovered bar, at full strength and the rest at 45%; removals hang below when given. */
export function SparkBars({
  values,
  below,
  color,
  belowColor = 'var(--color-destructive)',
  describe,
  className,
}: {
  values: number[];
  below?: number[];
  color: string;
  belowColor?: string;
  describe: (i: number) => TipContent;
  className?: string;
}) {
  return (
    <Measured className={cn('h-10', className)}>
      {({ w, h }, { show, active }) => {
        const max = Math.max(1, ...values, ...(below ?? []));
        const base = below ? h * 0.72 : h;
        const scale = base / max;
        const step = w / Math.max(1, values.length);
        const bar = Math.max(1.5, Math.min(step * 0.62, 18));
        const strong =
          active !== null
            ? Number(active)
            : values.indexOf(Math.max(...values));
        return values.map((v, i) => {
          const x = i * step + (step - bar) / 2;
          const up = v > 0 ? Math.max(v * scale, 2) : 0;
          const down = below?.[i] ? Math.max(below[i] * scale, 2) : 0;
          return (
            <g key={i}>
              {up > 0 && (
                <rect
                  x={x}
                  y={base - up}
                  width={bar}
                  height={up}
                  rx={Math.min(BAR_RADIUS, up / 2, bar / 2)}
                  fill={color}
                  fillOpacity={i === strong ? 1 : 0.45}
                />
              )}
              {down > 0 && (
                <rect
                  x={x}
                  y={base + 2}
                  width={bar}
                  height={down}
                  rx={Math.min(BAR_RADIUS, down / 2, bar / 2)}
                  fill={belowColor}
                  fillOpacity={active === null || i === strong ? 1 : 0.6}
                />
              )}
              <rect
                x={i * step}
                y={0}
                width={step}
                height={h}
                fill="transparent"
                onPointerEnter={() =>
                  show({
                    id: String(i),
                    x: x + bar / 2,
                    y: base - up,
                    ...describe(i),
                  })
                }
              />
            </g>
          );
        });
      }}
    </Measured>
  );
}

/** Each harness's spend added up day by day, one line each on one scale: where the money went, the slope its pace. */
export function SpendTrend({
  series,
  isWeekly,
  className,
}: {
  series: SeriesPoint[];
  isWeekly: boolean;
  className?: string;
}) {
  return (
    <div className={cn('flex min-h-0 flex-col gap-2', className)}>
      <div className="type-meta flex gap-4 text-muted-foreground">
        <LegendDot color={CLAUDE} label="Claude Code" />
        <LegendDot color={CODEX} label="Codex" />
      </div>
      <Measured className="min-h-0 flex-1">
        {({ w, h }, { show, active }) => {
          let claudeSum = 0;
          let codexSum = 0;
          const lines = [
            {
              id: 'claude',
              color: CLAUDE,
              sums: series.map((p) => (claudeSum += p.cost.claude)),
            },
            {
              id: 'codex',
              color: CODEX,
              sums: series.map((p) => (codexSum += p.cost.codex)),
            },
          ];
          const [claude, codex] = lines.map((l) => l.sums);
          const top = niceCeiling(Math.max(claudeSum, codexSum));
          const padT = 8;
          const padB = 22;
          const ih = h - padT - padB;
          const x = (i: number) =>
            series.length < 2 ? w / 2 : (i / (series.length - 1)) * (w - 8) + 4;
          const y = (v: number) => padT + ih - (v / top) * ih;
          const path = (sums: number[]) =>
            sums.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join('');
          const labelEvery = Math.ceil(
            series.length / Math.max(2, Math.floor(w / AXIS_LABEL_WIDTH)),
          );
          const step = series.length < 2 ? w : (w - 8) / (series.length - 1);
          const hovered = active !== null ? Number(active) : null;
          const isDotted = (i: number) =>
            hovered === null
              ? series.length <= 14 || i === series.length - 1
              : i === hovered;
          return (
            <>
              <defs>
                {lines.map((l) => (
                  <linearGradient
                    key={l.id}
                    id={`usage-fade-${l.id}`}
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop offset="0" stopColor={l.color} stopOpacity={0.28} />
                    <stop offset="1" stopColor={l.color} stopOpacity={0} />
                  </linearGradient>
                ))}
              </defs>
              {[0, top / 2, top].map((v) => (
                <g key={v}>
                  <line
                    x1={0}
                    x2={w}
                    y1={y(v)}
                    y2={y(v)}
                    stroke={v ? 'var(--chart-grid)' : 'var(--chart-axis)'}
                  />
                  {v > 0 && (
                    <text
                      x={w}
                      y={y(v) - 6}
                      textAnchor="end"
                      className="type-caption tabular"
                      fill="var(--subtle-foreground)"
                    >
                      {usd(v)}
                    </text>
                  )}
                </g>
              ))}
              {hovered !== null && (
                <line
                  x1={x(hovered)}
                  x2={x(hovered)}
                  y1={padT}
                  y2={y(0)}
                  stroke="var(--chart-axis)"
                />
              )}
              {lines.map((l) => (
                <g key={l.id}>
                  {series.length > 0 && (
                    <path
                      d={`${path(l.sums)}L${x(series.length - 1)},${y(0)}L${x(0)},${y(0)}Z`}
                      fill={`url(#usage-fade-${l.id})`}
                    />
                  )}
                  <path
                    d={path(l.sums)}
                    fill="none"
                    stroke={l.color}
                    strokeWidth={2}
                    strokeLinejoin="round"
                  />
                  {l.sums.map(
                    (v, i) =>
                      isDotted(i) && (
                        <circle
                          key={i}
                          cx={x(i)}
                          cy={y(v)}
                          r={i === hovered || i === series.length - 1 ? 4.5 : 3}
                          fill={l.color}
                          stroke="var(--background)"
                          strokeWidth={2}
                        />
                      ),
                  )}
                </g>
              ))}
              {series.map((p, i) =>
                (i % labelEvery === 0 &&
                  series.length - 1 - i >= labelEvery / 2) ||
                i === series.length - 1 ? (
                  <text
                    key={p.key}
                    x={x(i)}
                    y={h - 4}
                    textAnchor={
                      i === 0
                        ? 'start'
                        : i === series.length - 1
                          ? 'end'
                          : 'middle'
                    }
                    className="type-caption tabular"
                    fill="var(--subtle-foreground)"
                  >
                    {axisLabel(p.key, series.length)}
                  </text>
                ) : null,
              )}
              {series.map((p, i) => (
                <rect
                  key={p.key}
                  x={x(i) - step / 2}
                  y={0}
                  width={step}
                  height={h}
                  fill="transparent"
                  onPointerEnter={() =>
                    show({
                      id: String(i),
                      x: x(i),
                      y: y(Math.max(claude[i], codex[i])),
                      title: periodName(p.key, isWeekly),
                      rows: [
                        {
                          label: 'Claude Code',
                          value: usd(p.cost.claude, 2),
                          color: CLAUDE,
                        },
                        {
                          label: 'Codex',
                          value: usd(p.cost.codex, 2),
                          color: CODEX,
                        },
                        {
                          label: 'So far',
                          value: usd(claude[i] + codex[i], 2),
                        },
                      ],
                    })
                  }
                />
              ))}
            </>
          );
        }}
      </Measured>
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <i className="size-2 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}

/** Commits by weekday and hour in square cells, with hour totals above and weekday totals on the right. */
export function CommitHeatmap({
  heatmap,
  className,
}: {
  heatmap: UsageView['heatmap'];
  className?: string;
}) {
  return (
    <Measured
      className={className}
      heightFor={(w) => HEAT.topH + 7 * heatCell(w) + HEAT.axisH}
    >
      {({ w }, { show, active }) => {
        const { labelW, sideW, topH, gap } = HEAT;
        const cell = heatCell(w);
        const max = Math.max(1, ...heatmap.flat());
        const hours = Array.from({ length: 24 }, (_, hour) =>
          heatmap.reduce((s, row) => s + row[hour], 0),
        );
        const hourMax = Math.max(1, ...hours);
        const peakHour = hours.indexOf(hourMax);
        const days = heatmap.map((row) => row.reduce((s, v) => s + v, 0));
        const dayMax = Math.max(1, ...days);
        const gridBottom = topH + 7 * cell;
        const cellX = (hour: number) => labelW + hour * cell + gap / 2;
        const hourSpan = (hour: number) =>
          `${hourLabel(hour)} – ${hourLabel((hour + 1) % 24)}`;
        const commits = (n: number) => [
          { label: 'Commits', value: n.toLocaleString('en-US') },
        ];
        return (
          <>
            {hours.map((v, hour) => {
              const bh = (v / hourMax) * (topH - 8);
              const id = `hour-${hour}`;
              return (
                <g key={hour}>
                  {v > 0 && (
                    <rect
                      x={cellX(hour)}
                      y={topH - 6 - bh}
                      width={cell - gap}
                      height={bh}
                      rx={Math.min(BAR_RADIUS, bh / 2)}
                      fill="var(--foreground)"
                      fillOpacity={
                        hour === peakHour || active === id ? 0.9 : 0.32
                      }
                    />
                  )}
                  <rect
                    x={labelW + hour * cell}
                    y={0}
                    width={cell}
                    height={topH - 4}
                    fill="transparent"
                    onPointerEnter={() =>
                      show({
                        id,
                        x: cellX(hour) + (cell - gap) / 2,
                        y: topH - 6 - bh,
                        title: `${hourSpan(hour)}, every day`,
                        rows: commits(v),
                      })
                    }
                  />
                </g>
              );
            })}
            {hours[peakHour] > 0 && active === null && (
              <text
                x={labelW + (peakHour + 1) * cell + 6}
                y={12}
                className="type-caption tabular font-semibold"
                fill="var(--foreground)"
              >
                {hourLabel(peakHour)}, {hours[peakHour]} commits
              </text>
            )}
            {heatmap.map((row, r) => {
              const y = topH + r * cell;
              const barW = (days[r] / dayMax) * (sideW - 34);
              const dayId = `day-${r}`;
              return (
                <g key={r}>
                  <text
                    x={0}
                    y={y + cell / 2 + 4}
                    className="type-caption"
                    fill="var(--subtle-foreground)"
                  >
                    {WEEKDAYS[r]}
                  </text>
                  {row.map((v, hour) => {
                    const id = `${r}-${hour}`;
                    return (
                      <rect
                        key={hour}
                        x={cellX(hour)}
                        y={y + gap / 2}
                        width={cell - gap}
                        height={cell - gap}
                        rx={4}
                        fill="var(--foreground)"
                        fillOpacity={
                          v ? 0.16 + 0.84 * Math.sqrt(v / max) : 0.045
                        }
                        stroke={active === id ? 'var(--foreground)' : 'none'}
                        strokeWidth={1.5}
                        onPointerEnter={() =>
                          show({
                            id,
                            x: cellX(hour) + (cell - gap) / 2,
                            y: y + gap / 2,
                            title: `${WEEKDAY_NAMES[r]}, ${hourSpan(hour)}`,
                            rows: commits(v),
                          })
                        }
                      />
                    );
                  })}
                  {days[r] > 0 && (
                    <rect
                      x={w - sideW + 10}
                      y={y + cell / 2 - 4}
                      width={Math.max(barW, 2)}
                      height={8}
                      rx={4}
                      fill="var(--foreground)"
                      fillOpacity={
                        days[r] === dayMax || active === dayId ? 0.9 : 0.32
                      }
                    />
                  )}
                  <text
                    x={w}
                    y={y + cell / 2 + 4}
                    textAnchor="end"
                    className="type-caption tabular"
                    fill="var(--subtle-foreground)"
                  >
                    {days[r]}
                  </text>
                  <rect
                    x={w - sideW + 4}
                    y={y}
                    width={sideW - 4}
                    height={cell}
                    fill="transparent"
                    onPointerEnter={() =>
                      show({
                        id: dayId,
                        x: w - sideW / 2,
                        y,
                        title: `${WEEKDAY_NAMES[r]}s`,
                        rows: commits(days[r]),
                      })
                    }
                  />
                </g>
              );
            })}
            {HOUR_TICKS.map((hour) => (
              <text
                key={hour}
                x={cellX(hour)}
                y={gridBottom + 16}
                className="type-caption"
                fill="var(--subtle-foreground)"
              >
                {hourLabel(hour)}
              </text>
            ))}
          </>
        );
      }}
    </Measured>
  );
}

const HEAT = { labelW: 36, sideW: 64, topH: 44, axisH: 22, gap: 3 };
/** Cells are square, so the heatmap's height follows its width. */
const heatCell = (width: number) => (width - HEAT.labelW - HEAT.sideW) / 24;

const FLOW_PARTS = [
  { key: 'cacheRead', label: 'Cache reads', color: 'var(--color-chart-3)' },
  { key: 'cacheWrite', label: 'Cache writes', color: 'var(--color-chart-4)' },
  { key: 'output', label: 'Model output', color: 'var(--color-chart-5)' },
  { key: 'input', label: 'Fresh input', color: 'var(--muted-foreground)' },
] satisfies {
  key: keyof UsageView['costByType'];
  label: string;
  color: string;
}[];

/** Token counts on top, what they cost below, curved ribbons joining each kind: how cheap reads outweigh costly writes. */
export function TokenCostFlow({
  tokens,
  costByType,
  className,
}: {
  tokens: UsageView['tokens'];
  costByType: UsageView['costByType'];
  className?: string;
}) {
  const parts = FLOW_PARTS.filter(
    (p) => tokens[p.key] > 0 || costByType[p.key] > 0,
  );
  return (
    <Measured className={cn('h-[104px]', className)}>
      {({ w, h }, { show, active }) => {
        const labelW = 56;
        const gap = 3;
        const barH = 12;
        const yTop = 22;
        const yBot = h - 40;
        const iw = w - labelW;
        const tokenTotal = parts.reduce((s, p) => s + tokens[p.key], 0) || 1;
        const costTotal = parts.reduce((s, p) => s + costByType[p.key], 0) || 1;
        const tw = widths(
          parts.map((p) => tokens[p.key]),
          iw,
          gap,
        );
        const cw = widths(
          parts.map((p) => costByType[p.key]),
          iw,
          gap,
        );
        const mid = (yTop + barH + yBot) / 2;
        let tx = labelW;
        let cx = labelW;
        const first = parts[0];
        return (
          <>
            <text
              x={0}
              y={yTop + 10}
              className="type-caption"
              fill="var(--subtle-foreground)"
            >
              Tokens
            </text>
            <text
              x={0}
              y={yBot + 10}
              className="type-caption"
              fill="var(--subtle-foreground)"
            >
              Cost
            </text>
            {!!first && (
              <text
                x={labelW}
                y={yTop - 8}
                className="type-caption tabular font-semibold"
                fill="var(--foreground)"
              >
                {first.label}, {pct(tokens[first.key] / tokenTotal)} of tokens
              </text>
            )}
            {parts.map((p, i) => {
              const a = tx;
              const b = cx;
              tx += tw[i] + gap;
              cx += cw[i] + gap;
              const ribbon = `M${a},${yTop + barH} L${a + tw[i]},${yTop + barH} C${a + tw[i]},${mid} ${b + cw[i]},${mid} ${b + cw[i]},${yBot} L${b},${yBot} C${b},${mid} ${a},${mid} ${a},${yTop + barH} Z`;
              const describe = () =>
                show({
                  id: p.key,
                  x: b + cw[i] / 2,
                  y: yBot,
                  title: p.label,
                  rows: [
                    {
                      label: 'Tokens',
                      value: `${compact(tokens[p.key])}, ${pct(tokens[p.key] / tokenTotal)}`,
                    },
                    {
                      label: 'Cost',
                      value: `${usd(costByType[p.key], 2)}, ${pct(costByType[p.key] / costTotal)}`,
                    },
                  ],
                });
              return (
                <g
                  key={p.key}
                  opacity={active !== null && active !== p.key ? 0.35 : 1}
                  onPointerEnter={describe}
                >
                  <path
                    d={ribbon}
                    fill={p.color}
                    fillOpacity={active === p.key ? 0.28 : 0.14}
                  />
                  <rect
                    x={a}
                    y={yTop}
                    width={tw[i]}
                    height={barH}
                    rx={4}
                    fill={p.color}
                  />
                  <rect
                    x={b}
                    y={yBot}
                    width={cw[i]}
                    height={barH}
                    rx={4}
                    fill={p.color}
                  />
                  {cw[i] > 64 && (
                    <>
                      <text
                        x={b}
                        y={yBot + barH + 15}
                        className="type-caption"
                        fill="var(--subtle-foreground)"
                      >
                        {p.label}
                      </text>
                      <text
                        x={b}
                        y={yBot + barH + 30}
                        className="type-caption tabular font-semibold"
                        fill="var(--foreground)"
                      >
                        {usd(costByType[p.key])} ·{' '}
                        {pct(costByType[p.key] / costTotal)}
                      </text>
                    </>
                  )}
                </g>
              );
            })}
          </>
        );
      }}
    </Measured>
  );
}

/** Segment widths filling `total` minus the gaps, every segment at least 6px so a sliver still shows. */
function widths(values: number[], total: number, gap: number) {
  const sum = values.reduce((s, v) => s + v, 0) || 1;
  const room = total - gap * (values.length - 1);
  const raw = values.map((v) => (v / sum) * room);
  const floored = raw.map((v) => Math.max(v, 6));
  const extra = floored.reduce((s, v) => s + v, 0) - room;
  const widest = floored.indexOf(Math.max(...floored));
  return floored.map((v, i) => (i === widest ? v - extra : v));
}

function niceCeiling(v: number) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return (
    ([1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((m) => m * p >= v) ?? 10) * p
  );
}

const pct = (share: number) =>
  `${share >= 0.9 || share < 0.1 ? (share * 100).toFixed(1) : Math.round(share * 100)}%`;

function hourLabel(hour: number) {
  return new Date(2026, 0, 1, hour)
    .toLocaleTimeString('en-US', { hour: 'numeric' })
    .replace(' ', '')
    .toLowerCase();
}

function axisLabel(key: string, count: number) {
  const d = new Date(`${key}T12:00:00`);
  return count <= 7
    ? d.toLocaleDateString('en-US', { weekday: 'short' })
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
