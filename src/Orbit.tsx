import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Clock, Hierarchy3, Inbox, MessageQuestion as MessageCircleQuestion, Route, Setting2, ShieldCheck, Edit as SquarePen, type IconComponent as LucideIcon } from 'reicon-react';
import { singleChoice, type QueueItem, type QueueKind, type Thread } from './model';
import { progressAt } from './progress';
import { useHarness, useSpaceQueue, useSpaceThreads, type View } from './store';
import { Kbd } from '@/components/ui/kbd';
import { GitPullRequestIcon } from '@/icons/github';
import { cn } from '@/lib/utils';
import { ProviderMark, ProgressRing, lineColor } from './ui';
import { isWorking } from './agentPhase';

const R_IN = 92;
const R_OUT = 188;
const DEAD_ZONE = 34;
const OPEN_DELAY = 140;
const LONG_PRESS = 380;
const PEEK_DELAY = 220;
const SLOT_ANGLES = [-90, -45, 0, 45, 90, 135, 180, -135];

type OrbitItem =
  | { key: string; ring: 'inner'; angle: number; item: QueueItem; thread: Thread }
  | { key: string; ring: 'outer'; angle: number; label: string; view: View; thread?: Thread; icon?: LucideIcon };

const QUEUE_ICONS = {
  approval: ShieldCheck,
  question: MessageCircleQuestion,
  review: GitPullRequestIcon,
  ci: GitPullRequestIcon,
  overlap: Hierarchy3,
  run: Clock,
  setting: Setting2,
} satisfies Record<QueueKind, LucideIcon>;

export function Orbit() {
  const { state, dispatch } = useHarness();
  const items = useOrbitItems();
  const [center, setCenter] = useState<{ x: number; y: number; k: number } | null>(null);
  const [pointer, setPointer] = useState({ x: 0, y: 0 });
  const [peekKey, setPeekKey] = useState<string | null>(null);
  const selected = center ? pick(items, pointer.x - center.x, pointer.y - center.y, center.k) : null;
  const latest = useRef({ center, selected, items });
  latest.current = { center, selected, items };

  const answered = useRef(false);

  const commit = () => {
    const { selected } = latest.current;
    setCenter(null);
    if (!selected || answered.current) return;
    if (selected.ring === 'outer') dispatch({ type: 'go', view: selected.view });
    else dispatch({ type: 'go', view: selected.item.kind === 'review' ? { kind: 'thread', id: selected.thread.id } : { kind: 'queue' } });
  };

  const answerInPlace = (digit: number) => {
    const { selected } = latest.current;
    if (selected?.ring !== 'inner') return false;
    const item = selected.item;
    answered.current = true;
    if (item.kind === 'overlap') {
      const mode = (['link', 'extract', 'race', 'related'] as const)[digit - 1];
      if (mode) dispatch({ type: 'overlap', queueId: item.id, mode });
      return true;
    }
    if (item.kind === 'question') {
      const options = singleChoice(item);
      if (!options) return (answered.current = false);
      if (options[digit - 1]) dispatch({ type: 'answer', queueId: item.id, answers: [[options[digit - 1]]] });
      return true;
    }
    if (digit === 1) dispatch({ type: 'answer', queueId: item.id });
    return true;
  };

  useOrbitTriggers({
    isOpen: center !== null,
    open: (x, y) => {
      answered.current = false;
      const k = Math.min(1, (Math.min(window.innerWidth, window.innerHeight) / 2 - 56) / (R_OUT + 40));
      const margin = (R_OUT + 40) * k;
      setCenter({ x: clamp(x, margin, window.innerWidth - margin), y: clamp(y, margin, window.innerHeight - margin), k });
      setPointer({ x, y });
      window.getSelection()?.removeAllRanges();
    },
    move: (x, y) => setPointer({ x, y }),
    commit,
    cancel: () => setCenter(null),
    digit: answerInPlace,
  });

  const selectedKey = selected?.key ?? null;
  useEffect(() => {
    setPeekKey(null);
    if (!selectedKey) return;
    const id = setTimeout(() => setPeekKey(selectedKey), PEEK_DELAY);
    return () => clearTimeout(id);
  }, [selectedKey]);

  return (
    <AnimatePresence>
      {center && (
        <motion.div
          key="orbit"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.1 }}
          className="fixed inset-0 z-[400] touch-none select-none"
          style={{ background: 'var(--scrim)' }}
          aria-hidden={false}
          role="dialog"
          aria-label="Orbit: move toward a destination and release"
        >
          <svg className="pointer-events-none absolute inset-0 h-full w-full">
            <circle cx={center.x} cy={center.y} r={R_IN * center.k} fill="none" stroke="var(--border)" strokeDasharray="2 6" />
            <circle cx={center.x} cy={center.y} r={R_OUT * center.k} fill="none" stroke="var(--border)" strokeDasharray="2 6" />
            <line x1={center.x} y1={center.y} x2={pointer.x} y2={pointer.y} stroke="var(--foreground)" strokeOpacity={selected ? 0.5 : 0.2} strokeWidth={1.5} />
          </svg>
          <div className="absolute flex size-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-background text-center text-xs leading-tight text-subtle-foreground shadow-[var(--elev-popover)]" style={{ left: center.x, top: center.y }}>
            {selected ? 'Go' : 'Cancel'}
          </div>
          {items.map((it, i) => (
            <OrbitNode key={it.key} item={it} center={center} isSelected={selected?.key === it.key} index={i} />
          ))}
          {selected && peekKey === selected.key && <Peek item={selected} center={center} now={state.now} />}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function useOrbitItems(): OrbitItem[] {
  const queue = useSpaceQueue();
  const threads = useSpaceThreads();
  const inner = queue.slice(0, 6).map((item, i, all) => ({
    key: `q-${item.id}`,
    ring: 'inner' as const,
    angle: -90 + (360 / Math.max(all.length, 1)) * i,
    item,
    thread: threads.find((t) => t.id === item.threadId)!,
  }));
  const fixed: OrbitItem[] = [
    { key: 'o-queue', ring: 'outer', angle: SLOT_ANGLES[0], label: 'Queue', view: { kind: 'queue' }, icon: Inbox },
    { key: 'o-board', ring: 'outer', angle: SLOT_ANGLES[4], label: 'Board', view: { kind: 'board' }, icon: Route },
    { key: 'o-new', ring: 'outer', angle: SLOT_ANGLES[6], label: 'New thread', view: { kind: 'new' }, icon: SquarePen },
  ];
  const pinned: OrbitItem[] = threads
    .filter((t) => t.orbitSlot !== undefined && t.status !== 'settled')
    .map((t) => ({ key: `o-${t.id}`, ring: 'outer', angle: SLOT_ANGLES[t.orbitSlot!], label: t.title, view: { kind: 'thread', id: t.id }, thread: t }));
  return [...inner, ...fixed, ...pinned];
}

function pick(items: OrbitItem[], dx: number, dy: number, k: number) {
  const dist = Math.hypot(dx, dy);
  if (dist < DEAD_ZONE * k) return null;
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  const inner = items.filter((i) => i.ring === 'inner');
  const ring = dist < ((R_IN + R_OUT) / 2) * k && inner.length > 0 ? inner : items.filter((i) => i.ring === 'outer');
  const tolerance = ring === inner ? 180 / Math.max(inner.length, 1) : 26;
  let best: OrbitItem | null = null;
  let bestDiff = tolerance;
  for (const it of ring) {
    const diff = Math.abs(((angle - it.angle + 540) % 360) - 180);
    if (diff <= bestDiff) {
      best = it;
      bestDiff = diff;
    }
  }
  return best;
}

function OrbitNode({ item, center, isSelected, index }: { item: OrbitItem; center: { x: number; y: number; k: number }; isSelected: boolean; index: number }) {
  const r = (item.ring === 'inner' ? R_IN : R_OUT) * center.k;
  const rad = (item.angle * Math.PI) / 180;
  const x = center.x + Math.cos(rad) * r;
  const y = center.y + Math.sin(rad) * r;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.92 }}
      animate={{ opacity: 1, scale: isSelected ? 1.08 : 1 }}
      transition={{ duration: 0.12, delay: index * 0.012, ease: [0.23, 1, 0.32, 1] }}
      className="absolute -translate-x-1/2 -translate-y-1/2"
      style={{ left: x, top: y }}
    >
      {item.ring === 'inner' ? <InnerNode item={item} isSelected={isSelected} /> : <OuterNode item={item} isSelected={isSelected} />}
    </motion.div>
  );
}

function InnerNode({ item, isSelected }: { item: Extract<OrbitItem, { ring: 'inner' }>; isSelected: boolean }) {
  const Icon = QUEUE_ICONS[item.item.kind];
  return (
    <div
      className={cn(
        'flex size-11 items-center justify-center rounded-full border-2 bg-background shadow-[var(--elev-popover)]',
        item.item.kind === 'overlap' ? 'text-warning' : 'text-foreground',
        isSelected ? 'border-foreground' : 'border-transparent',
      )}
      style={{ outline: `2px solid ${lineColor(item.thread.line)}`, outlineOffset: -6 }}
    >
      <Icon className="size-4" aria-label={item.item.title} />
    </div>
  );
}

function OuterNode({ item, isSelected }: { item: Extract<OrbitItem, { ring: 'outer' }>; isSelected: boolean }) {
  const Icon = item.icon;
  return (
    <div
      className={cn(
        'flex h-9 max-w-[150px] items-center gap-2 rounded-full border bg-background px-3 text-sm whitespace-nowrap shadow-[var(--elev-popover)]',
        isSelected ? 'border-foreground text-foreground' : 'border-border text-muted-foreground',
      )}
    >
      {Icon && <Icon className="size-4 shrink-0" />}
      {item.thread && <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: lineColor(item.thread.line) }} />}
      <span className="truncate">{item.label}</span>
    </div>
  );
}

function Peek({ item, center, now }: { item: OrbitItem; center: { x: number; y: number; k: number }; now: number }) {
  const rad = (item.angle * Math.PI) / 180;
  const r = (item.ring === 'inner' ? R_IN : R_OUT) * center.k + 40;
  const W = 260;
  const left = clamp(center.x + Math.cos(rad) * r - (Math.cos(rad) < -0.3 ? W : Math.cos(rad) > 0.3 ? 0 : W / 2), 8, window.innerWidth - W - 8);
  const top = clamp(center.y + Math.sin(rad) * r - (Math.sin(rad) < -0.3 ? 120 : Math.sin(rad) > 0.3 ? 0 : 50), 8, window.innerHeight - 180);

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.12 }}
      className="absolute flex flex-col gap-2 rounded-xl border border-border bg-background p-3 text-sm shadow-[var(--elev-popover)]"
      style={{ left, top, width: W }}
    >
      {item.ring === 'inner' ? <QueuePeek item={item.item} thread={item.thread} /> : item.thread ? <ThreadPeek thread={item.thread} now={now} /> : <span className="text-muted-foreground">Go to {item.label}</span>}
    </motion.div>
  );
}

function QueuePeek({ item, thread }: { item: QueueItem; thread: Thread }) {
  const choices = item.kind === 'overlap' ? ['Link', 'Extract', 'Race', 'Keep both'] : item.kind === 'question' ? (singleChoice(item) ?? []) : [item.kind === 'review' ? 'Approve and merge' : 'Approve'];
  return (
    <>
      <PeekHeader thread={thread} />
      <div className="font-medium text-foreground">{item.title}</div>
      <ul className="flex flex-col gap-1">
        {choices.map((c, i) => (
          <li key={c} className="flex items-center gap-2 text-muted-foreground">
            <Kbd>{i + 1}</Kbd>
            {c}
          </li>
        ))}
      </ul>
      <div className="text-xs text-subtle-foreground">{choices.length ? 'Press a number to answer without leaving this screen' : 'Open the queue to answer'}</div>
    </>
  );
}

function ThreadPeek({ thread, now }: { thread: Thread; now: number }) {
  const { pct } = progressAt(thread, now, true);
  const running = thread.steps.find((s) => s.status === 'running');
  const last = thread.activity[thread.activity.length - 1];
  return (
    <>
      <PeekHeader thread={thread} />
      <div className="flex items-center gap-2">
        <ProgressRing pct={pct} slot={thread.line} size={18} isWorking={isWorking(thread)} />
        <span className="tabular font-medium text-foreground">{Math.round(pct * 100)}%</span>
        <span className="truncate text-muted-foreground">{running ? running.title : 'Nothing running'}</span>
      </div>
      {last && <div className="line-clamp-2 text-xs text-subtle-foreground">{last.text}</div>}
    </>
  );
}

function PeekHeader({ thread }: { thread: Thread }): ReactNode {
  return (
    <div className="flex items-center gap-1.5 text-xs text-subtle-foreground">
      <span aria-hidden className="size-2 rounded-full" style={{ background: lineColor(thread.line) }} />
      <span className="truncate">{thread.title}</span>
      <ProviderMark provider={thread.providers[0]} size={12} />
    </div>
  );
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(Math.max(v, lo), Math.max(lo, hi));
}

// `data-no-orbit`: surfaces where holding the pointer still is part of the gesture (drawing on a screenshot).
function isInteractive(target: EventTarget | null) {
  return target instanceof Element && !!target.closest('button, a, input, textarea, select, [role="button"], [role="radio"], [role="slider"], [data-no-orbit], pre, code, p, h1, h2');
}

function useOrbitTriggers(handlers: {
  isOpen: boolean;
  open: (x: number, y: number) => void;
  move: (x: number, y: number) => void;
  commit: () => void;
  cancel: () => void;
  digit: (n: number) => boolean;
}) {
  const h = useRef(handlers);
  h.current = handlers;

  useEffect(() => {
    const last = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    let altTimer: ReturnType<typeof setTimeout> | undefined;
    let pressTimer: ReturnType<typeof setTimeout> | undefined;
    let press: { x: number; y: number } | null = null;
    let via: 'alt' | 'pointer' | null = null;

    const onPointerMove = (e: PointerEvent) => {
      last.x = e.clientX;
      last.y = e.clientY;
      if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 8) {
        clearTimeout(pressTimer);
        press = null;
      }
      if (h.current.isOpen) h.current.move(e.clientX, e.clientY);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && h.current.isOpen) {
        via = null;
        h.current.cancel();
        return;
      }
      if (e.key === 'Alt') {
        if (e.repeat || h.current.isOpen) return;
        altTimer = setTimeout(() => {
          via = 'alt';
          h.current.open(last.x, last.y);
        }, OPEN_DELAY);
        return;
      }
      clearTimeout(altTimer);
      const digit = /^Digit([1-4])$/.exec(e.code);
      if (h.current.isOpen && digit && h.current.digit(Number(digit[1]))) e.preventDefault();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key !== 'Alt') return;
      clearTimeout(altTimer);
      if (via === 'alt' && h.current.isOpen) h.current.commit();
      via = null;
    };
    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0 || isInteractive(e.target)) return;
      press = { x: e.clientX, y: e.clientY };
      pressTimer = setTimeout(() => {
        press = null;
        via = 'pointer';
        h.current.open(last.x, last.y);
      }, LONG_PRESS);
    };
    const onPointerUp = () => {
      clearTimeout(pressTimer);
      press = null;
      if (via === 'pointer' && h.current.isOpen) h.current.commit();
      if (via === 'pointer') via = null;
    };
    const onPointerCancel = () => {
      clearTimeout(pressTimer);
      press = null;
      if (via !== 'pointer') return;
      via = null;
      h.current.cancel();
    };
    const onBlur = () => {
      clearTimeout(altTimer);
      clearTimeout(pressTimer);
      via = null;
      h.current.cancel();
    };
    const onTouchMove = (e: TouchEvent) => {
      if (h.current.isOpen) e.preventDefault();
    };
    const onContextMenu = (e: MouseEvent) => {
      if (h.current.isOpen || via === 'pointer') e.preventDefault();
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
    window.addEventListener('blur', onBlur);
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('contextmenu', onContextMenu);
    return () => {
      clearTimeout(altTimer);
      clearTimeout(pressTimer);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('contextmenu', onContextMenu);
    };
  }, []);
}
