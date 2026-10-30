import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from 'react';
import { AnimatePresence, motion, useReducedMotionConfig } from 'motion/react';
import { ErrorBoundary } from 'react-error-boundary';
import { File, PatchDiff } from './files/Diffs';
import { FileIcon } from '@react-symbols/icons/utils';
import {
  Check,
  ChevronRight,
  Flag,
  Globe,
  GlobeSearch,
  Note,
  Terminal,
  X,
} from '@/icons';
import { Shimmer } from '@/components/ai-elements/shimmer';
import { ErrorFallback } from '@/components/ErrorFallback';
import { cn } from '@/lib/utils';
import { AgentLoader, type AgentPhase } from './AgentLoader';
import { PATCHES, RUNS, type RunResult } from './fixtures';
import type { ActivityEntry, AgentCommand, WebLink } from './model';
import { clock, formatElapsed } from './progress';
import { fileCount } from './summarySections';
import { usePrefs } from './settings/prefs';
import {
  eventLine,
  isApprovalChatter,
  parseTool,
  toolCall,
  turnSummary,
  type ToolCall,
} from './summary';
import { hostname, type CurrentAction } from './agentPhase';
import {
  loadViewerFile,
  openFiles,
  useThreadFiles,
  type ThreadFiles,
} from './files/viewer';
import { fileAt } from './files/fileAt';
import { usePaneOpeners } from './terminal/usePaneOpeners';
import { useVizThreadId } from './viz/WidgetVisual';
import { fileLink } from './terminal/links';
import { describeCall } from './chat/describe';
import { McpIcon, SkillMark } from './chat/McpIcon';
import { useLibraryNames } from './library/names';
import { PREVIEW_KINDS } from './files/kinds';
import { patchSections } from './chat/turnChanges';
import { outputLines } from './chat/output';
import { Favicon, LinkList, LinkRow } from './WebLinks';
import { isSendCall } from './chat/threadMessages';
import {
  ThreadMessageBody,
  ThreadMessageIcon,
  ThreadMessageLine,
} from './chat/ThreadMessage';
import { ICON_SWAP } from './ui';
import { MessageImages } from './chat/MessageImages';
import { isFilePath, revealFile, useImageUrls } from './chat/imageSrc';
import { openPhotos } from './photo/photos';

const EXPAND = { duration: 0.2, ease: [0.23, 1, 0.32, 1] } as const;

/**
 * One work group (the calls between two messages), folded to a line like Claude's: while live the line names the current
 * action and rolls to each new one; once done it settles into a summary. Open, it lists each call as a plain sentence
 * that opens in place to its command and output, diff, results or file. `skills` describe the skills the group used.
 */
export function WorkLog({
  entries,
  skills = [],
  action,
}: {
  entries: ActivityEntry[];
  skills?: AgentCommand[];
  action?: CurrentAction;
}) {
  const [isOpen, setOpen] = useState(false);
  useLibraryNames();
  const isLive = !!action;
  const tools = entries.filter((e) => e.kind === 'tool');
  const edits = tools
    .map(toolCall)
    .filter((c) => c.verb === 'Edit' || c.verb === 'Write');
  const failed = tools.filter((e) => (runOf(e)?.exitCode ?? 0) !== 0).length;
  const lastTool = entries.findLastIndex((e) => e.kind === 'tool');
  const title = action
    ? { key: `live:${action.label}`, value: action }
    : { key: 'done', value: turnSummary(entries) };
  const files = useWorkLogFiles();
  const images = [
    ...new Set(
      tools.flatMap((e) => [...(e.images ?? []), ...readImage(toolCall(e))]),
    ),
  ].slice(0, THUMBS_SHOWN);

  return (
    <div className="-mx-2 flex flex-col">
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
              <motion.span
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.2, delay: 0.12 }}
                className="flex shrink-0 items-center gap-3 text-subtle-foreground"
              >
                {edits.length > 0 && (
                  <span className="flex items-center gap-1.5">
                    <FileStack paths={edits.map((c) => c.target)} />
                    <DiffStat
                      added={sum(edits, 'added')}
                      removed={sum(edits, 'removed')}
                    />
                  </span>
                )}
                {failed > 0 && (
                  <span className="tabular text-destructive">
                    {failed} failed
                  </span>
                )}
              </motion.span>
            )}
          </AnimatePresence>
          <TrailIcon isWaiting={!!action?.isWaiting} isOpen={isOpen} />
        </button>
        {/* Folded, the images it looked at stay in view like Claude's; open, each Read row shows its own. */}
        <AnimatePresence initial={false}>
          {!isOpen && !!files && images.length > 0 && (
            <motion.span
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="ml-auto flex shrink-0 items-center gap-1 pr-2"
            >
              <ImageThumbs files={files} paths={images} />
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
            const call = parseTool(e.text);
            if (call.verb === 'Skill')
              return (
                <SkillRow
                  key={i}
                  name={call.target}
                  description={
                    skills.find((s) => s.name === call.target)?.description
                  }
                />
              );
            return (
              <ErrorBoundary
                key={i}
                fallbackRender={(props) => (
                  <li className="p-2">
                    <ErrorFallback {...props} />
                  </li>
                )}
              >
                <CallRow
                  entry={e}
                  isRunning={isLive && i === lastTool}
                  files={files}
                />
              </ErrorBoundary>
            );
          })}
        </CallList>
      </Expand>
    </div>
  );
}

// A folderless chat's folder isn't known here (main makes it and doesn't say), but a file the agent read by absolute path
// still loads from its own folder (`fileAt`); a relative one fails to load and says so.
function useWorkLogFiles(): ThreadFiles {
  const threadId = useVizThreadId();
  const files = useThreadFiles();
  // Stable, like `useThreadFiles`: the image loaders' effects key on it.
  return files ?? { threadId, root: '' };
}

/** The bordered list of calls: an open work group, a subagent's log. Inside border: an outside ring would be cut off by an expander's clip. */
export function CallList({ className, ...props }: ComponentProps<'ol'>) {
  return (
    <ol
      className={cn(
        // Inside a card the list turns into a filled well, so it never draws a second outline within the card's.
        'flex flex-col divide-y overflow-hidden rounded-xl border in-data-[slot=card]:divide-y-0 in-data-[slot=card]:rounded-lg in-data-[slot=card]:border-0 in-data-[slot=card]:bg-foreground/5',
        className,
      )}
      {...props}
    />
  );
}

/** What a row needs from a call, whether the thread's own (`ActivityEntry`) or a subagent's (`SubagentStep`). */
type ToolEntry = Pick<
  ActivityEntry,
  | 'text'
  | 'description'
  | 'output'
  | 'exitCode'
  | 'patch'
  | 'files'
  | 'links'
  | 'mcp'
  | 'sent'
  | 'images'
>;

/** One call: what it did in words, opening in place to the detail behind it. */
export function CallRow({
  entry,
  isRunning,
  files,
}: {
  entry: ToolEntry;
  isRunning: boolean;
  files: ThreadFiles | null;
}) {
  const [isOpen, setOpen] = useState(false);
  useLibraryNames();
  const call = toolCall(entry);
  const run = runOf(entry);
  const detail = callDetail(entry, call, files);
  const description = describeCall(entry);
  const changed = call.verb === 'Run' ? (entry.files ?? []) : [];
  if (import.meta.env.DEV && entry.text.includes(DEV_THROW))
    throw new Error(
      `Dev-only test card: a tool call containing ${DEV_THROW} throws`,
    );

  return (
    <li className="flex flex-col">
      {/* One toggle stretched under the row; the file name sits above it as its own link. */}
      <div
        className={cn(
          'relative isolate flex h-9 min-w-0 items-center gap-2.5 px-3 type-meta',
          !!detail && 'hover:bg-accent/60',
        )}
      >
        {!!detail && (
          <button
            type="button"
            aria-expanded={isOpen}
            aria-label={description}
            onClick={() => setOpen((o) => !o)}
            className="absolute inset-0 cursor-default focus-visible:outline-2 focus-visible:-outline-offset-2"
          />
        )}
        {isSendCall(entry) ? (
          <ThreadMessageIcon direction="to" />
        ) : (
          <CallGlyph call={call} links={entry.links} />
        )}
        {isSendCall(entry) ? (
          <span className="flex min-w-0 flex-1 text-foreground">
            <ThreadMessageLine
              direction="to"
              peer={entry.sent}
              text={entry.sent?.text}
            />
          </span>
        ) : isRunning ? (
          <Shimmer
            as="span"
            className="pointer-events-none min-w-0 flex-1 truncate"
          >
            {description}
          </Shimmer>
        ) : (
          <CallText
            call={call}
            description={description}
            hasOwnDescription={!!entry.description}
            files={files}
          />
        )}
        {call.added !== undefined && (
          <DiffStat added={call.added} removed={call.removed ?? 0} withBar />
        )}
        {changed.length > 0 && (
          <span
            title={changed.join('\n')}
            className="shrink-0 text-xs tabular text-muted-foreground"
          >
            changed {fileCount(changed.length)}
          </span>
        )}
        {!isRunning && !!run && run.exitCode !== 0 && (
          <span className="shrink-0 font-mono text-xs tabular text-destructive">
            exit {run.exitCode}
          </span>
        )}
        {/* Rows with nothing to open keep the chevron's width, so stats line up. */}
        {detail ? (
          <ChevronRight
            aria-hidden
            className={cn(
              'size-3.5 shrink-0 text-subtle-foreground transition-transform duration-150',
              isOpen && 'rotate-90',
            )}
          />
        ) : (
          <span aria-hidden className="size-3.5 shrink-0" />
        )}
      </div>
      {!!detail && (
        <Expand isOpen={isOpen}>
          <div className="px-3 pb-3">{detail}</div>
        </Expand>
      )}
    </li>
  );
}

// Dev builds only: a call whose text contains this (`echo mochi-dev-throw`) crashes its own card, to check the card's error boundary.
const DEV_THROW = 'mochi-dev-throw';

/** The row's sentence; for a file call ("Edited redis.ts") the name is a link that opens the file in the side pane's Files tab. */
function CallText({
  call,
  description,
  hasOwnDescription,
  files,
}: {
  call: ToolCall;
  description: string;
  hasOwnDescription: boolean;
  files: ThreadFiles | null;
}) {
  const openCallFile = useOpenCallFile(useVizThreadId());
  const name = call.target.split('/').pop() ?? call.target;
  const isFileLink =
    !!files &&
    !hasOwnDescription &&
    (call.verb === 'Read' || call.verb === 'Edit' || call.verb === 'Write') &&
    description.endsWith(name);
  const raw =
    call.verb === 'Run' || call.verb === 'Mcp' ? call.target : undefined;
  if (!isFileLink)
    return (
      <span className="min-w-0 flex-1 truncate text-foreground" title={raw}>
        {description}
      </span>
    );
  return (
    <span className="min-w-0 flex-1 truncate text-foreground">
      {description.slice(0, -name.length)}
      <button
        type="button"
        title={call.target}
        onClick={() => openCallFile(files, call.target)}
        className="relative z-10 cursor-pointer underline-offset-2 hover:underline focus-visible:underline"
      >
        {name}
      </button>
    </span>
  );
}

/** What a call opens to: the command and its output, the edit's diff, the file it read, the pages a search returned. */
function callDetail(
  entry: ToolEntry,
  call: ToolCall,
  files: ThreadFiles | null,
): ReactNode {
  if (entry.sent)
    return (
      <ThreadMessageBody text={entry.sent.text}>
        Delivered to {entry.sent.title}
      </ThreadMessageBody>
    );
  // Saved under a content hash, so the file name says nothing; the viewer titles them by order.
  if (entry.images?.length)
    return (
      <MessageImages
        photos={entry.images.map((src, i) => ({ src, name: `Image ${i + 1}` }))}
      />
    );
  if (call.verb === 'Run')
    return <RunOutput command={call.target} run={runOf(entry)} />;
  if (call.verb === 'Edit' || call.verb === 'Write') {
    const patch = entry.patch ?? PATCHES[call.target];
    return patch ? <DiffView patch={patch} /> : null;
  }
  if (call.verb === 'Read' && files)
    return isImage(call.target) ? (
      <MessageImages
        photos={[
          {
            src: absolutePath(files, call.target),
            name: call.target.split('/').pop()!,
          },
        ]}
      />
    ) : (
      <FilePreview files={files} path={call.target} />
    );
  if (call.verb === 'Search')
    return entry.links?.length ? <LinkList links={entry.links} /> : null;
  if (call.verb === 'Fetch')
    return <LinkRow link={entry.links?.[0] ?? { url: call.target }} />;
  return null;
}

/** A live call's output and exit code, or the demo's scripted run for the same command. */
function runOf(entry: ToolEntry): RunResult | undefined {
  const call = parseTool(entry.text);
  if (call.verb !== 'Run') return undefined;
  if (entry.output === undefined && entry.exitCode === undefined)
    return RUNS[call.target];
  return {
    exitCode: entry.exitCode ?? 0,
    lines: outputLines(entry.output ?? ''),
  };
}

function CallGlyph({
  call,
  links = [],
}: {
  call: ToolCall;
  links?: WebLink[];
}) {
  if (call.verb === 'Search') {
    const hosts = [...new Set(links.map((l) => hostname(l.url)))].slice(0, 3);
    if (!hosts.length)
      return <GlobeSearch className="size-4 shrink-0 text-muted-foreground" />;
    return (
      <span className="flex shrink-0 items-center">
        {hosts.map((host, i) => (
          <span
            key={host}
            className={cn(
              'rounded-full bg-background ring-2 ring-background',
              i > 0 && '-ml-1.5',
            )}
          >
            <Favicon host={host} />
          </span>
        ))}
      </span>
    );
  }
  if (call.verb === 'Fetch')
    return <Favicon host={hostname(links[0]?.url ?? call.target)} />;
  return <ToolGlyph call={call} />;
}

/** The first lines of a file the agent read, highlighted like the viewer; the whole file opens in the viewer. */
function FilePreview({ files, path }: { files: ThreadFiles; path: string }) {
  const [state, setState] = useState<{ text?: string; error?: string }>({});
  useEffect(() => {
    let isCurrent = true;
    loadViewerFile({
      source: 'workspace',
      ...fileAt(files, fileLink(path).path),
    }).then(
      (content) =>
        isCurrent &&
        setState(
          content.kind === 'text'
            ? { text: content.text }
            : { error: 'Binary file' },
        ),
      (e: Error) => isCurrent && setState({ error: e.message }),
    );
    return () => void (isCurrent = false);
  }, [files, path]);
  if (state.error)
    return <p className="type-caption text-subtle-foreground">{state.error}</p>;
  if (state.text === undefined)
    return <p className="type-caption text-subtle-foreground">Loading…</p>;
  const lines = state.text.split('\n');
  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <File
        file={{
          name: path.split('/').pop() ?? path,
          contents: lines.slice(0, PREVIEW_LINES).join('\n'),
        }}
        disableWorkerPool
        options={{ disableFileHeader: true, overflow: 'scroll' }}
        style={DIFF_STYLE}
        className="max-h-64 overflow-auto"
      />
      {lines.length > PREVIEW_LINES && (
        <p className="border-t px-3 py-1.5 type-caption text-subtle-foreground">
          {lines.length - PREVIEW_LINES} more lines
        </p>
      )}
    </div>
  );
}

const PREVIEW_LINES = 40;

/** Inside the thread's folder a file opens in the side pane's Files tab; outside it, which that tab can't browse, in the viewer. */
function useOpenCallFile(threadId: string) {
  const { openFile } = usePaneOpeners(threadId);
  return (files: ThreadFiles, path: string) => {
    const at = fileAt(files, path);
    if (at.root === files.root) return openFile(at.path);
    openFiles({
      files: [{ source: 'workspace', ...at, ...fileLink(at.path) }],
      index: 0,
    });
  };
}
const THUMBS_SHOWN = 3;

const isImage = (path: string) =>
  PREVIEW_KINDS.image.test(path) || PREVIEW_KINDS.svg.test(path);
const readImage = (call: ToolCall) =>
  call.verb === 'Read' && isImage(call.target) ? [call.target] : [];
// A Read's target is relative to the thread's folder when inside it; a returned image is already absolute (or a URL).
const absolutePath = (files: ThreadFiles, path: string) =>
  !isFilePath(path) || path.startsWith('/') || !files.root
    ? path
    : `${files.root}/${path}`;

/** The images the agent read or captured, small, opening together in the photo viewer. */
function ImageThumbs({
  files,
  paths,
}: {
  files: ThreadFiles;
  paths: string[];
}) {
  const srcs = paths.map((path) => absolutePath(files, path));
  const urls = useImageUrls(srcs);
  // Images that couldn't be read stay out of the viewer; the index counts only the ones before `i` that it shows.
  const open = (i: number) => {
    const photos = srcs.flatMap((src, j) =>
      urls[j]
        ? [
            {
              src: urls[j]!,
              name: imageName(src),
              ...(isFilePath(src) && { reveal: () => void revealFile(src) }),
            },
          ]
        : [],
    );
    openPhotos({ photos, index: urls.slice(0, i).filter(Boolean).length });
  };
  return srcs.map((src, i) => (
    <button
      key={src}
      type="button"
      aria-label={`View ${imageName(src)}`}
      disabled={!urls[i]}
      onClick={() => open(i)}
      className="relative h-6 w-9 shrink-0 cursor-zoom-in overflow-hidden rounded-md bg-muted after:absolute after:inset-0 after:rounded-[inherit] after:shadow-[inset_0_0_0_1px_rgb(0_0_0/0.08)] focus-visible:outline-2 focus-visible:outline-offset-2 dark:after:shadow-[inset_0_0_0_1px_rgb(255_255_255/0.08)]"
    >
      {!!urls[i] && (
        <img src={urls[i]!} alt="" className="size-full object-cover" />
      )}
    </button>
  ));
}

// A captured screenshot arrives as a data URL, whose base64 can hold slashes.
const imageName = (src: string) =>
  isFilePath(src) ? (src.split('/').pop() ?? src) : 'Screenshot';

/** After the title, so it sits flush with the prose like Claude's: the chevron, or the needs-you dot while paused on you (the chevron on hover, so it still reads as openable). Working needs no icon: Mochi under the chat and the shimmering title say it. */
export function TrailIcon({
  isWaiting,
  isOpen,
}: {
  isWaiting: boolean;
  isOpen: boolean;
}) {
  const chevron = (
    <ChevronRight
      className={cn(
        'size-3 text-subtle-foreground transition-transform duration-150',
        isOpen && 'rotate-90',
      )}
    />
  );
  return (
    <span className="grid size-3 shrink-0 place-items-center *:col-start-1 *:row-start-1">
      <AnimatePresence initial={false}>
        {isWaiting ? (
          <motion.span
            key="waiting"
            {...ICON_SWAP}
            className="grid place-items-center *:col-start-1 *:row-start-1"
          >
            <span
              aria-hidden
              className="size-1.5 rounded-full bg-warning group-hover/log:opacity-0"
            />
            <span className="opacity-0 group-hover/log:opacity-100">
              {chevron}
            </span>
          </motion.span>
        ) : (
          <motion.span
            key="chevron"
            {...ICON_SWAP}
            className="grid place-items-center"
          >
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
    const ro = new ResizeObserver(([e]) =>
      setWidth(Math.ceil(e.borderBoxSize[0].inlineSize)),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const roll = reduce
    ? {
        initial: { opacity: 0 },
        animate: { opacity: 1, transition: ROLL },
        exit: { opacity: 0, transition: ROLL_OUT },
      }
    : {
        initial: {
          opacity: 0,
          transform: 'translateY(100%)',
          filter: 'blur(3px)',
        },
        animate: {
          opacity: 1,
          transform: 'translateY(0%)',
          filter: 'blur(0px)',
          transition: ROLL,
        },
        exit: {
          opacity: 0,
          transform: 'translateY(-100%)',
          filter: 'blur(3px)',
          transition: ROLL_OUT,
        },
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
      <span
        ref={measure}
        aria-hidden
        className="invisible absolute top-0 left-0 flex items-center gap-1.5 whitespace-nowrap"
      >
        <TitleContent value={shown.value} />
      </span>
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={shown.key}
          {...roll}
          className="flex h-5 max-w-full min-w-0 items-center gap-1.5 whitespace-nowrap"
        >
          <TitleContent value={shown.value} />
        </motion.span>
      </AnimatePresence>
    </motion.span>
  );
}

function TitleContent({ value }: { value: CurrentAction | string }) {
  if (typeof value === 'string')
    return <span className="min-w-0 truncate">{value}</span>;
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

/** Favicons of the pages a search returned (stacked, each fading in as it arrives), the read page's, the file's type icon, or a skill's or MCP server's glyph. */
function ActionIcon({ action }: { action: CurrentAction }) {
  const { call, links = [] } = action;
  if (!call) return null;
  if (call.verb === 'Search' || call.verb === 'Fetch') {
    const hosts = [
      ...new Set(
        (call.verb === 'Fetch' && !links.length
          ? [{ url: call.target }]
          : links
        ).map((l) => hostname(l.url)),
      ),
    ].slice(0, FAVICONS_SHOWN);
    if (!hosts.length) return null;
    return (
      <span className="flex shrink-0 items-center">
        <AnimatePresence initial={false}>
          {hosts.map((host, i) => (
            <motion.span
              key={host}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.2, delay: i * 0.05 }}
              className={cn(
                'rounded-full bg-background ring-2 ring-background',
                i > 0 && '-ml-1.5',
              )}
            >
              <Favicon host={host} />
            </motion.span>
          ))}
        </AnimatePresence>
      </span>
    );
  }
  if (call.verb === 'Read' || call.verb === 'Edit' || call.verb === 'Write')
    return (
      <FileIcon
        fileName={call.target.split('/').pop() ?? call.target}
        autoAssign
        aria-hidden
        className="size-3.5 shrink-0"
      />
    );
  if (call.verb === 'Skill')
    return (
      <SkillMark
        skill={call.target}
        className="size-3.5"
        fallback={<Note aria-hidden className="size-3.5 shrink-0 text-info" />}
      />
    );
  if (call.verb === 'Mcp')
    return <McpIcon target={call.target} className="size-3.5" />;
  return null;
}

/**
 * The title on screen: a new key waits until the current one has been up `dwell` ms, then the latest pending one shows,
 * so a burst never queues a backlog. The same key passes its fresh value straight through (favicons arriving).
 */
function useDwell(title: Title, dwell: number): Title {
  const [shown, setShown] = useState(title);
  const shownAt = useRef(0);
  const show = useEffectEvent(() => {
    shownAt.current = performance.now();
    setShown(title);
  });
  useEffect(() => {
    if (title.key === shown.key) return;
    const wait = shownAt.current + dwell - performance.now();
    if (wait <= 0) return show();
    const t = window.setTimeout(() => show(), wait);
    return () => window.clearTimeout(t);
  }, [title.key, shown.key, dwell]);
  return title.key === shown.key ? title : shown;
}

/** A harness event inside the turn, such as a denied call. */
function EventRow({ entry }: { entry: ActivityEntry }) {
  const line = eventLine(entry.text);
  return (
    <li className="flex min-h-9 items-start gap-2.5 px-3 py-2 type-meta">
      {line.startsWith('Denied') ? (
        <X className="mt-0.5 size-4 shrink-0 text-destructive" />
      ) : (
        <Flag className="mt-0.5 size-4 shrink-0 text-subtle-foreground" />
      )}
      <span className="min-w-0 text-pretty text-muted-foreground">
        {line}
        <span className="whitespace-nowrap tabular text-subtle-foreground">
          {' '}
          · {clock(entry.at)}
        </span>
      </span>
    </li>
  );
}

/** Mochi at the end of the chat, always there: one instance, so it idles and then acts out whatever the agent does next. Before the agent's first output it also says what it's waiting on. */
export function ChatMochi({
  phase,
  label,
}: {
  phase: AgentPhase;
  label?: string;
}) {
  return (
    // -mt-4 pulls it up into the transcript's 20px row gap: it belongs to the last message, not a row of its own.
    <div
      role="status"
      className="-mt-4 flex h-9 items-center gap-1.5 type-meta text-muted-foreground"
    >
      <AgentLoader phase={phase} className="-ml-2 size-9 text-foreground" />
      {!!label && (
        <Shimmer as="span">{label.endsWith('…') ? label : `${label}…`}</Shimmer>
      )}
    </div>
  );
}

function sum(calls: ToolCall[], key: 'added' | 'removed') {
  return calls.reduce((n, c) => n + (c[key] ?? 0), 0);
}

export function Expand({
  isOpen,
  children,
}: {
  isOpen: boolean;
  children: ReactNode;
}) {
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

/** A skill the agent loaded: its name in the resolved-token colour and what it is for. */
function SkillRow({
  name,
  description,
}: {
  name: string;
  description?: string;
}) {
  const { title } = useLibraryNames().skill(name);
  return (
    <li className="flex h-9 min-w-0 items-center gap-2.5 px-3 type-meta">
      <SkillMark
        skill={name}
        fallback={<Note className="size-4 shrink-0 text-info" aria-hidden />}
      />
      <span className="shrink-0 text-subtle-foreground">Using skill</span>
      <span className="shrink-0 font-medium text-info" title={name}>
        {title}
      </span>
      {!!description && (
        <span
          className="min-w-0 truncate text-muted-foreground"
          title={description}
        >
          {description}
        </span>
      )}
    </li>
  );
}

function ToolGlyph({ call }: { call: ToolCall }) {
  if (call.verb === 'Run')
    return <Terminal className="size-4 shrink-0 text-muted-foreground" />;
  if (call.verb === 'Browser')
    return <Globe className="size-4 shrink-0 text-muted-foreground" />;
  if (call.verb === 'Mcp')
    return <McpIcon target={call.target} className="size-4" />;
  return (
    <FileIcon
      fileName={call.target.split('/').pop() ?? call.target}
      autoAssign
      aria-hidden
      className="size-4 shrink-0"
    />
  );
}

export function DiffStat({
  added,
  removed,
  withBar,
}: {
  added: number;
  removed: number;
  withBar?: boolean;
}) {
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
        <span
          key={i}
          className={cn(
            'size-1.5 rounded-xs',
            i < green
              ? 'bg-success'
              : i < green + red
                ? 'bg-destructive'
                : 'bg-muted-foreground/25',
          )}
        />
      ))}
    </span>
  );
}

function FileStack({ paths }: { paths: string[] }) {
  const unique = [...new Set(paths)];
  return (
    <span className="flex items-center" aria-label={`${unique.length} files`}>
      {unique.slice(0, 3).map((p, i) => (
        <FileIcon
          key={p}
          fileName={p.split('/').pop() ?? p}
          autoAssign
          aria-hidden
          className={cn(
            'size-3.5 rounded-xs bg-background ring-2 ring-background',
            i > 0 && '-ml-1',
          )}
        />
      ))}
    </span>
  );
}

function ExitBadge({ run }: { run: RunResult }) {
  const ok = run.exitCode === 0;
  return (
    <span
      className={cn(
        'flex items-center gap-1 font-mono text-xs tabular',
        ok ? 'text-subtle-foreground' : 'text-destructive',
      )}
    >
      {ok ? (
        <Check className="size-3.5 text-success" />
      ) : (
        <X className="size-3.5" />
      )}
      {ok
        ? run.ms === undefined
          ? 'exit 0'
          : formatElapsed(run.ms, 'precise')
        : `exit ${run.exitCode}`}
    </span>
  );
}

const DIFF_STYLE = {
  '--diffs-font-family': 'var(--font-mono)',
  '--diffs-font-size': 'var(--code-font-size, 12px)',
  '--diffs-line-height': '20px',
} as React.CSSProperties;

/** One bordered diff per file in the patch. */
export function DiffView({ patch }: { patch: string }) {
  const { diffStyle } = usePrefs();
  return (
    <div className="flex flex-col gap-2">
      {patchSections(patch).map((section, i) => (
        <div key={i} className="overflow-hidden rounded-lg border bg-card">
          <PatchDiff
            patch={section}
            disableWorkerPool
            options={{ diffStyle, disableFileHeader: true, overflow: 'scroll' }}
            style={DIFF_STYLE}
            className="max-h-80 overflow-auto"
          />
        </div>
      ))}
    </div>
  );
}

const TONE = {
  plain: 'text-foreground',
  dim: 'text-subtle-foreground',
  pass: 'text-success',
  fail: 'text-destructive',
} satisfies Record<RunResult['lines'][number]['tone'], string>;

/** The command, its exit badge (once it has an exit code), then its output in colour; `isFull` lets the output run its whole length instead of scrolling inside. */
export function RunOutput({
  command,
  run,
  isFull = false,
}: {
  command: string;
  run?: RunResult | Pick<RunResult, 'lines'>;
  isFull?: boolean;
}) {
  return (
    <div className="overflow-hidden rounded-lg border bg-card font-mono text-xs leading-5">
      <div className="flex items-start gap-3 px-3 py-2">
        <span className="min-w-0 flex-1 break-all whitespace-pre-wrap text-muted-foreground">
          $ {command}
        </span>
        {!!run && 'exitCode' in run && <ExitBadge run={run} />}
      </div>
      {!!run?.lines.length && (
        <pre
          className={cn(
            'overflow-auto border-t px-3 py-2',
            !isFull && 'max-h-64',
          )}
        >
          {run.lines.map((l, i) => (
            <div
              key={i}
              className={cn(
                'min-h-5 break-all whitespace-pre-wrap',
                TONE[l.tone],
              )}
            >
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
      <button
        type="button"
        aria-expanded={isOpen}
        onClick={() => setOpen((o) => !o)}
        className="flex h-9 cursor-default items-center gap-2.5 px-3 text-left type-meta text-muted-foreground hover:bg-accent/60 hover:text-foreground"
      >
        <span className="size-4 shrink-0" />
        <span className="flex-1">Thought for {entry.seconds ?? 1}s</span>
        <ChevronRight
          aria-hidden
          className={cn(
            'size-3.5 shrink-0 text-subtle-foreground transition-transform duration-150',
            isOpen && 'rotate-90',
          )}
        />
      </button>
      <Expand isOpen={isOpen}>
        <p className="px-3 pb-3 pl-9.5 type-meta text-pretty text-muted-foreground">
          {entry.text}
        </p>
      </Expand>
    </li>
  );
}
