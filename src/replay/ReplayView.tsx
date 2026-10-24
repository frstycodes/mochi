import { listenKeydown, commandOf, type CommandId } from '../keymap';
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { FileIcon } from '@react-symbols/icons/utils';
import { ChevronDownSmall, Rewind10, FileText, Share, Forward10, Pause, Play, SkipForwardAlt, SkipBack, VideoPlay, X } from '@/icons';
import { Button } from '@/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { useSidebar } from '@/components/ui/sidebar';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';
import { ChatView } from '../ChatView';
import { FilePath } from '../files/FileView';
import type { DiffFile } from '../host/types/git';
import { PreviewContext, SplitContext, type SplitInfo } from '../layout/SplitContext';
import type { Thread } from '../model';
import { isTyping } from '../keys';
import { BoundShortcut } from '../Shortcut';
import { StoreScope, useHarness, type State } from '../store';
import { TITLE_BAR, TitleBar } from '../TitleBar';
import { summarize } from '../summary';
import { TooltipIconButton } from '../ui';
import { DiffStat, DiffView, Expand } from '../WorkLog';
import type { ReplayExport } from './export';
import { exportedCheckpoints, liveCheckpoints, loadRecording, shareReplay, type CheckpointSource } from './load';
import { goBack, useEscapeBack, useReplayRoute } from '../routes/nav';
import type { Recording } from './record';
import { createReplayer, markers, replayedThread, stepsBy, timeline, type Marker, type MarkerKind } from './rebuild';

/** The replay page over the app: the thread's recording rebuilt step by step in a scratch store, read-only. */
export function ReplayView() {
  const threadId = useReplayRoute()!;
  const { state } = useHarness();
  const thread = state.threads.find((t) => t.id === threadId);
  const recording = useRecording(thread);
  useEscapeBack();
  const onExport = thread ? () => void shareReplay(state, thread) : undefined;
  const header = <ReplayHeader title={thread?.title ?? 'Thread'} onExport={recording ? onExport : undefined} onClose={goBack} />;
  if (recording === undefined) return <ReplayLoading header={header} />;
  if (!recording || !thread) return <NothingRecorded header={header} />;
  return <ReplayPlayer key={thread.id} recording={recording} checkpoints={liveCheckpoints(state, thread)} header={header} />;
}

/** An exported page: the same player over the inlined recording, with no app around it. */
export function ReplayPage({ payload }: { payload: ReplayExport }) {
  const title = payload.recording.base.base.thread.title;
  const checkpoints = useMemo(() => exportedCheckpoints(payload.checkpoints), [payload]);
  return (
    <div className="h-svh">
      <ReplayPlayer recording={payload.recording} checkpoints={checkpoints} header={<ReplayHeader title={title} />} />
    </div>
  );
}

function useRecording(thread: Thread | undefined) {
  const [recording, setRecording] = useState<Recording | null | undefined>(undefined);
  const id = thread?.id;
  const latest = useRef(thread);
  latest.current = thread;
  useEffect(() => {
    if (!latest.current) return setRecording(null);
    let isCurrent = true;
    loadRecording(latest.current).then(
      (r) => isCurrent && setRecording(r),
      (error: unknown) => {
        console.error('Reading the replay failed', error);
        if (isCurrent) setRecording(null);
      },
    );
    return () => void (isCurrent = false);
  }, [id]);
  return recording;
}

function ReplayHeader({ title, onExport, onClose }: { title: string; onExport?: () => void; onClose?: () => void }) {
  const hasSidebar = !!useOptionalSidebar();
  const content = (
    <>
      <VideoPlay aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      <span className="type-meta font-medium">Replay</span>
      <span className="min-w-0 truncate type-meta text-muted-foreground">{title}</span>
      <span className="flex-1" />
      {!!onExport && (
        <Button variant="outline" size="sm" className="rounded-full" onClick={onExport}>
          <Share data-icon="inline-start" />
          <span className="max-sm:sr-only">Export replay</span>
        </Button>
      )}
      {!!onClose && (
        <TooltipIconButton label="Close replay" hint={<BoundShortcut command="dismiss" />} onClick={onClose}>
          <X />
        </TooltipIconButton>
      )}
    </>
  );
  return hasSidebar ? <TitleBar>{content}</TitleBar> : <header className={TITLE_BAR}>{content}</header>;
}

/** The exported page has no sidebar around it. */
function useOptionalSidebar() {
  try {
    return useSidebar();
  } catch {
    return null;
  }
}

const SPEEDS = [1, 2, 4, 8] as const;
type Speed = (typeof SPEEDS)[number];

const SPLIT: SplitInfo = { leafId: 'replay', isFocused: true, isMulti: false, isZoomed: false, isFirst: false, isWide: true };
const NO_DISPATCH = () => {};

function ReplayPlayer({ recording, checkpoints, header }: { recording: Recording; checkpoints: CheckpointSource; header: ReactNode }) {
  const playback = usePlayback(recording);
  const stateAt = useMemo(() => createReplayer(recording), [recording]);
  const scratch = useMemo(() => stateAt(playback.n), [stateAt, playback.n]);
  const thread = replayedThread(scratch, recording.base.base.thread.id);
  useReplayKeys(playback);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {header}
      <div className="flex min-h-0 flex-1 gap-3 px-3 md:grid md:grid-cols-[minmax(0,1fr)_300px]">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {!!thread && <ReplayTranscript state={scratch} thread={thread} />}
        </div>
        <aside aria-label="Files at this point" className="mb-3 hidden min-h-0 flex-col rounded-xl border bg-card md:flex">
          {!!thread && <ReplayFiles source={checkpoints} thread={thread} now={scratch.now} />}
        </aside>
      </div>
      <Transport playback={playback} isCapped={recording.isCapped} files={!!thread && <ReplayFiles source={checkpoints} thread={thread} now={scratch.now} />} />
    </div>
  );
}

/** The real chat view on the scratch store: changing only when a step lands, never on a playhead frame. */
const ReplayTranscript = memo(function ReplayTranscript({ state, thread }: { state: State; thread: Thread }) {
  return (
    <StoreScope state={state} dispatch={NO_DISPATCH}>
      <SplitContext.Provider value={SPLIT}>
        <PreviewContext.Provider value>
          <ChatView thread={thread} isReadOnly />
        </PreviewContext.Provider>
      </SplitContext.Provider>
    </StoreScope>
  );
});

interface Playback {
  /** Replay clock, ms from the start. */
  clock: number;
  total: number;
  times: number[];
  /** Steps applied at `clock`. */
  n: number;
  marks: Marker[];
  isPlaying: boolean;
  speed: Speed;
  skipIdle: boolean;
  toggle: () => void;
  seek: (ms: number) => void;
  seekStep: (n: number) => void;
  setSpeed: (speed: Speed) => void;
  setSkipIdle: (skip: boolean) => void;
}

/** A clock that runs at `speed` while playing; steps apply as it passes their time. Starts playing from the beginning. */
function usePlayback(recording: Recording): Playback {
  const [skipIdle, setSkipIdleState] = useState(true);
  const [speed, setSpeed] = useState<Speed>(1);
  const [isPlaying, setPlaying] = useState(true);
  const [clock, setClockState] = useState(0);
  // The frame loop reads the clock here, so a frame never waits on a render to know where it is.
  const clockRef = useRef(0);
  const setClock = useCallback((ms: number) => {
    clockRef.current = ms;
    setClockState(ms);
  }, []);
  const times = useMemo(() => timeline(recording, skipIdle), [recording, skipIdle]);
  const marks = useMemo(() => markers(recording), [recording]);
  const total = times.at(-1) ?? 0;
  const n = stepsBy(times, clock);

  useEffect(() => {
    if (!isPlaying) return;
    let last = performance.now();
    let frame = requestAnimationFrame(function tick(now) {
      const step = (now - last) * speed;
      last = now;
      const next = Math.min(total, clockRef.current + step);
      setClock(next);
      // Reaching the end pauses, so Play (or Space) starts over instead of resuming at the end.
      if (next >= total) return setPlaying(false);
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [isPlaying, speed, total, setClock]);

  const seek = useCallback((ms: number) => setClock(Math.max(0, Math.min(total, ms))), [total, setClock]);
  const seekStep = useCallback((to: number) => setClock(to <= 0 ? 0 : (times[Math.min(to, times.length) - 1] ?? 0)), [times, setClock]);
  return {
    clock,
    total,
    times,
    n,
    marks,
    isPlaying,
    speed,
    skipIdle,
    // Play at the end starts over.
    toggle: () => {
      if (!isPlaying && clock >= total) setClock(0);
      setPlaying(!isPlaying);
    },
    seek,
    seekStep,
    setSpeed,
    // The same step stays in view on the new clock.
    setSkipIdle: (skip) => {
      const next = timeline(recording, skip);
      setSkipIdleState(skip);
      setClock(n > 0 ? next[n - 1] : 0);
    },
  };
}

/** Space / K play and pause, ←/→ step one event, Shift+←/→ jump between markers, J/L 10 s back and forward, Home/End. */
function useReplayKeys(playback: Playback) {
  const latest = useRef(playback);
  latest.current = playback;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isTyping(e.target)) return;
      const { toggle, seek, seekStep, clock, total, n, marks } = latest.current;
      const marker = (by: 1 | -1) => (by > 0 ? marks.find((m) => m.n > n) : marks.findLast((m) => m.n < n));
      const actions: Record<string, () => void> = {
        'replay-toggle': toggle,
        'replay-toggle-k': toggle,
        'replay-back': () => seek(clock - 10_000),
        'replay-forward': () => seek(clock + 10_000),
        'replay-previous': () => seekStep(n - 1),
        'replay-next': () => seekStep(n + 1),
        'replay-marker-previous': () => seekStep(marker(-1)?.n ?? 0),
        'replay-marker-next': () => seekStep(marker(1)?.n ?? n),
        'replay-start': () => seek(0),
        'replay-end': () => seek(total),
      };
      const command = commandOf(e, Object.keys(actions) as CommandId[]);
      const action = command && actions[command];
      if (!action) return;
      // Also keeps Space from clicking the focused button (it would toggle twice) or scrolling the transcript.
      e.preventDefault();
      action();
    };
    return listenKeydown(onKey);
  }, []);
}

function Transport({ playback, isCapped, files }: { playback: Playback; isCapped: boolean; files: ReactNode }) {
  const { clock, total, n, times, isPlaying, speed, skipIdle, toggle, seek, seekStep, setSpeed, setSkipIdle } = playback;
  return (
    <div className="flex shrink-0 flex-col gap-1.5 px-3 pt-1 pb-3">
      <Timeline playback={playback} />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex items-center gap-0.5">
          <TooltipIconButton label="Previous event" hint={<><BoundShortcut command="replay-previous" /> event, <BoundShortcut command="replay-marker-previous" /> marker</>} disabled={n === 0} onClick={() => seekStep(n - 1)}>
            <SkipBack />
          </TooltipIconButton>
          <Button size="icon" className="rounded-full" aria-label={isPlaying ? 'Pause' : 'Play'} onClick={toggle}>
            {isPlaying ? <Pause filled /> : <Play filled />}
          </Button>
          <TooltipIconButton label="Next event" hint={<><BoundShortcut command="replay-next" /> event, <BoundShortcut command="replay-marker-next" /> marker</>} disabled={n >= times.length} onClick={() => seekStep(n + 1)}>
            <SkipForwardAlt />
          </TooltipIconButton>
          <TooltipIconButton label="Back 10 seconds" hint={<BoundShortcut command="replay-back" />} className="max-sm:hidden" onClick={() => seek(clock - 10_000)}>
            <Rewind10 />
          </TooltipIconButton>
          <TooltipIconButton label="Forward 10 seconds" hint={<BoundShortcut command="replay-forward" />} className="max-sm:hidden" onClick={() => seek(clock + 10_000)}>
            <Forward10 />
          </TooltipIconButton>
        </div>
        <span className="tabular type-meta text-muted-foreground">
          <span className="text-foreground">{duration(clock)}</span> / {duration(total)}
        </span>
        <span className="tabular type-caption text-subtle-foreground max-sm:hidden">
          Event {n} of {times.length}
        </span>
        <span className="flex-1" />
        <ToggleGroup type="single" size="sm" variant="outline" aria-label="Playback speed" value={String(speed)} onValueChange={(v) => v && setSpeed(Number(v) as Speed)}>
          {SPEEDS.map((s) => (
            <ToggleGroupItem key={s} value={String(s)} className="tabular">
              {s}×
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <div className="flex items-center gap-2">
          <Switch id="replay-skip-idle" size="sm" checked={skipIdle} onCheckedChange={setSkipIdle} />
          <Label htmlFor="replay-skip-idle" className="type-meta font-normal">
            Skip idle gaps
          </Label>
        </div>
        <FilesSheet>{files}</FilesSheet>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 type-caption text-subtle-foreground max-md:hidden">
        <Legend />
        <span className="flex-1" />
        {isCapped && <span>Recording stopped at its size cap; the replay ends there</span>}
        <span className="flex items-center gap-1.5">
          <BoundShortcut command="replay-toggle" /> play
          <BoundShortcut command="replay-previous" /><BoundShortcut command="replay-next" /> step
          <BoundShortcut command="replay-back" /><BoundShortcut command="replay-toggle-k" /><BoundShortcut command="replay-forward" /> seek
        </span>
      </div>
    </div>
  );
}

const MARKER_STYLE = {
  you: { className: 'h-3 bg-info', label: 'Your messages' },
  tool: { className: 'h-1.5 bg-muted-foreground/45', label: 'Tool calls' },
  edit: { className: 'h-2.5 bg-success', label: 'File edits' },
  approval: { className: 'h-3 bg-warning', label: 'Approvals' },
  error: { className: 'h-3 bg-destructive', label: 'Errors' },
} satisfies Record<MarkerKind, { className: string; label: string }>;

// Drawn over tool calls, so the rarer, louder kinds stay visible where they cluster.
const MARKER_ORDER: MarkerKind[] = ['tool', 'edit', 'you', 'approval', 'error'];

function Legend() {
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {MARKER_ORDER.map((kind) => (
        <span key={kind} className="flex items-center gap-1.5">
          <span aria-hidden className={cn('w-0.5 rounded-full', MARKER_STYLE[kind].className)} />
          {MARKER_STYLE[kind].label}
        </span>
      ))}
    </span>
  );
}

/** The scrubber: markers at their moments, the played part filled, drag or click anywhere to seek; hovering names the nearest marker. */
function Timeline({ playback }: { playback: Playback }) {
  const { clock, total, times, marks, seek } = playback;
  const track = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ x: number; marker?: Marker } | null>(null);
  const at = (marker: Marker) => times[marker.n - 1] ?? 0;
  const pct = (ms: number) => (total ? (ms / total) * 100 : 0);
  const sorted = useMemo(() => [...marks].sort((a, b) => MARKER_ORDER.indexOf(a.kind) - MARKER_ORDER.indexOf(b.kind)), [marks]);

  const msAt = (clientX: number) => {
    const rect = track.current!.getBoundingClientRect();
    return (Math.max(0, Math.min(rect.width, clientX - rect.left)) / rect.width) * total;
  };
  const onPointer = (e: React.PointerEvent) => {
    const rect = track.current!.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const near = marks.reduce<Marker | undefined>((best, m) => {
      const dx = Math.abs((pct(at(m)) / 100) * rect.width - x);
      return dx <= 6 && (!best || dx < Math.abs((pct(at(best)) / 100) * rect.width - x)) ? m : best;
    }, undefined);
    setHover({ x, marker: near });
    if (e.buttons === 1) seek(near && e.type === 'pointerdown' ? at(near) : msAt(e.clientX));
  };

  return (
    <div
      ref={track}
      role="slider"
      tabIndex={0}
      aria-label="Replay position"
      aria-valuemin={0}
      aria-valuemax={Math.round(total / 1000)}
      aria-valuenow={Math.round(clock / 1000)}
      aria-valuetext={`${duration(clock)} of ${duration(total)}`}
      className="relative h-7 cursor-pointer touch-none rounded-md outline-none select-none focus-visible:ring-2 focus-visible:ring-ring"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        onPointer(e);
      }}
      onPointerMove={onPointer}
      onPointerLeave={() => setHover(null)}
    >
      <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-muted" />
      <div className="absolute top-1/2 left-0 h-1 -translate-y-1/2 rounded-full bg-foreground/35" style={{ width: `${pct(clock)}%` }} />
      {sorted.map((m, i) => (
        <span key={i} aria-hidden className={cn('pointer-events-none absolute top-1/2 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full', MARKER_STYLE[m.kind].className)} style={{ left: `${pct(at(m))}%` }} />
      ))}
      <span aria-hidden className="pointer-events-none absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground shadow-[0_0_0_2px_var(--background)]" style={{ left: `${pct(clock)}%` }} />
      {!!hover && (
        <span
          aria-hidden
          className="pointer-events-none absolute bottom-full z-10 mb-1 flex max-w-64 -translate-x-1/2 items-center gap-1.5 rounded-md bg-popover px-2 py-1 type-caption text-popover-foreground shadow-popover"
          style={{ left: Math.max(60, Math.min(hover.x, (track.current?.clientWidth ?? 0) - 60)) }}
        >
          {!!hover.marker && <span className={cn('h-2.5 w-0.5 shrink-0 rounded-full', MARKER_STYLE[hover.marker.kind].className)} />}
          <span className="truncate">{hover.marker ? hover.marker.label : duration(msAt(hover.x + (track.current?.getBoundingClientRect().left ?? 0)))}</span>
        </span>
      )}
    </div>
  );
}

function FilesSheet({ children }: { children: ReactNode }) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" className="rounded-full md:hidden">
          <FileText data-icon="inline-start" />
          Files
        </Button>
      </SheetTrigger>
      <SheetContent side="bottom" className="max-h-[70svh]">
        <SheetHeader>
          <SheetTitle>Files at this point</SheetTitle>
        </SheetHeader>
        <div className="flex min-h-0 flex-col px-0.5 pb-3">{children}</div>
      </SheetContent>
    </Sheet>
  );
}

/**
 * The diff as the nearest checkpoint at or before this point saved it; before any checkpoint (or with none saved), the
 * files the agent had touched so far, from its tool calls.
 */
function ReplayFiles({ source, thread, now }: { source: CheckpointSource; thread: Thread; now: number }) {
  const index = source.list.findLastIndex((c) => c.at <= now);
  const files = useCheckpointFiles(source, index);
  const touched = summarize(thread.activity.filter((a) => a.at <= now)).files.map((f) => f.path);
  const checkpoint = source.list[index];
  const caption = checkpoint ? `As saved at “${checkpoint.label}”` : 'No checkpoint saved by this point';
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-col gap-0.5 px-3.5 pt-3 pb-2 max-md:hidden">
        <h2 className="type-meta font-medium">Files at this point</h2>
        <p className="type-caption text-muted-foreground">{caption}</p>
      </div>
      <p className="px-3.5 pb-2 type-caption text-muted-foreground md:hidden">{caption}</p>
      <ScrollArea type="scroll" className="min-h-0 flex-1 [&_[data-slot=scroll-area-viewport]>div]:!block">
        <div className="flex flex-col gap-0.5 px-1.5 pb-2">
          {files === undefined && checkpoint ? (
            <FileRowsSkeleton />
          ) : files?.length ? (
            files.map((f) => <DiffFileRow key={f.path} file={f} />)
          ) : touched.length ? (
            touched.map((path) => <TouchedRow key={path} path={path} />)
          ) : (
            <p className="px-2 py-1.5 type-meta text-muted-foreground">No files touched yet</p>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

function useCheckpointFiles(source: CheckpointSource, index: number) {
  const cache = useRef(new Map<number, DiffFile[] | null>());
  const [, rerender] = useState(0);
  useEffect(() => {
    if (index < 0 || cache.current.has(index)) return;
    let isCurrent = true;
    source.files(index).then(
      (files) => cache.current.set(index, files),
      () => cache.current.set(index, null),
    ).finally(() => isCurrent && rerender((r) => r + 1));
    return () => void (isCurrent = false);
  }, [source, index]);
  if (index < 0) return null;
  return cache.current.has(index) ? cache.current.get(index) : undefined;
}

function DiffFileRow({ file }: { file: DiffFile }) {
  const [isOpen, setOpen] = useState(false);
  return (
    <div className="flex flex-col">
      <button type="button" aria-expanded={isOpen} className="flex h-7 items-center gap-2 rounded-md px-2 text-left hover:bg-accent/60" onClick={() => setOpen((o) => !o)}>
        <FileIcon fileName={file.path.split('/').pop() ?? file.path} autoAssign aria-hidden className="size-4 shrink-0" />
        <FilePath path={file.path} />
        <span className="flex-1" />
        <DiffStat added={file.added} removed={file.removed} />
        <ChevronDownSmall aria-hidden className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform duration-150', isOpen && 'rotate-180')} />
      </button>
      <Expand isOpen={isOpen}>
        <div className="px-1 pt-1 pb-2">{file.binary ? <p className="px-1 type-meta text-muted-foreground">Binary file</p> : <DiffView patch={file.patch} />}</div>
      </Expand>
    </div>
  );
}

function TouchedRow({ path }: { path: string }) {
  return (
    <div className="flex h-7 items-center gap-2 px-2">
      <FileIcon fileName={path.split('/').pop() ?? path} autoAssign aria-hidden className="size-4 shrink-0" />
      <FilePath path={path} />
    </div>
  );
}

function FileRowsSkeleton() {
  return (
    <>
      {['w-3/4', 'w-1/2', 'w-2/3'].map((w) => (
        <div key={w} className="flex h-7 items-center gap-2 px-2">
          <Skeleton className="size-4 rounded-sm" />
          <Skeleton className={cn('h-2.5', w)} />
        </div>
      ))}
    </>
  );
}

function ReplayLoading({ header }: { header: ReactNode }) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      {header}
      <div className="mx-auto flex w-full max-w-[720px] flex-col gap-5 px-4 pt-6 md:px-6">
        <Skeleton className="ml-auto h-10 w-2/3 rounded-2xl" />
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-16 w-full" />
      </div>
    </div>
  );
}

function NothingRecorded({ header }: { header: ReactNode }) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      {header}
      <Empty className="flex-1">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <VideoPlay />
          </EmptyMedia>
          <EmptyTitle>Nothing recorded yet</EmptyTitle>
          <EmptyDescription>Threads record what their agent does from the next message on, while Settings › Data and storage › Record threads for replay is on.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  );
}

/** m:ss, or h:mm:ss past an hour. */
function duration(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(mm).padStart(2, '0')}:${ss}` : `${mm}:${ss}`;
}
