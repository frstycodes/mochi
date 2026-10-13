import { useEffect, useLayoutEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotionConfig } from 'motion/react';
import { useTheme } from 'next-themes';
import { DEFAULT_THEMES, getHighlighterIfLoaded, getHighlighterOptions, getSharedHighlighter } from '@pierre/diffs';
import { File, PatchDiff } from '@pierre/diffs/react';
import { FileIcon } from '@react-symbols/icons/utils';
import { Check, ChevronRight, Eye, Flag, Global, GlobalSearch, TerminalSquare, X } from 'reicon-react';
import { Shimmer } from '@/components/ai-elements/shimmer';
import { cn } from '@/lib/utils';
import { AgentLoader, type AgentPhase } from './AgentLoader';
import { PATCHES, RUNS, type RunResult } from './fixtures';
import type { ActivityEntry, WebLink } from './model';
import { clock } from './progress';
import { usePrefs } from './settings/prefs';
import { eventLine, isApprovalChatter, parseTool, toolCall, turnSummary, type ToolCall } from './summary';
import { hostname, type CurrentAction } from './agentPhase';
import { loadViewerFile, openFromScope, useThreadFiles, type ThreadFiles } from './files/viewer';
import { fileLink } from './terminal/links';
import { describeCall } from './chat/describe';
import { PREVIEW_KINDS } from './files/kinds';
import { imageMime } from './files/previews';
import { outputLines } from './chat/output';
import { TooltipIconButton } from './ui';
import { Favicon, LinkList, LinkRow } from './WebLinks';

const EXPAND = { duration: 0.2, ease: [0.23, 1, 0.32, 1] } as const;

/**
 * One work group (the calls between two messages), folded to a line like Claude's: while live the line names the current
 * action and rolls to each new one; once done it settles into a summary. Open, it lists each call as a plain sentence
 * that opens in place to its command and output, diff, results or file.
 */
export function WorkLog({ entries, action }: { entries: ActivityEntry[]; action?: CurrentAction }) {
  const [isOpen, setOpen] = useState(false);
  const isLive = !!action;
  const tools = entries.filter((e) => e.kind === 'tool');
  const edits = tools.map(toolCall).filter((c) => c.verb === 'Edit' || c.verb === 'Write');
  const failed = tools.filter((e) => (runOf(e)?.exitCode ?? 0) !== 0).length;
  const lastTool = entries.findLastIndex((e) => e.kind === 'tool');
  const title = action ? { key: `live:${action.label}`, value: action } : { key: 'done', value: turnSummary(entries) };
  const files = useThreadFiles();
  const images = [...new Set(tools.map(toolCall).flatMap((c) => (c.verb === 'Read' && isImage(c.target) ? [c.target] : [])))].slice(0, THUMBS_SHOWN);

  return (
    <div data-file-scope className="-mx-2 flex flex-col">
      <div className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          aria-expanded={isOpen}
          onClick={() => setOpen((o) => !o)}
          className="group/log flex h-7 min-w-0 cursor-default items-center gap-2 rounded-lg px-2 text-left type-meta text-muted-foreground hover:bg-accent/60 hover:text-foreground"
        >
          <RollingTitle title={title} />
          <AnimatePresence initial={false}>
            {!isLive && (edits.length > 0 || failed > 0) && (
              <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2, delay: 0.12 }} className="flex shrink-0 items-center gap-3 text-subtle-foreground">
                {edits.length > 0 && (
                  <span className="flex items-center gap-1.5">
                    <FileStack paths={edits.map((c) => c.target)} />
                    <DiffStat added={sum(edits, 'added')} removed={sum(edits, 'removed')} />
                  </span>
                )}
                {failed > 0 && <span className="tabular text-destructive">{failed} failed</span>}
              </motion.span>
            )}
          </AnimatePresence>
          <TrailIcon isWaiting={!!action?.isWaiting} isOpen={isOpen} />
        </button>
        {/* Folded, the images it looked at stay in view like Claude's; open, each Read row shows its own. */}
        <AnimatePresence initial={false}>
          {!isOpen && !!files && images.length > 0 && (
            <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} className="ml-auto flex shrink-0 items-center gap-1 pr-2">
              {images.map((path) => (
                <ImageThumb key={path} files={files} path={path} />
              ))}
            </motion.span>
          )}
        </AnimatePresence>
      </div>
      <Expand isOpen={isOpen}>
        <CallList className="mx-2 mt-1">
          {entries.map((e, i) => {
            if (e.kind === 'reasoning') return <ThoughtRow key={i} entry={e} />;
            // The live title says what it waits on; once answered, the call's own row is the record.
            if (e.kind === 'event' && isApprovalChatter(e.text)) return null;
            if (e.kind !== 'tool') return <EventRow key={i} entry={e} />;
            return <CallRow key={i} entry={e} isRunning={isLive && i === lastTool} files={files} />;
          })}
        </CallList>
      </Expand>
    </div>
  );
}

/** The bordered list of calls: an open work group, a subagent's log. Inside border: an outside ring would be cut off by an expander's clip. */
export function CallList({ className, ...props }: ComponentProps<'ol'>) {
  return <ol className={cn('flex flex-col divide-y overflow-hidden rounded-xl border', className)} {...props} />;
}

/** What a row needs from a call, whether the thread's own (`ActivityEntry`) or a subagent's (`SubagentStep`). */
type ToolEntry = Pick<ActivityEntry, 'text' | 'description' | 'output' | 'exitCode' | 'patch' | 'links'>;

/** One call: what it did in words, opening in place to the detail behind it. */
export function CallRow({ entry, isRunning, files }: { entry: ToolEntry; isRunning: boolean; files: ThreadFiles | null }) {
  const [isOpen, setOpen] = useState(false);
  const call = toolCall(entry);
  const run = runOf(entry);
  const isFile = call.verb === 'Read' || call.verb === 'Edit' || call.verb === 'Write';
  const detail = callDetail(entry, call, files);
  const description = describeCall(entry);

  const row = (
    <>
      <CallGlyph call={call} links={entry.links} />
      {isRunning ? (
        <Shimmer as="span" className="min-w-0 flex-1 truncate">
          {description}
        </Shimmer>
      ) : (
        <span className="min-w-0 flex-1 truncate text-foreground" title={call.verb === 'Run' ? call.target : undefined}>
          {description}
        </span>
      )}
      {call.added !== undefined && <DiffStat added={call.added} removed={call.removed ?? 0} withBar />}
      {!isRunning && !!run && run.exitCode !== 0 && <span className="shrink-0 font-mono text-xs tabular text-destructive">exit {run.exitCode}</span>}
    </>
  );

  return (
    <li className="group/call flex flex-col">
      <div className={cn('flex min-w-0 items-center', !!detail && 'hover:bg-accent/60')}>
        {detail ? (
          <button type="button" aria-expanded={isOpen} onClick={() => setOpen((o) => !o)} className="flex h-9 min-w-0 flex-1 cursor-default items-center gap-2.5 pr-1 pl-3 text-left type-meta">
            {row}
            <ChevronRight aria-hidden className={cn('size-3.5 shrink-0 text-subtle-foreground transition-transform duration-150', isOpen && 'rotate-90')} />
          </button>
        ) : (
          <div className="flex h-9 min-w-0 flex-1 items-center gap-2.5 pr-1 pl-3 type-meta">{row}</div>
        )}
        {!!files && isFile && (
          <TooltipIconButton
            label="Open in viewer"
            hint={call.target}
            data-file-link={call.target}
            onClick={(e) => openFromScope(e.currentTarget, files)}
            className="mr-1.5 opacity-0 group-hover/call:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
          >
            <Eye />
          </TooltipIconButton>
        )}
        {/* The same trailing slot on every row, so chevrons and stats line up with the file rows' open button. */}
        {!!files && !isFile && <span aria-hidden className="mr-1.5 size-6 shrink-0" />}
        {!files && !detail && <span aria-hidden className="w-6 shrink-0" />}
      </div>
      {!!detail && (
        <Expand isOpen={isOpen}>
          <div className="px-3 pb-3">{detail}</div>
        </Expand>
      )}
    </li>
  );
}

/** What a call opens to: the command and its output, the edit's diff, the file it read, the pages a search returned. */
function callDetail(entry: ToolEntry, call: ToolCall, files: ThreadFiles | null): ReactNode {
  if (call.verb === 'Run') return <RunOutput command={call.target} run={runOf(entry)} />;
  if (call.verb === 'Edit' || call.verb === 'Write') {
    const patch = entry.patch ?? PATCHES[call.target];
    return patch ? <DiffView patch={patch} /> : null;
  }
  if (call.verb === 'Read' && files) return isImage(call.target) ? <ImageDetail files={files} path={call.target} /> : <FilePreview files={files} path={call.target} />;
  if (call.verb === 'Search') return entry.links?.length ? <LinkList links={entry.links} /> : null;
  if (call.verb === 'Fetch') return <LinkRow link={entry.links?.[0] ?? { url: call.target }} />;
  return null;
}

/** A live call's output and exit code, or the demo's scripted run for the same command. */
function runOf(entry: ToolEntry): RunResult | undefined {
  const call = parseTool(entry.text);
  if (call.verb !== 'Run') return undefined;
  if (entry.output === undefined && entry.exitCode === undefined) return RUNS[call.target];
  return { exitCode: entry.exitCode ?? 0, lines: outputLines(entry.output ?? '') };
}

function CallGlyph({ call, links = [] }: { call: ToolCall; links?: WebLink[] }) {
  if (call.verb === 'Search') {
    const hosts = [...new Set(links.map((l) => hostname(l.url)))].slice(0, 3);
    if (!hosts.length) return <GlobalSearch className="size-4 shrink-0 text-muted-foreground" />;
    return (
      <span className="flex shrink-0 items-center">
        {hosts.map((host, i) => (
          <span key={host} className={cn('rounded-full bg-background ring-2 ring-background', i > 0 && '-ml-1.5')}>
            <Favicon host={host} />
          </span>
        ))}
      </span>
    );
  }
  if (call.verb === 'Fetch') return <Favicon host={hostname(links[0]?.url ?? call.target)} />;
  return <ToolGlyph call={call} />;
}

/** The first lines of a file the agent read, highlighted like the viewer; the whole file opens in the viewer. */
function FilePreview({ files, path }: { files: ThreadFiles; path: string }) {
  const { resolvedTheme } = useTheme();
  const [state, setState] = useState<{ text?: string; error?: string }>({});
  const isReady = useHighlighterReady();
  useEffect(() => {
    let isCurrent = true;
    loadViewerFile({ source: 'workspace', ...files, ...fileLink(path) }).then(
      (content) => isCurrent && setState(content.kind === 'text' ? { text: content.text } : { error: 'Binary file' }),
      (e: Error) => isCurrent && setState({ error: e.message }),
    );
    return () => void (isCurrent = false);
  }, [files, path]);
  if (state.error) return <p className="type-caption text-subtle-foreground">{state.error}</p>;
  if (state.text === undefined || !isReady) return <p className="type-caption text-subtle-foreground">Loading…</p>;
  const lines = state.text.split('\n');
  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <File
        file={{ name: path.split('/').pop() ?? path, contents: lines.slice(0, PREVIEW_LINES).join('\n') }}
        disableWorkerPool
        options={{ disableFileHeader: true, overflow: 'scroll', themeType: resolvedTheme === 'light' ? 'light' : 'dark' }}
        style={DIFF_STYLE}
        className="max-h-64 overflow-auto"
      />
      {lines.length > PREVIEW_LINES && <p className="border-t px-3 py-1.5 type-caption text-subtle-foreground">{lines.length - PREVIEW_LINES} more lines</p>}
    </div>
  );
}

const PREVIEW_LINES = 40;
const THUMBS_SHOWN = 3;

const isImage = (path: string) => PREVIEW_KINDS.image.test(path) || PREVIEW_KINDS.svg.test(path);

/** An image the agent read, small, opening in the viewer. */
function ImageThumb({ files, path }: { files: ThreadFiles; path: string }) {
  const url = useImageUrl(files, path);
  const name = path.split('/').pop() ?? path;
  return (
    <button
      type="button"
      aria-label={`Open ${name}`}
      data-file-link={path}
      onClick={(e) => openFromScope(e.currentTarget, files)}
      className="relative h-6 w-9 shrink-0 cursor-default overflow-hidden rounded-md bg-muted after:absolute after:inset-0 after:rounded-[inherit] after:shadow-[inset_0_0_0_1px_rgb(0_0_0/0.08)] focus-visible:outline-2 focus-visible:outline-offset-2 dark:after:shadow-[inset_0_0_0_1px_rgb(255_255_255/0.08)]"
    >
      {!!url && <img src={url} alt="" className="size-full object-cover" />}
    </button>
  );
}

function ImageDetail({ files, path }: { files: ThreadFiles; path: string }) {
  const url = useImageUrl(files, path);
  if (!url) return <p className="type-caption text-subtle-foreground">Loading…</p>;
  return (
    <div className="flex justify-center overflow-hidden rounded-lg border bg-card p-3">
      <img src={url} alt={path.split('/').pop()} className="max-h-64 max-w-full object-contain" />
    </div>
  );
}

/** A workspace image as an object URL, revoked when the row goes; `null` while it loads or when it can't be read. */
function useImageUrl(files: ThreadFiles, path: string) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let next: string | undefined;
    let isCurrent = true;
    loadViewerFile({ source: 'workspace', ...files, ...fileLink(path) }).then(
      (content) => {
        if (!isCurrent) return;
        next = URL.createObjectURL(new Blob([(content.kind === 'text' ? content.text : content.bytes) as BlobPart], { type: PREVIEW_KINDS.svg.test(path) ? 'image/svg+xml' : imageMime(path) }));
        setUrl(next);
      },
      () => isCurrent && setUrl(null),
    );
    return () => {
      isCurrent = false;
      if (next) URL.revokeObjectURL(next);
    };
  }, [files, path]);
  return url;
}

const ICON_SWAP = { initial: { opacity: 0, scale: 0.25, filter: 'blur(4px)' }, animate: { opacity: 1, scale: 1, filter: 'blur(0px)' }, exit: { opacity: 0, scale: 0.25, filter: 'blur(4px)' } };

/** After the title, so it sits flush with the prose like Claude's: the chevron, or the needs-you dot while paused on you (the chevron on hover, so it still reads as openable). Working needs no icon: Mochi under the chat and the shimmering title say it. */
function TrailIcon({ isWaiting, isOpen }: { isWaiting: boolean; isOpen: boolean }) {
  const chevron = <ChevronRight className={cn('size-3 text-subtle-foreground transition-transform duration-150', isOpen && 'rotate-90')} />;
  return (
    <span className="grid size-3 shrink-0 place-items-center *:col-start-1 *:row-start-1">
      <AnimatePresence initial={false}>
        {isWaiting ? (
          <motion.span key="waiting" {...ICON_SWAP} transition={{ duration: 0.2 }} className="grid place-items-center *:col-start-1 *:row-start-1">
            <span aria-hidden className="size-1.5 rounded-full bg-warning group-hover/log:opacity-0" />
            <span className="opacity-0 group-hover/log:opacity-100">{chevron}</span>
          </motion.span>
        ) : (
          <motion.span key="chevron" {...ICON_SWAP} transition={{ duration: 0.2 }} className="grid place-items-center">
            {chevron}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}

type Title = { key: string; value: CurrentAction | string };

// A title stays up at least this long, so a burst of fast calls still reads; changes inside it coalesce to the latest.
const DWELL_MS = 400;
const ROLL = { duration: 0.28, ease: [0.23, 1, 0.32, 1] } as const;
const ROLL_OUT = { duration: 0.2, ease: [0.23, 1, 0.32, 1] } as const;

/** The title as a vertical text roll: the old line slides up and blurs out while the new one rises from below; the width follows. */
function RollingTitle({ title }: { title: Title }) {
  const reduce = useReducedMotionConfig();
  const shown = useDwell(title, DWELL_MS);
  const measure = useRef<HTMLSpanElement>(null);
  const [width, setWidth] = useState<number>();
  useLayoutEffect(() => {
    const el = measure.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.ceil(e.borderBoxSize[0].inlineSize)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const roll = reduce
    ? { initial: { opacity: 0 }, animate: { opacity: 1, transition: ROLL }, exit: { opacity: 0, transition: ROLL_OUT } }
    : {
        initial: { opacity: 0, transform: 'translateY(100%)', filter: 'blur(3px)' },
        animate: { opacity: 1, transform: 'translateY(0%)', filter: 'blur(0px)', transition: ROLL },
        exit: { opacity: 0, transform: 'translateY(-100%)', filter: 'blur(3px)', transition: ROLL_OUT },
      };

  return (
    <motion.span
      data-work-title
      aria-live="polite"
      initial={false}
      animate={width === undefined ? undefined : { width }}
      transition={reduce ? { duration: 0 } : ROLL}
      className="relative flex h-5 min-w-0 shrink items-center overflow-hidden"
    >
      <span ref={measure} aria-hidden className="invisible absolute top-0 left-0 flex items-center gap-1.5 whitespace-nowrap">
        <TitleContent value={shown.value} />
      </span>
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span key={shown.key} {...roll} className="flex h-5 max-w-full min-w-0 items-center gap-1.5 whitespace-nowrap">
          <TitleContent value={shown.value} />
        </motion.span>
      </AnimatePresence>
    </motion.span>
  );
}

function TitleContent({ value }: { value: CurrentAction | string }) {
  if (typeof value === 'string') return <span className="min-w-0 truncate">{value}</span>;
  return (
    <>
      <ActionIcon action={value} />
      {value.isWaiting ? (
        <span className="min-w-0 truncate text-foreground">{value.label}</span>
      ) : (
        <Shimmer as="span" className="min-w-0 truncate">
          {value.label}
        </Shimmer>
      )}
    </>
  );
}

const FAVICONS_SHOWN = 4;

/** Favicons of the pages a search returned (stacked, each fading in as it arrives), the read page's, or the file's type icon. */
function ActionIcon({ action }: { action: CurrentAction }) {
  const { call, links = [] } = action;
  if (!call) return null;
  if (call.verb === 'Search' || call.verb === 'Fetch') {
    const hosts = [...new Set((call.verb === 'Fetch' && !links.length ? [{ url: call.target }] : links).map((l) => hostname(l.url)))].slice(0, FAVICONS_SHOWN);
    if (!hosts.length) return null;
    return (
      <span className="flex shrink-0 items-center">
        <AnimatePresence initial={false}>
          {hosts.map((host, i) => (
            <motion.span key={host} initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.2, delay: i * 0.05 }} className={cn('rounded-full bg-background ring-2 ring-background', i > 0 && '-ml-1.5')}>
              <Favicon host={host} />
            </motion.span>
          ))}
        </AnimatePresence>
      </span>
    );
  }
  if (call.verb === 'Read' || call.verb === 'Edit' || call.verb === 'Write') return <FileIcon fileName={call.target.split('/').pop() ?? call.target} autoAssign aria-hidden className="size-3.5 shrink-0" />;
  return null;
}

/**
 * The title on screen: a new key waits until the current one has been up `dwell` ms, then the latest pending one shows,
 * so a burst never queues a backlog. The same key passes its fresh value straight through (favicons arriving).
 */
function useDwell(title: Title, dwell: number): Title {
  const [shown, setShown] = useState(title);
  const shownAt = useRef(0);
  const latest = useRef(title);
  latest.current = title;
  useEffect(() => {
    if (title.key === shown.key) return;
    const show = () => {
      shownAt.current = performance.now();
      setShown(latest.current);
    };
    const wait = shownAt.current + dwell - performance.now();
    if (wait <= 0) return show();
    const t = window.setTimeout(show, wait);
    return () => window.clearTimeout(t);
  }, [title.key, shown.key, dwell]);
  return title.key === shown.key ? title : shown;
}

/** A harness event inside the turn: a denied call, a goal change. */
function EventRow({ entry }: { entry: ActivityEntry }) {
  const line = eventLine(entry.text);
  return (
    <li className="flex min-h-9 items-start gap-2.5 px-3 py-2 type-meta">
      {line.startsWith('Denied') ? <X className="mt-0.5 size-4 shrink-0 text-destructive" /> : <Flag className="mt-0.5 size-4 shrink-0 text-subtle-foreground" />}
      <span className="min-w-0 text-pretty text-muted-foreground">
        {line}
        <span className="whitespace-nowrap tabular text-subtle-foreground"> · {clock(entry.at)}</span>
      </span>
    </li>
  );
}

/** Mochi at the end of the chat, always there: one instance, so it idles and then acts out whatever the agent does next. Before the agent's first output it also says what it's waiting on. */
export function ChatMochi({ phase, label }: { phase: AgentPhase; label?: string }) {
  return (
    // -mt-4 pulls it up into the transcript's 20px row gap: it belongs to the last message, not a row of its own.
    <div role="status" className="-mt-4 flex h-9 items-center gap-1.5 type-meta text-muted-foreground">
      <AgentLoader phase={phase} className="-ml-2 size-9 text-foreground" />
      {!!label && <Shimmer as="span">{`${label}…`}</Shimmer>}
    </div>
  );
}

function sum(calls: ToolCall[], key: 'added' | 'removed') {
  return calls.reduce((n, c) => n + (c[key] ?? 0), 0);
}

export function Expand({ isOpen, children }: { isOpen: boolean; children: ReactNode }) {
  const reduce = useReducedMotionConfig();
  return (
    <AnimatePresence initial={false}>
      {isOpen && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={reduce ? { duration: 0 } : EXPAND}
          className="overflow-hidden"
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function ToolGlyph({ call }: { call: ToolCall }) {
  if (call.verb === 'Run') return <TerminalSquare className="size-4 shrink-0 text-muted-foreground" />;
  if (call.verb === 'Browser') return <Global className="size-4 shrink-0 text-muted-foreground" />;
  return <FileIcon fileName={call.target.split('/').pop() ?? call.target} autoAssign aria-hidden className="size-4 shrink-0" />;
}

export function DiffStat({ added, removed, withBar }: { added: number; removed: number; withBar?: boolean }) {
  return (
    <span className="flex items-center gap-1.5 font-mono text-xs tabular">
      <span className="text-success">+{added}</span>
      <span className="text-destructive">−{removed}</span>
      {withBar && <DiffBar added={added} removed={removed} />}
    </span>
  );
}

const BAR_BLOCKS = 5;

/** GitHub's five-block change bar: green and red in proportion, grey for the rest. */
function DiffBar({ added, removed }: { added: number; removed: number }) {
  const total = added + removed;
  const scale = Math.min(BAR_BLOCKS, Math.ceil(Math.log10(total + 1) * 2));
  const green = total ? Math.round((added / total) * scale) : 0;
  const red = total ? scale - green : 0;
  return (
    <span aria-hidden className="flex gap-px">
      {Array.from({ length: BAR_BLOCKS }, (_, i) => (
        <span key={i} className={cn('size-1.5 rounded-xs', i < green ? 'bg-success' : i < green + red ? 'bg-destructive' : 'bg-muted-foreground/25')} />
      ))}
    </span>
  );
}

function FileStack({ paths }: { paths: string[] }) {
  const unique = [...new Set(paths)];
  return (
    <span className="flex items-center" aria-label={`${unique.length} files`}>
      {unique.slice(0, 3).map((p, i) => (
        <FileIcon key={p} fileName={p.split('/').pop() ?? p} autoAssign aria-hidden className={cn('size-3.5 rounded-xs bg-background ring-2 ring-background', i > 0 && '-ml-1')} />
      ))}
    </span>
  );
}

function ExitBadge({ run }: { run: RunResult }) {
  const ok = run.exitCode === 0;
  return (
    <span className={cn('flex items-center gap-1 font-mono text-xs tabular', ok ? 'text-subtle-foreground' : 'text-destructive')}>
      {ok ? <Check className="size-3.5 text-success" /> : <X className="size-3.5" />}
      {ok ? (run.ms === undefined ? 'exit 0' : seconds(run.ms)) : `exit ${run.exitCode}`}
    </span>
  );
}

function seconds(ms: number) {
  return ms < 60_000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

const HIGHLIGHTER = { theme: DEFAULT_THEMES, lang: 'text' } as const;

/**
 * Pierre 1.5.2 drops the first render while its shared highlighter is still loading (`applyHighlightResult` returns
 * early on an empty render cache), so the first diff of a session stayed blank. Mount it once the highlighter is up.
 */
function useHighlighterReady() {
  const [isReady, setReady] = useState(() => !!getHighlighterIfLoaded(HIGHLIGHTER));
  useEffect(() => {
    if (isReady) return;
    let isCurrent = true;
    void getSharedHighlighter(getHighlighterOptions(HIGHLIGHTER.lang, { theme: HIGHLIGHTER.theme })).then(() => isCurrent && setReady(true));
    return () => void (isCurrent = false);
  }, [isReady]);
  return isReady;
}

const DIFF_STYLE = { '--diffs-font-family': 'var(--font-mono)', '--diffs-font-size': '12px', '--diffs-line-height': '20px' } as React.CSSProperties;

export function DiffView({ patch }: { patch: string }) {
  const { resolvedTheme } = useTheme();
  const { diffStyle } = usePrefs();
  const isReady = useHighlighterReady();
  if (!isReady) return null;
  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <PatchDiff
        patch={patch}
        disableWorkerPool
        options={{ diffStyle, disableFileHeader: true, overflow: 'scroll', themeType: resolvedTheme === 'light' ? 'light' : 'dark' }}
        style={DIFF_STYLE}
        className="max-h-80 overflow-auto"
      />
    </div>
  );
}

const TONE = { plain: 'text-foreground', dim: 'text-subtle-foreground', pass: 'text-success', fail: 'text-destructive' } satisfies Record<RunResult['lines'][number]['tone'], string>;

/** The command, its exit badge, then its output in colour. */
function RunOutput({ command, run }: { command: string; run?: RunResult }) {
  return (
    <div className="overflow-hidden rounded-lg border bg-card font-mono text-xs leading-5">
      <div className="flex items-start gap-3 px-3 py-2">
        <span className="min-w-0 flex-1 break-all whitespace-pre-wrap text-muted-foreground">$ {command}</span>
        {!!run && <ExitBadge run={run} />}
      </div>
      {!!run?.lines.length && (
        <pre className="max-h-64 overflow-auto border-t px-3 py-2">
          {run.lines.map((l, i) => (
            <div key={i} className={cn('min-h-5 break-all whitespace-pre-wrap', TONE[l.tone])}>
              {l.text}
            </div>
          ))}
        </pre>
      )}
    </div>
  );
}

function ThoughtRow({ entry }: { entry: ActivityEntry }) {
  const [isOpen, setOpen] = useState(false);
  return (
    <li className="flex flex-col">
      <button type="button" aria-expanded={isOpen} onClick={() => setOpen((o) => !o)} className="flex h-9 cursor-default items-center gap-2.5 pr-1 pl-3 text-left type-meta text-muted-foreground hover:bg-accent/60 hover:text-foreground">
        <span className="size-4 shrink-0" />
        <span className="flex-1">Thought for {entry.seconds ?? 1}s</span>
        <ChevronRight aria-hidden className={cn('size-3.5 shrink-0 text-subtle-foreground transition-transform duration-150', isOpen && 'rotate-90')} />
      </button>
      <Expand isOpen={isOpen}>
        <p className="px-3 pb-3 pl-9.5 type-meta text-pretty text-muted-foreground">{entry.text}</p>
      </Expand>
    </li>
  );
}
