import { useState } from 'react';
import type { Thread } from './model';
import { burnSeries, clock, progressAt, type Progress } from './progress';
import { lineColor } from './ui';

export interface TimeScale {
  t0: number;
  t1: number;
  width: number;
  x: (t: number) => number;
  t: (x: number) => number;
}

export function timeScale(t0: number, t1: number, width: number): TimeScale {
  const span = Math.max(1, t1 - t0);
  return {
    t0,
    t1,
    width,
    x: (t) => ((t - t0) / span) * width,
    t: (x) => Math.round(t0 + (Math.min(Math.max(x, 0), width) / width) * span),
  };
}

const H = 148;
const PAD = { top: 18, bottom: 22 };

export function BurnUp({
  thread,
  now,
  scale,
  live,
  projection,
  scrubAt,
  onScrub,
}: {
  thread: Thread;
  now: number;
  scale: TimeScale;
  live: Progress;
  projection: { t: number; value: number } | null;
  scrubAt: number | null;
  onScrub: (t: number | null) => void;
}) {
  const [hoverT, setHoverT] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const series = burnSeries(thread, now);
  const maxScope = Math.max(...series.map((p) => p.scope), live.scope, 1);
  const yMax = Math.ceil((maxScope * 1.15) / 4) * 4;
  const plotH = H - PAD.top - PAD.bottom;
  const y = (v: number) => PAD.top + plotH - (v / yMax) * plotH;
  const ticks = [0, yMax / 4, yMax / 2, (yMax * 3) / 4, yMax];
  const color = lineColor(thread.line);

  const step = (key: 'scope' | 'done') => series.map((p, i) => (i === 0 ? `M${scale.x(p.t)} ${y(p[key])}` : `H${scale.x(p.t)} V${y(p[key])}`)).join(' ');
  const livePoint = { x: scale.x(now), y: y(live.done + live.partial) };
  const doneArea = `${step('done')} H${livePoint.x} V${livePoint.y} V${y(0)} H${scale.x(series[0].t)} Z`;

  const ahead = projection && projection.t > now && { x2: scale.x(projection.t), y2: y(projection.value) };
  const xTicks = clockTicks(scale.t0, Math.max(now, scale.t1));
  const readT = scrubAt ?? hoverT;
  const readout = readT !== null && progressAt(thread, readT, readT >= now);

  const toT = (e: React.PointerEvent<SVGRectElement>) => scale.t(e.clientX - e.currentTarget.getBoundingClientRect().left);

  return (
    <div className="relative">
      <svg width={scale.width} height={H} className="block overflow-visible" role="img" aria-label={`Burn-up: ${live.done} of ${live.scope} points done`}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={0} x2={scale.width} y1={y(v)} y2={y(v)} stroke={v === 0 ? 'var(--chart-axis)' : 'var(--chart-grid)'} strokeWidth={1} />
            {v > 0 && (
              <text x={scale.width} y={y(v) - 4} textAnchor="end" className="tabular fill-subtle-foreground text-xs">
                {v}
              </text>
            )}
          </g>
        ))}
        {xTicks.map((t) => (
          <text key={t} x={scale.x(t)} y={H - 6} textAnchor="middle" className="tabular fill-subtle-foreground text-xs">
            {clock(t)}
          </text>
        ))}
        {thread.revisions
          .filter((r) => r.n > 1)
          .map((r) => (
            <g key={r.n}>
              <line x1={scale.x(r.at)} x2={scale.x(r.at)} y1={PAD.top - 4} y2={y(0)} stroke="var(--subtle-foreground)" strokeDasharray="2 3" strokeWidth={1} />
              <rect x={scale.x(r.at) - 11} y={0} width={22} height={15} rx={4} fill="var(--muted)" stroke="var(--border)" />
              <text x={scale.x(r.at)} y={11} textAnchor="middle" className="fill-muted-foreground text-[10px] font-semibold">
                v{r.n}
              </text>
            </g>
          ))}
        <path d={doneArea} fill={color} fillOpacity={0.16} />
        <path d={`${step('done')} H${livePoint.x} V${livePoint.y}`} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />
        <path d={`${step('scope')} H${scale.x(now)}`} fill="none" stroke="var(--muted-foreground)" strokeWidth={2} strokeLinejoin="round" />
        {ahead && (
          <>
            <line x1={livePoint.x} y1={livePoint.y} x2={ahead.x2} y2={ahead.y2} stroke={color} strokeWidth={2} strokeDasharray="4 4" />
            <line x1={scale.x(now)} y1={y(live.scope)} x2={ahead.x2} y2={y(live.scope)} stroke="var(--muted-foreground)" strokeWidth={2} strokeDasharray="4 4" />
          </>
        )}
        <circle cx={livePoint.x} cy={livePoint.y} r={4.5} fill={color} stroke="var(--background)" strokeWidth={2} />
        {readT !== null && <line x1={scale.x(readT)} x2={scale.x(readT)} y1={PAD.top - 4} y2={y(0)} stroke="var(--foreground)" strokeWidth={scrubAt !== null ? 1.5 : 1} strokeOpacity={scrubAt !== null ? 1 : 0.4} />}
        <rect
          x={0}
          y={0}
          width={scale.width}
          height={H}
          fill="transparent"
          className="cursor-crosshair touch-none"
          onPointerMove={(e) => {
            const t = Math.min(toT(e), now);
            setHoverT(t);
            if (dragging) onScrub(t >= now ? null : t);
          }}
          onPointerLeave={() => setHoverT(null)}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            setDragging(true);
            const t = Math.min(toT(e), now);
            onScrub(t >= now ? null : t);
          }}
          onPointerUp={() => setDragging(false)}
        />
      </svg>
      {readout && readT !== null && (
        <div
          role="status"
          className="pointer-events-none absolute top-5 z-10 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs shadow-[var(--elev-popover)]"
          style={{ left: Math.min(Math.max(scale.x(readT) + 10, 0), scale.width - 150) }}
        >
          <div className="tabular font-semibold text-foreground">{clock(readT)}{scrubAt !== null && ' · scrubbing'}</div>
          <div className="tabular text-muted-foreground">
            {Math.round(readout.pct * 100)}% · {readout.done} of {readout.scope} pts
          </div>
        </div>
      )}
    </div>
  );
}

function clockTicks(t0: number, t1: number) {
  const span = t1 - t0;
  const every = span > 360 ? 120 : span > 180 ? 60 : 30;
  const first = Math.ceil(t0 / every) * every;
  const out: number[] = [];
  for (let t = first; t <= t1 - every / 3; t += every) out.push(t);
  return out;
}
