import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { cn } from '@/lib/utils';
import type { Thread } from '@/model';
import { ProviderMark } from '@/ui';

const PAGE_W = 880;
const BARS = [38, 44, 41, 52, 49, 61, 58, 66, 63, 72, 70, 81, 78, 88];
const KEYS = [
  { name: 'acme-prod', plan: 'Enterprise', calls: '1.92M' },
  { name: 'globex-staging', plan: 'Pro', calls: '412K' },
  { name: 'initech-ci', plan: 'Free', calls: '58K' },
];
const CURSOR_STOPS = [
  { x: 62, y: 46, target: 'API usage chart' },
  { x: 84, y: 22, target: 'Export CSV button' },
  { x: 30, y: 80, target: 'Keys table' },
  { x: 20, y: 22, target: 'Date range filter' },
];

/** The web build's stand-in for a fixture dev server: a fake admin page with an agent cursor and pickable regions. */
export function DemoPage({
  thread,
  width,
  height,
  isDriving,
  isPicking,
  onPick,
}: {
  thread: Thread;
  width: number;
  height: number;
  isDriving: boolean;
  isPicking: boolean;
  onPick: (target: string) => void;
}) {
  const scale = width / PAGE_W;
  const [hovered, setHovered] = useState<string | null>(null);

  const pick = (e: React.MouseEvent) => {
    if (!isPicking) return;
    const target = (e.target as HTMLElement).closest<HTMLElement>(
      '[data-annotate]',
    )?.dataset.annotate;
    if (target) onPick(target);
  };

  return (
    <div className="relative h-full overflow-hidden" onClick={pick}>
      <div
        className={cn(
          'web-page origin-top-left',
          isPicking && 'cursor-crosshair',
        )}
        style={{
          width: PAGE_W,
          height: height / scale,
          transform: `scale(${scale})`,
        }}
        onPointerOver={(e) =>
          isPicking &&
          setHovered(
            (e.target as HTMLElement).closest<HTMLElement>('[data-annotate]')
              ?.dataset.annotate ?? null,
          )
        }
        onPointerLeave={() => setHovered(null)}
      >
        <FakeUsagePage highlighted={isPicking ? hovered : null} />
      </div>
      {isDriving && !isPicking && (
        <AgentCursor provider={thread.providers[0]} />
      )}
    </div>
  );
}

function FakeUsagePage({ highlighted }: { highlighted: string | null }) {
  const outline = (name: string) =>
    highlighted === name
      ? {
          outline: '2px solid var(--page-bar)',
          outlineOffset: 4,
          borderRadius: 6,
        }
      : undefined;
  return (
    <div className="flex h-full flex-col">
      <div
        className="flex h-14 items-center gap-6 border-b px-8 text-[15px]"
        style={{ borderColor: 'var(--page-line)' }}
      >
        <span className="font-semibold">Latitude Admin</span>
        <span style={{ color: 'var(--page-muted)' }}>Customers</span>
        <span className="font-medium">Usage</span>
        <span style={{ color: 'var(--page-muted)' }}>Billing</span>
      </div>
      <div className="flex flex-col gap-6 px-8 py-7">
        <div className="flex items-center gap-3">
          <h1 className="text-[26px] font-semibold tracking-tight">
            API usage
          </h1>
          <span className="flex-1" />
          <span
            data-annotate="Date range filter"
            className="rounded-md border px-3 py-1.5 text-[14px]"
            style={{
              ...outline('Date range filter'),
              borderColor: 'var(--page-line)',
            }}
          >
            Last 14 days
          </span>
          <span
            data-annotate="Export CSV button"
            className="rounded-md px-3 py-1.5 text-[14px] font-medium text-white"
            style={{
              ...outline('Export CSV button'),
              background: 'var(--page-fg)',
            }}
          >
            Export CSV
          </span>
        </div>
        <div
          data-annotate="API usage chart"
          className="flex h-44 items-end gap-2 rounded-lg border p-4"
          style={{
            ...outline('API usage chart'),
            borderColor: 'var(--page-line)',
            background: 'var(--page-panel)',
          }}
        >
          {BARS.map((b, i) => (
            <span
              key={i}
              className="flex-1 rounded-t-[3px]"
              style={{
                height: `${b}%`,
                background: 'var(--page-bar)',
                opacity: 0.55 + i * 0.03,
              }}
            />
          ))}
        </div>
        <div
          data-annotate="Keys table"
          className="rounded-lg border text-[14px]"
          style={{
            ...outline('Keys table'),
            borderColor: 'var(--page-line)',
            background: 'var(--page-panel)',
          }}
        >
          {KEYS.map((k, i) => (
            <div
              key={k.name}
              className={cn(
                'flex items-center gap-4 px-4 py-3',
                i > 0 && 'border-t',
              )}
              style={{ borderColor: 'var(--page-line)' }}
            >
              <span className="flex-1 font-medium">{k.name}</span>
              <span style={{ color: 'var(--page-muted)' }}>{k.plan}</span>
              <span className="w-20 text-right tabular-nums">{k.calls}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function AgentCursor({ provider }: { provider: Thread['providers'][number] }) {
  const [stop, setStop] = useState(0);
  useEffect(() => {
    const id = setInterval(
      () => setStop((s) => (s + 1) % CURSOR_STOPS.length),
      2400,
    );
    return () => clearInterval(id);
  }, []);
  const target = CURSOR_STOPS[stop];

  return (
    <motion.div
      aria-hidden
      className="pointer-events-none absolute z-10"
      initial={false}
      animate={{ left: `${target.x}%`, top: `${target.y}%` }}
      transition={{ type: 'spring', stiffness: 120, damping: 20 }}
    >
      <motion.span
        key={stop}
        className="absolute -top-3 -left-3 size-6 rounded-full"
        style={{ background: 'var(--page-bar)' }}
        initial={{ scale: 0.3, opacity: 0 }}
        animate={{ scale: [0.3, 1.6], opacity: [0, 0.35, 0] }}
        transition={{ delay: 0.9, duration: 0.6 }}
      />
      <svg width="16" height="18" viewBox="0 0 16 18" className="drop-shadow">
        <path
          d="M1 1l13 7.5-6 1.2-3 6.3z"
          fill="var(--page-fg)"
          stroke="white"
          strokeWidth="1.2"
          strokeLinejoin="round"
        />
      </svg>
      <span
        className="mt-0.5 ml-3 flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap text-white"
        style={{ background: 'var(--page-fg)' }}
      >
        <ProviderMark provider={provider} size={11} />
        {target.target}
      </span>
    </motion.div>
  );
}
