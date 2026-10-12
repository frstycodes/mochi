import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotionConfig } from 'motion/react';
import { useTheme } from 'next-themes';
import { PatchDiff } from '@pierre/diffs/react';
import { FileIcon } from '@react-symbols/icons/utils';
import { Check, ChevronRight, Eye, Flag, Global, TerminalSquare, X } from 'reicon-react';
import { Spinner } from '@/components/ui/spinner';
import { Shimmer } from '@/components/ai-elements/shimmer';
import { cn } from '@/lib/utils';
import { AgentLoader, type AgentPhase } from './AgentLoader';
import { PATCHES, RUNS, type RunResult } from './fixtures';
import type { ActivityEntry } from './model';
import { clock } from './progress';
import { usePrefs } from './settings/prefs';
import { eventLine, isApprovalChatter, parseTool, turnSummary, type ToolCall } from './summary';
import { hostname, type CurrentAction } from './agentPhase';
import { openFromScope, useThreadFiles, type ThreadFiles } from './files/viewer';
import { TooltipIconButton } from './ui';
import { Favicon, WebFetchRow, WebSearchRow } from './WebLinks';

const EXPAND = { duration: 0.2, ease: [0.23, 1, 0.32, 1] } as const;

/** One agent turn's work, folded to a line like Claude's: while live the line names the current action and rolls to each new one; when the turn ends it settles into a summary. */
export function WorkLog({ entries, action }: { entries: ActivityEntry[]; action?: CurrentAction }) {
  const [isOpen, setOpen] = useState(false);
  const isLive = !!action;
  const calls = entries.filter((e) => e.kind === 'tool').map((e) => parseTool(e.text));
  const edits = calls.filter((c) => c.verb === 'Edit' || c.verb === 'Write');
  const failed = calls.filter((c) => c.verb === 'Run' && (RUNS[c.target]?.exitCode ?? 0) !== 0).length;
  const lastTool = entries.findLastIndex((e) => e.kind === 'tool');
  const title = action ? { key: `live:${action.label}`, value: action } : { key: 'done', value: turnSummary(entries) };
  const files = useThreadFiles();

  return (
    <div data-file-scope className="-mx-2 flex flex-col">
      <button
        type="button"
        aria-expanded={isOpen}
        onClick={() => setOpen((o) => !o)}
        className="group/log flex h-7 cursor-default items-center gap-2 rounded-lg px-2 text-left type-meta text-muted-foreground hover:bg-accent/60 hover:text-foreground"
      >
        <LeadIcon state={action?.isWaiting ? 'waiting' : isLive ? 'live' : 'done'} isOpen={isOpen} />
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
      </button>
      <Expand isOpen={isOpen}>
        <ol className="flex flex-col gap-0.5 pt-0.5 pl-5">
          {entries.map((e, i) => {
            if (e.kind === 'reasoning') return <ThoughtRow key={i} entry={e} />;
            // The live title says what it waits on; once answered, the call's own row is the record.
            if (e.kind === 'event' && isApprovalChatter(e.text)) return null;
            if (e.kind !== 'tool') return <EventRow key={i} entry={e} />;
            const call = parseTool(e.text);
            const isRunning = isLive && i === lastTool;
            if (call.verb === 'Search') return <WebSearchRow key={i} call={call} links={e.links} isRunning={isRunning} />;
            if (call.verb === 'Fetch') return <WebFetchRow key={i} call={call} links={e.links} isRunning={isRunning} />;
            return <ToolRow key={i} call={call} isRunning={isRunning} files={files} />;
          })}
        </ol>
      </Expand>
    </div>
  );
}

const ICON_SWAP = { initial: { opacity: 0, scale: 0.25, filter: 'blur(4px)' }, animate: { opacity: 1, scale: 1, filter: 'blur(0px)' }, exit: { opacity: 0, scale: 0.25, filter: 'blur(4px)' } };

/** The working spinner while live, the needs-you dot while paused on you (the chevron on hover for both, so it still reads as openable), the chevron once settled. */
function LeadIcon({ state, isOpen }: { state: 'live' | 'waiting' | 'done'; isOpen: boolean }) {
  const chevron = <ChevronRight className={cn('size-3.5 text-subtle-foreground transition-transform duration-150', isOpen && 'rotate-90')} />;
  return (
    <span className="grid size-3.5 shrink-0 place-items-center *:col-start-1 *:row-start-1">
      <AnimatePresence initial={false}>
        {state !== 'done' ? (
          <motion.span key={state} {...ICON_SWAP} transition={{ duration: 0.2 }} className="grid place-items-center *:col-start-1 *:row-start-1">
            {state === 'live' ? <Spinner className="size-3.5 text-muted-foreground group-hover/log:opacity-0" /> : <span aria-hidden className="size-1.5 rounded-full bg-warning group-hover/log:opacity-0" />}
            <span className="opacity-0 group-hover/log:opacity-100">{chevron}</span>
          </motion.span>
        ) : (
          <motion.span key="done" {...ICON_SWAP} transition={{ duration: 0.2 }} className="grid place-items-center">
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
    <li className="flex min-h-7 items-start gap-2 px-2 py-1 type-meta">
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

export function ToolRow({ call, isRunning, files }: { call: ToolCall; isRunning: boolean; files: ThreadFiles | null }) {
  const [isOpen, setOpen] = useState(false);
  const patch = PATCHES[call.target];
  const run = RUNS[call.target];
  const isLongCommand = call.verb === 'Run' && (call.target.includes('\n') || call.target.length > LONG_COMMAND);
  const detail = (call.verb === 'Edit' || call.verb === 'Write') && patch ? <DiffView patch={patch} /> : call.verb === 'Run' && (run || isLongCommand) ? <RunOutput command={call.target} run={run} /> : null;

  const row = (
    <>
      <ToolGlyph call={call} />
      <span className="shrink-0 text-subtle-foreground">{VERB_LABEL[call.verb]}</span>
      <ToolTarget call={call} />
      <span className="ml-auto flex shrink-0 items-center gap-2 pl-2">
        {call.added !== undefined && <DiffStat added={call.added} removed={call.removed ?? 0} withBar />}
        {call.verb === 'Run' && !isRunning && !!run && <ExitBadge run={run} />}
      </span>
    </>
  );

  const isFile = call.verb === 'Read' || call.verb === 'Edit' || call.verb === 'Write';

  return (
    <li className="group/tool flex flex-col">
      <div className="flex min-w-0 items-center gap-0.5">
        {detail ? (
          <button
            type="button"
            aria-expanded={isOpen}
            onClick={() => setOpen((o) => !o)}
            className="flex h-7 min-w-0 flex-1 cursor-default items-center gap-2 rounded-lg px-2 text-left type-meta hover:bg-accent/60"
          >
            {row}
          </button>
        ) : (
          <div className="flex h-7 min-w-0 flex-1 items-center gap-2 px-2 type-meta">{row}</div>
        )}
        {/* Keeps the stats column aligned with the file rows' open button. */}
        {!!files && !isFile && <span aria-hidden className="size-6 shrink-0" />}
        {!!files && isFile && (
          <TooltipIconButton
            label="Open in viewer"
            hint={call.target}
            data-file-link={call.target}
            onClick={(e) => openFromScope(e.currentTarget, files)}
            className="opacity-0 group-hover/tool:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
          >
            <Eye />
          </TooltipIconButton>
        )}
      </div>
      {!!detail && (
        <Expand isOpen={isOpen}>
          <div className="pt-1 pb-2">{detail}</div>
        </Expand>
      )}
    </li>
  );
}

const VERB_LABEL = { Read: 'Read', Edit: 'Edited', Write: 'Created', Run: 'Ran', Browser: 'Opened', Search: 'Searched', Fetch: 'Read' } satisfies Record<ToolCall['verb'], string>;

// Past this many characters a command row expands to show the whole command.
const LONG_COMMAND = 80;

function ToolGlyph({ call }: { call: ToolCall }) {
  if (call.verb === 'Run') return <TerminalSquare className="size-4 shrink-0 text-muted-foreground" />;
  if (call.verb === 'Browser') return <Global className="size-4 shrink-0 text-muted-foreground" />;
  return <FileIcon fileName={call.target.split('/').pop() ?? call.target} autoAssign aria-hidden className="size-4 shrink-0" />;
}

function ToolTarget({ call }: { call: ToolCall }) {
  if (call.verb === 'Run') return <code className="min-w-0 truncate font-mono text-xs text-foreground" title={call.target}>{call.target}</code>;
  const slash = call.target.lastIndexOf('/');
  return (
    <span className="flex min-w-0 font-mono text-xs" title={call.target}>
      <span className="truncate text-subtle-foreground">{call.target.slice(0, slash + 1)}</span>
      <span className="shrink-0 text-foreground">{call.target.slice(slash + 1)}</span>
    </span>
  );
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
      {ok ? seconds(run.ms) : `exit ${run.exitCode}`}
    </span>
  );
}

function seconds(ms: number) {
  return ms < 60_000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

export function DiffView({ patch }: { patch: string }) {
  const { resolvedTheme } = useTheme();
  const { diffStyle } = usePrefs();
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <PatchDiff
        patch={patch}
        disableWorkerPool
        options={{ diffStyle, disableFileHeader: true, overflow: 'scroll', themeType: resolvedTheme === 'light' ? 'light' : 'dark' }}
        style={{ '--diffs-font-family': 'var(--font-mono)', '--diffs-font-size': '12px', '--diffs-line-height': '20px' } as React.CSSProperties}
        className="max-h-80 overflow-auto"
      />
    </div>
  );
}

const TONE = { plain: 'text-foreground', dim: 'text-subtle-foreground', pass: 'text-success', fail: 'text-destructive' } satisfies Record<RunResult['lines'][number]['tone'], string>;

function RunOutput({ command, run }: { command: string; run?: RunResult }) {
  return (
    <pre className="max-h-64 overflow-auto rounded-xl border bg-card px-3 py-2.5 font-mono text-xs leading-5">
      <div className="break-all whitespace-pre-wrap text-muted-foreground">$ {command}</div>
      {run?.lines.map((l, i) => (
        <div key={i} className={cn('min-h-5', TONE[l.tone])}>
          {l.text}
        </div>
      ))}
    </pre>
  );
}

function ThoughtRow({ entry }: { entry: ActivityEntry }) {
  const [isOpen, setOpen] = useState(false);
  return (
    <li className="flex flex-col">
      <button type="button" aria-expanded={isOpen} onClick={() => setOpen((o) => !o)} className="flex h-7 cursor-default items-center gap-2 rounded-lg px-2 text-left type-meta text-subtle-foreground hover:bg-accent/60 hover:text-muted-foreground">
        <span className="size-4 shrink-0" />
        Thought for {entry.seconds ?? 1}s
      </button>
      <Expand isOpen={isOpen}>
        <p className="pt-0.5 pr-2 pb-2 pl-8 type-meta text-muted-foreground text-pretty">{entry.text}</p>
      </Expand>
    </li>
  );
}
