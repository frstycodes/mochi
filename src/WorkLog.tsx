import { useState, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotionConfig } from 'motion/react';
import { useTheme } from 'next-themes';
import { PatchDiff } from '@pierre/diffs/react';
import { FileIcon } from '@react-symbols/icons/utils';
import { Check, ChevronRight, Eye, Global, TerminalSquare, X } from 'reicon-react';
import { Shimmer } from '@/components/ai-elements/shimmer';
import { cn } from '@/lib/utils';
import { AgentLoader, type AgentPhase } from './AgentLoader';
import { PATCHES, RUNS, type RunResult } from './fixtures';
import type { ActivityEntry } from './model';
import { duration } from './progress';
import { usePrefs } from './settings/prefs';
import { parseTool, type ToolCall } from './summary';
import { toolLabel } from './agentPhase';
import { openFromScope, useThreadFiles, type ThreadFiles } from './files/viewer';
import { TooltipIconButton } from './ui';

const EXPAND = { duration: 0.2, ease: [0.23, 1, 0.32, 1] } as const;

/** A run of tool calls and reasoning between two messages, collapsed to one line like Codex's "Worked for". */
export function WorkLog({ entries, isLive }: { entries: ActivityEntry[]; isLive: boolean }) {
  const [isOpen, setOpen] = useState(false);
  const calls = entries.filter((e) => e.kind === 'tool').map((e) => parseTool(e.text));
  const edits = calls.filter((c) => c.verb === 'Edit' || c.verb === 'Write');
  const runs = calls.filter((c) => c.verb === 'Run');
  const failed = runs.filter((c) => (RUNS[c.target]?.exitCode ?? 0) !== 0).length;
  const minutes = Math.max(1, entries[entries.length - 1].at - entries[0].at);
  const current = calls[calls.length - 1];
  const files = useThreadFiles();

  return (
    <div data-file-scope className="-mx-2 flex flex-col">
      <button
        type="button"
        aria-expanded={isOpen}
        onClick={() => setOpen((o) => !o)}
        className="group/log flex h-7 cursor-default items-center gap-2 rounded-lg px-2 text-left type-meta text-muted-foreground hover:bg-accent/60 hover:text-foreground"
      >
        <ChevronRight className={cn('size-3.5 shrink-0 text-subtle-foreground transition-transform duration-150', isOpen && 'rotate-90')} />
        {isLive && current ? (
          <Shimmer as="span" className="shrink-0">{toolLabel(current)}</Shimmer>
        ) : (
          <span className="shrink-0">Worked for {duration(minutes)}</span>
        )}
        <span className="flex min-w-0 items-center gap-3 truncate text-subtle-foreground">
          {edits.length > 0 && (
            <span className="flex items-center gap-1.5">
              <FileStack paths={edits.map((c) => c.target)} />
              <DiffStat added={sum(edits, 'added')} removed={sum(edits, 'removed')} />
            </span>
          )}
          {runs.length > 0 && (
            <span className="flex items-center gap-1">
              <TerminalSquare className="size-3.5" />
              <span className="tabular">{runs.length}</span>
            </span>
          )}
          {failed > 0 && <span className="tabular text-destructive">{failed} failed</span>}
        </span>
      </button>
      <Expand isOpen={isOpen}>
        <ol className="flex flex-col gap-0.5 pt-0.5 pl-5">
          {entries.map((e, i) =>
            e.kind === 'reasoning' ? (
              <ThoughtRow key={i} entry={e} />
            ) : (
              <ToolRow key={i} call={parseTool(e.text)} isRunning={isLive && i === entries.length - 1} files={files} />
            ),
          )}
        </ol>
      </Expand>
    </div>
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

function ToolRow({ call, isRunning, files }: { call: ToolCall; isRunning: boolean; files: ThreadFiles | null }) {
  const [isOpen, setOpen] = useState(false);
  const patch = PATCHES[call.target];
  const run = RUNS[call.target];
  const detail = (call.verb === 'Edit' || call.verb === 'Write') && patch ? <DiffView patch={patch} /> : call.verb === 'Run' && run ? <RunOutput run={run} /> : null;

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

const VERB_LABEL = { Read: 'Read', Edit: 'Edited', Write: 'Created', Run: 'Ran', Browser: 'Opened' } satisfies Record<ToolCall['verb'], string>;

function ToolGlyph({ call }: { call: ToolCall }) {
  if (call.verb === 'Run') return <TerminalSquare className="size-4 shrink-0 text-muted-foreground" />;
  if (call.verb === 'Browser') return <Global className="size-4 shrink-0 text-muted-foreground" />;
  return <FileIcon fileName={call.target.split('/').pop() ?? call.target} autoAssign aria-hidden className="size-4 shrink-0" />;
}

function ToolTarget({ call }: { call: ToolCall }) {
  if (call.verb === 'Run') return <code className="min-w-0 truncate font-mono text-xs text-foreground">{call.target}</code>;
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

function DiffView({ patch }: { patch: string }) {
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

function RunOutput({ run }: { run: RunResult }) {
  return (
    <pre className="max-h-64 overflow-auto rounded-xl border bg-card px-3 py-2.5 font-mono text-xs leading-5">
      {run.lines.map((l, i) => (
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
