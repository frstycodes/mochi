import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { flushSync } from 'react-dom';
import { animate, motion, useDragControls, useMotionValue, type PanInfo } from 'motion/react';
import { ArrowLeft, ArrowRight, ChevronLeft, ChevronRight, CommentPlus, ExitPip, More, Pip, Refresh, X } from 'reicon-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { PaneTab, Thread } from './model';
import { useHarness } from './store';
import { ProviderMark } from './ui';

type Corner = 'tl' | 'tr' | 'bl' | 'br';

const PAGE_W = 880;
const PIP = { w: 360, h: 520 };
const MIN = { w: 240, h: 200 };
const SNAP = { type: 'spring', stiffness: 420, damping: 36 } as const;
const VELOCITY_PROJECTION = 0.12;
const TUCK_TAB = 28;
// Matches the layer's inset-3: the clip sits 12px outside the snap bounds.
const LAYER_INSET = 12;

export function BrowserView({ thread, tab, isDriving }: { thread: Thread; tab: PaneTab; isDriving: boolean }) {
  const { dispatch } = useHarness();
  const [isCommenting, setCommenting] = useState(false);
  const frameRef = useRef<HTMLDivElement>(null);
  const size = useSize(frameRef);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-1 px-2">
        <IconAction label="Back" disabled>
          <ArrowLeft />
        </IconAction>
        <IconAction label="Forward" disabled>
          <ArrowRight />
        </IconAction>
        <IconAction label="Reload" onClick={() => toast('Reloaded')}>
          <Refresh />
        </IconAction>
        <div className="mx-1 flex h-7 min-w-0 flex-1 items-center justify-center rounded-full bg-muted px-3">
          <span className="truncate type-caption text-muted-foreground">{tab.url}</span>
        </div>
        <IconAction label={isCommenting ? 'Stop commenting' : 'Comment on the page'} pressed={isCommenting} onClick={() => setCommenting((c) => !c)}>
          <CommentPlus />
        </IconAction>
        <IconAction label="Pop out into a floating window" onClick={() => dispatch({ type: 'pane-pop', threadId: thread.id, tabId: tab.id, isPopped: true })}>
          <Pip />
        </IconAction>
        <IconAction label="More" onClick={() => toast('Not in the prototype yet')}>
          <More />
        </IconAction>
      </div>
      <div ref={frameRef} className="relative mx-2 mb-2 min-h-0 flex-1 overflow-hidden rounded-xl ring-1 ring-border">
        {size.w > 0 && <PagePreview thread={thread} width={size.w} height={size.h} isDriving={isDriving && !isCommenting} isCommenting={isCommenting} onCommented={() => setCommenting(false)} />}
      </div>
    </div>
  );
}

function IconAction({ label, pressed, disabled, onClick, children }: { label: string; pressed?: boolean; disabled?: boolean; onClick?: () => void; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={label} aria-pressed={pressed} disabled={disabled} onPointerDown={(e) => e.stopPropagation()} onClick={onClick} className={cn(pressed && 'bg-accent text-foreground')}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function PipLayer({ thread }: { thread: Thread }) {
  const { state } = useHarness();
  const layerRef = useRef<HTMLDivElement>(null);
  const bounds = useSize(layerRef);
  const pane = state.panes.find((p) => p.threadId === thread.id);
  const popped = pane?.tabs.filter((t) => t.isPopped) ?? [];

  return (
    <div ref={layerRef} className="pointer-events-none absolute inset-3 isolate">
      {bounds.w > 0 && popped.map((tab) => <PipWindow key={tab.id} thread={thread} tab={tab} isDriving={pane?.driver === thread.providers[0] && thread.status === 'running'} bounds={bounds} />)}
    </div>
  );
}

function useSize(ref: RefObject<HTMLElement | null>) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

function anchorFor(corner: Corner, w: number, h: number, bounds: { w: number; h: number }) {
  return { x: corner[1] === 'r' ? bounds.w - w : 0, y: corner[0] === 'b' ? bounds.h - h : 0 };
}

function PipWindow({ thread, tab, isDriving, bounds }: { thread: Thread; tab: PaneTab; isDriving: boolean; bounds: { w: number; h: number } }) {
  const { dispatch } = useHarness();
  const [corner, setCorner] = useState<Corner>('br');
  const [size, setSize] = useState(PIP);
  const [isTucked, setTucked] = useState(false);
  const [isCommenting, setCommenting] = useState(false);
  const controls = useDragControls();
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const w = Math.min(size.w, bounds.w);
  const h = Math.min(size.h, bounds.h);
  const anchor = anchorFor(corner, w, h, bounds);
  const tuckSide = corner[1] === 'r' ? 1 : -1;
  const tuckOffset = isTucked ? tuckSide * (w - TUCK_TAB + LAYER_INSET) : 0;

  useEffect(() => {
    animate(x, tuckOffset, SNAP);
    if (isTucked) animate(y, 0, SNAP);
  }, [tuckOffset, isTucked, x, y]);

  const onDragEnd = (_: unknown, info: PanInfo) => {
    const cx = anchor.x + x.get() + info.velocity.x * VELOCITY_PROJECTION + w / 2;
    const cy = anchor.y + y.get() + info.velocity.y * VELOCITY_PROJECTION + h / 2;
    const next = `${cy < bounds.h / 2 ? 't' : 'b'}${cx < bounds.w / 2 ? 'l' : 'r'}` as Corner;
    const tuck = cx < 0 || cx > bounds.w;
    const from = { x: anchor.x + x.get(), y: anchor.y + y.get() };
    const to = anchorFor(next, w, h, bounds);
    flushSync(() => setCorner(next));
    x.set(from.x - to.x);
    y.set(from.y - to.y);
    setTucked(tuck);
    if (tuck) return;
    animate(x, 0, { ...SNAP, velocity: info.velocity.x });
    animate(y, 0, { ...SNAP, velocity: info.velocity.y });
  };

  const startDrag = (e: ReactPointerEvent) => {
    if (isCommenting || isTucked) return;
    controls.start(e);
  };

  return (
    <motion.section
      aria-label={`Floating preview: ${tab.url}`}
      drag
      dragControls={controls}
      dragListener={false}
      dragMomentum={false}
      onDragEnd={onDragEnd}
      onPointerDown={startDrag}
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
      style={{ left: anchor.x, top: anchor.y, width: w, height: h, x, y }}
      className={cn('group/pip pointer-events-auto absolute rounded-2xl bg-background shadow-float', !isCommenting && !isTucked && 'cursor-grab active:cursor-grabbing')}
    >
      {/* Clip here, not on the section: Chromium drops a backdrop-filter's mask under a rounded overflow clip. */}
      <div inert={isTucked || undefined} className="h-full overflow-hidden rounded-[inherit]">
        <PagePreview thread={thread} width={w} height={h} isDriving={isDriving && !isCommenting} isCommenting={isCommenting} onCommented={() => setCommenting(false)} />
      </div>

      {!isTucked && (
        <div className="pointer-events-none absolute top-0 left-0 isolate flex h-20 w-44 items-start gap-1 rounded-tl-[inherit] p-3 opacity-0 transition-opacity duration-150 group-hover/pip:pointer-events-auto group-hover/pip:opacity-100 group-focus-within/pip:pointer-events-auto group-focus-within/pip:opacity-100">
          <span aria-hidden className="pip-blur absolute inset-0 -z-10 rounded-tl-[inherit]" />
          <PipButton label="Close preview" onClick={() => dispatch({ type: 'pane-close-tab', threadId: thread.id, tabId: tab.id })}>
            <X />
          </PipButton>
          <PipButton label="Put back in the side pane" onClick={() => dispatch({ type: 'pane-pop', threadId: thread.id, tabId: tab.id, isPopped: false })}>
            <ExitPip />
          </PipButton>
          <PipButton label={isCommenting ? 'Stop commenting' : 'Comment on the page'} pressed={isCommenting} onClick={() => setCommenting((c) => !c)}>
            <CommentPlus />
          </PipButton>
        </div>
      )}

      {isTucked && (
        <button
          type="button"
          aria-label="Show preview"
          onClick={() => setTucked(false)}
          className={cn('absolute inset-y-0 z-10 flex items-center justify-center bg-popover text-muted-foreground hover:text-foreground', tuckSide === 1 ? 'left-0 rounded-l-[inherit]' : 'right-0 rounded-r-[inherit]')}
          style={{ width: TUCK_TAB }}
        >
          {tuckSide === 1 ? <ChevronLeft className="size-4" /> : <ChevronRight className="size-4" />}
        </button>
      )}
      {!isTucked && <ResizeHandle corner={corner} start={{ w, h }} onResize={(nw, nh) => setSize({ w: clamp(nw, MIN.w, bounds.w), h: clamp(nh, MIN.h, bounds.h) })} />}
    </motion.section>
  );
}

function PipButton({ label, pressed, onClick, children }: { label: string; pressed?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={onClick}
      className={cn('flex size-8 cursor-default items-center justify-center rounded-full text-white/90 hover:bg-white/15 hover:text-white [&_svg]:size-5', pressed && 'bg-white/20')}
    >
      {children}
    </button>
  );
}

function ResizeHandle({ corner, start, onResize }: { corner: Corner; start: { w: number; h: number }; onResize: (w: number, h: number) => void }) {
  const sx = corner[1] === 'r' ? -1 : 1;
  const sy = corner[0] === 'b' ? -1 : 1;
  const origin = useRef<{ px: number; py: number; w: number; h: number } | null>(null);
  return (
    <span
      aria-hidden
      onPointerDown={(e) => {
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        origin.current = { px: e.clientX, py: e.clientY, w: start.w, h: start.h };
      }}
      onPointerMove={(e) => {
        const o = origin.current;
        if (o) onResize(o.w + sx * (e.clientX - o.px), o.h + sy * (e.clientY - o.py));
      }}
      onPointerUp={() => (origin.current = null)}
      className={cn('absolute size-5 touch-none', sx === -1 ? 'left-0' : 'right-0', sy === -1 ? 'top-0' : 'bottom-0', sx === sy ? 'cursor-nwse-resize' : 'cursor-nesw-resize')}
    />
  );
}

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

function PagePreview({ thread, width, height, isDriving, isCommenting, onCommented }: { thread: Thread; width: number; height: number; isDriving: boolean; isCommenting: boolean; onCommented: () => void }) {
  const scale = width / PAGE_W;
  const [hovered, setHovered] = useState<string | null>(null);
  const [pending, setPending] = useState<{ target: string; x: number; y: number } | null>(null);
  const frameRef = useRef<HTMLDivElement>(null);

  const pick = (e: React.MouseEvent) => {
    if (!isCommenting) return;
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-annotate]');
    const frame = frameRef.current?.getBoundingClientRect();
    if (!el || !frame) return;
    setPending({ target: el.dataset.annotate!, x: e.clientX - frame.left, y: e.clientY - frame.top });
  };

  return (
    <div ref={frameRef} className="relative h-full overflow-hidden" onClick={pick}>
      <div
        className={cn('web-page origin-top-left', isCommenting && 'cursor-crosshair')}
        style={{ width: PAGE_W, height: height / scale, transform: `scale(${scale})` }}
        onPointerOver={(e) => isCommenting && setHovered((e.target as HTMLElement).closest<HTMLElement>('[data-annotate]')?.dataset.annotate ?? null)}
        onPointerLeave={() => setHovered(null)}
      >
        <FakeUsagePage highlighted={isCommenting ? hovered : null} />
      </div>
      {isDriving && <AgentCursor provider={thread.providers[0]} />}
      {pending && (
        <CommentPopup
          thread={thread}
          pending={pending}
          onDone={() => {
            setPending(null);
            onCommented();
          }}
        />
      )}
    </div>
  );
}

function FakeUsagePage({ highlighted }: { highlighted: string | null }) {
  const outline = (name: string) => (highlighted === name ? { outline: '2px solid var(--page-bar)', outlineOffset: 4, borderRadius: 6 } : undefined);
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 items-center gap-6 border-b px-8 text-[15px]" style={{ borderColor: 'var(--page-line)' }}>
        <span className="font-semibold">Latitude Admin</span>
        <span style={{ color: 'var(--page-muted)' }}>Customers</span>
        <span className="font-medium">Usage</span>
        <span style={{ color: 'var(--page-muted)' }}>Billing</span>
      </div>
      <div className="flex flex-col gap-6 px-8 py-7">
        <div className="flex items-center gap-3">
          <h1 className="text-[26px] font-semibold tracking-tight">API usage</h1>
          <span className="flex-1" />
          <span data-annotate="Date range filter" className="rounded-md border px-3 py-1.5 text-[14px]" style={{ ...outline('Date range filter'), borderColor: 'var(--page-line)' }}>
            Last 14 days
          </span>
          <span data-annotate="Export CSV button" className="rounded-md px-3 py-1.5 text-[14px] font-medium text-white" style={{ ...outline('Export CSV button'), background: 'var(--page-fg)' }}>
            Export CSV
          </span>
        </div>
        <div data-annotate="API usage chart" className="flex h-44 items-end gap-2 rounded-lg border p-4" style={{ ...outline('API usage chart'), borderColor: 'var(--page-line)', background: 'var(--page-panel)' }}>
          {BARS.map((b, i) => (
            <span key={i} className="flex-1 rounded-t-[3px]" style={{ height: `${b}%`, background: 'var(--page-bar)', opacity: 0.55 + i * 0.03 }} />
          ))}
        </div>
        <div data-annotate="Keys table" className="rounded-lg border text-[14px]" style={{ ...outline('Keys table'), borderColor: 'var(--page-line)', background: 'var(--page-panel)' }}>
          {KEYS.map((k, i) => (
            <div key={k.name} className={cn('flex items-center gap-4 px-4 py-3', i > 0 && 'border-t')} style={{ borderColor: 'var(--page-line)' }}>
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
    const id = setInterval(() => setStop((s) => (s + 1) % CURSOR_STOPS.length), 2400);
    return () => clearInterval(id);
  }, []);
  const target = CURSOR_STOPS[stop];

  return (
    <motion.div aria-hidden className="pointer-events-none absolute z-10" initial={false} animate={{ left: `${target.x}%`, top: `${target.y}%` }} transition={{ type: 'spring', stiffness: 120, damping: 20 }}>
      <motion.span
        key={stop}
        className="absolute -top-3 -left-3 size-6 rounded-full"
        style={{ background: 'var(--page-bar)' }}
        initial={{ scale: 0.3, opacity: 0 }}
        animate={{ scale: [0.3, 1.6], opacity: [0, 0.35, 0] }}
        transition={{ delay: 0.9, duration: 0.6 }}
      />
      <svg width="16" height="18" viewBox="0 0 16 18" className="drop-shadow">
        <path d="M1 1l13 7.5-6 1.2-3 6.3z" fill="var(--page-fg)" stroke="white" strokeWidth="1.2" strokeLinejoin="round" />
      </svg>
      <span className="mt-0.5 ml-3 flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap text-white" style={{ background: 'var(--page-fg)' }}>
        <ProviderMark provider={provider} size={11} />
        {target.target}
      </span>
    </motion.div>
  );
}

function CommentPopup({ thread, pending, onDone }: { thread: Thread; pending: { target: string; x: number; y: number }; onDone: () => void }) {
  const { dispatch } = useHarness();
  const [text, setText] = useState('');
  const agent = thread.providers[0] === 'codex' ? 'Codex' : 'Claude';
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    dispatch({ type: 'say', threadId: thread.id, entry: { who: 'you', kind: 'message', text: `On "${pending.target}" in the preview: ${text.trim()}` } });
    toast(`Comment sent to ${agent}`, { description: pending.target });
    onDone();
  };
  return (
    <form
      onSubmit={submit}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      className="absolute z-20 flex w-60 flex-col gap-2 rounded-xl bg-popover p-2 shadow-popover"
      style={{ left: Math.max(8, pending.x - 120), top: pending.y + 10 }}
    >
      <span className="truncate type-caption text-muted-foreground">On {pending.target}</span>
      <Input autoFocus aria-label="Comment" value={text} onChange={(e) => setText(e.target.value)} placeholder="Make the bars thinner" onKeyDown={(e) => e.key === 'Escape' && onDone()} />
      <div className="flex justify-end gap-1.5">
        <Button type="button" variant="ghost" size="xs" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" size="xs" disabled={!text.trim()}>
          Send to {agent}
        </Button>
      </div>
    </form>
  );
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(Math.max(v, lo), Math.max(lo, hi));
}
