import { useState, type CSSProperties, type ReactNode } from 'react';
import type { DiffLineAnnotation } from '@pierre/diffs';
import { PatchDiff } from '../files/Diffs';
import { FileIcon } from '@react-symbols/icons/utils';
import { ChevronDown, MessageText, Minus, PlusBold, Undo } from '@/icons';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import type {
  ChangeTarget,
  DiffFile,
  DiffHunk,
  ReviewThread,
} from '../host/types/git';
import { DiffStat } from '../WorkLog';
import { fileKey, hunkCovers, type ChangeSection } from './files';
import { isMod } from '../keys';
import { TooltipIconButton } from '../ui';

export type DiffStyle = 'unified' | 'split';
export type NoteSide = 'additions' | 'deletions';

export interface LineNote {
  id: string;
  fileKey: string;
  path: string;
  side: NoteSide;
  line: number;
  text: string;
  isSent: boolean;
}

/** What the list can do to a change; staging and reverting only exist for uncommitted changes. */
export interface ChangeActions {
  canStage: boolean;
  diffStyle: DiffStyle;
  agentName: string;
  stage(target: ChangeTarget): void;
  unstage(target: ChangeTarget): void;
  revert(target: ChangeTarget): void;
  notes: LineNote[];
  comment(file: DiffFile, side: NoteSide, line: number): void;
  sendNote(note: LineNote, text: string): void;
  dropNote(note: LineNote): void;
  /** A PR's review threads, shown on the lines they sit on. */
  review?: {
    threads: ReviewThread[];
    renderThread(thread: ReviewThread): ReactNode;
  };
}

type Annotation = { note: LineNote } | { thread: ReviewThread };

// Files this big start folded, so opening the pane doesn't render thousands of diff lines at once.
const FOLDED_LINES = 400;

/** Every changed file's diff, stacked in tree order under a sticky header; a header folds its file. */
export function ChangeList({
  sections,
  actions,
}: {
  sections: ChangeSection[];
  actions: ChangeActions;
}) {
  const [folded, setFolded] = useState(
    () =>
      new Set(
        sections
          .flatMap((s) => s.files)
          .filter((f) => f.added + f.removed > FOLDED_LINES)
          .map(fileKey),
      ),
  );
  const toggle = (key: string) =>
    setFolded((keys) => {
      const next = new Set(keys);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  return (
    <div className="flex flex-col pb-3">
      {sections.map((section) => (
        <section
          key={section.title ?? 'all'}
          aria-label={section.title ?? 'Changed files'}
        >
          {!!section.title && (
            <h3 className="flex h-7 items-center gap-1.5 px-3 type-caption text-subtle-foreground">
              {section.title}
              <span className="tabular">{section.files.length}</span>
            </h3>
          )}
          {section.files.map((file) => (
            <FileDiff
              key={fileKey(file)}
              file={file}
              isOpen={!folded.has(fileKey(file))}
              onToggle={() => toggle(fileKey(file))}
              actions={actions}
            />
          ))}
        </section>
      ))}
    </div>
  );
}

function FileDiff({
  file,
  isOpen,
  onToggle,
  actions,
}: {
  file: DiffFile;
  isOpen: boolean;
  onToggle: () => void;
  actions: ChangeActions;
}) {
  const slash = file.path.lastIndexOf('/');
  const name = file.path.slice(slash + 1);
  const dir = file.path.slice(0, Math.max(slash, 0));
  const target = {
    path: file.path,
    staged: file.staged,
    untracked: file.kind === 'untracked',
  };
  return (
    <div data-file-key={fileKey(file)} className="group/file border-b">
      <div className="sticky top-0 z-10 flex h-8 items-center gap-1.5 bg-card pr-1.5 pl-2">
        <button
          type="button"
          aria-expanded={isOpen}
          onClick={onToggle}
          title={file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
          className="flex min-w-0 flex-1 items-center gap-1.5 self-stretch text-left focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          <ChevronDown
            aria-hidden
            className={cn(
              'size-3 shrink-0 text-subtle-foreground transition-transform duration-150',
              !isOpen && '-rotate-90',
            )}
          />
          <FileIcon
            fileName={name}
            autoAssign
            aria-hidden
            className="size-3.5 shrink-0"
          />
          <span
            className={cn(
              'shrink-0 type-meta text-foreground',
              file.kind === 'deleted' &&
                'line-through decoration-subtle-foreground',
            )}
          >
            {name}
          </span>
          {!!dir && (
            <span className="min-w-0 truncate type-caption text-subtle-foreground">
              {dir}
            </span>
          )}
          <span className="shrink-0">
            <DiffStat added={file.added} removed={file.removed} />
          </span>
        </button>
        {actions.canStage && (
          <span className="flex shrink-0 gap-0.5 opacity-0 group-hover/file:opacity-100 focus-within:opacity-100">
            {!file.staged && (
              <TooltipIconButton
                label="Revert file"
                hint="Discard this file's changes"
                size="icon-xs"
                className="text-muted-foreground hover:text-foreground"
                onClick={() => actions.revert(target)}
              >
                <Undo />
              </TooltipIconButton>
            )}
            {file.staged ? (
              <TooltipIconButton
                label="Unstage file"
                hint="Take it out of the next commit"
                size="icon-xs"
                className="text-muted-foreground hover:text-foreground"
                onClick={() => actions.unstage(target)}
              >
                <Minus />
              </TooltipIconButton>
            ) : (
              <TooltipIconButton
                label="Stage file"
                hint="Include it in the next commit"
                size="icon-xs"
                className="text-muted-foreground hover:text-foreground"
                onClick={() => actions.stage(target)}
              >
                <PlusBold />
              </TooltipIconButton>
            )}
          </span>
        )}
      </div>
      {isOpen && <FileBody file={file} actions={actions} />}
    </div>
  );
}

function FileBody({
  file,
  actions,
}: {
  file: DiffFile;
  actions: ChangeActions;
}) {
  if (file.hunks.length === 0)
    return (
      <p className="px-3 pb-2 type-meta text-subtle-foreground">
        {file.binary
          ? 'Binary file changed'
          : file.oldPath
            ? `Renamed from ${file.oldPath}`
            : 'No content changes'}
      </p>
    );
  return file.hunks.map((hunk, i) => (
    <HunkBlock
      key={hunk.header + i}
      file={file}
      hunk={hunk}
      actions={actions}
    />
  ));
}

function HunkBlock({
  file,
  hunk,
  actions,
}: {
  file: DiffFile;
  hunk: DiffHunk;
  actions: ChangeActions;
}) {
  const target = {
    path: file.path,
    staged: file.staged,
    untracked: file.kind === 'untracked',
    patch: hunk.patch,
  };
  const key = fileKey(file);
  const notes = actions.notes.filter(
    (n) => n.fileKey === key && hunkCovers(hunk.header, n.side, n.line),
  );
  const threads =
    actions.review?.threads.filter(
      (t) =>
        t.path === file.path &&
        t.line !== null &&
        hunkCovers(hunk.header, t.side, t.line),
    ) ?? [];
  const annotations = [
    ...notes.map((note) => ({
      side: note.side,
      lineNumber: note.line,
      metadata: { note },
    })),
    ...threads.map((thread) => ({
      side: thread.side,
      lineNumber: thread.line!,
      metadata: { thread },
    })),
  ];
  const showHeader = file.hunks.length > 1;
  const showToolbar = showHeader || actions.canStage;
  return (
    <div className="group/hunk">
      {showToolbar && (
        <div className="flex h-6 items-center gap-2 pr-1.5 pl-3">
          <span className="min-w-0 flex-1 truncate font-mono text-xs text-subtle-foreground">
            {showHeader && hunk.header}
          </span>
          {actions.canStage && (
            <span className="flex shrink-0 gap-0.5 opacity-0 group-hover/hunk:opacity-100 focus-within:opacity-100">
              {!file.staged && (
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => actions.revert(target)}
                  className="text-muted-foreground"
                >
                  Revert
                </Button>
              )}
              <Button
                variant="ghost"
                size="xs"
                onClick={() =>
                  file.staged ? actions.unstage(target) : actions.stage(target)
                }
                className="text-muted-foreground"
              >
                {file.staged ? 'Unstage' : 'Stage'}
              </Button>
            </span>
          )}
        </div>
      )}
      <HunkDiff
        patch={hunk.patch}
        diffStyle={actions.diffStyle}
        annotations={annotations}
        onComment={(side, line) => actions.comment(file, side, line)}
        renderAnnotation={(a) =>
          'note' in a ? (
            <NoteCard note={a.note} actions={actions} />
          ) : (
            actions.review?.renderThread(a.thread)
          )
        }
      />
    </div>
  );
}

const DIFF_STYLE = {
  '--diffs-font-family': 'var(--font-mono)',
  '--diffs-font-size': '12px',
  '--diffs-line-height': '20px',
} as CSSProperties;

interface HunkDiffProps {
  patch: string;
  diffStyle: DiffStyle;
  annotations: DiffLineAnnotation<Annotation>[];
  onComment: (side: NoteSide, line: number) => void;
  renderAnnotation: (annotation: Annotation) => ReactNode;
}

function HunkDiff({
  patch,
  diffStyle,
  annotations,
  onComment,
  renderAnnotation,
}: HunkDiffProps) {
  return (
    <PatchDiff<Annotation>
      patch={patch}
      disableWorkerPool
      options={{
        diffStyle,
        lineDiffType: 'word',
        hunkSeparators: 'simple',
        disableFileHeader: true,
        overflow: 'wrap',
        enableGutterUtility: true,
        onGutterUtilityClick: (range) =>
          onComment(range.side ?? 'additions', range.start),
      }}
      lineAnnotations={annotations}
      renderAnnotation={(annotation) => renderAnnotation(annotation.metadata)}
      style={DIFF_STYLE}
    />
  );
}

function NoteCard({
  note,
  actions,
}: {
  note: LineNote;
  actions: ChangeActions;
}) {
  const [text, setText] = useState(note.text);
  if (note.isSent)
    return (
      <div className="m-2 flex gap-2 rounded-lg border bg-background px-2.5 py-2 font-sans">
        <MessageText
          className="mt-0.5 size-3.5 shrink-0 text-subtle-foreground"
          aria-hidden
        />
        <div className="flex min-w-0 flex-col">
          <p className="type-meta whitespace-pre-wrap text-foreground">
            {note.text}
          </p>
          <p className="type-caption text-subtle-foreground">
            Sent to {actions.agentName}
          </p>
        </div>
      </div>
    );
  const send = () => text.trim() && actions.sendNote(note, text.trim());
  return (
    <form
      className="m-2 flex flex-col gap-2 rounded-lg border bg-background p-2 font-sans"
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      <Textarea
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && isMod(e)) send();
          if (e.key === 'Escape') actions.dropNote(note);
        }}
        placeholder={`Note for ${actions.agentName} on line ${note.line}`}
        aria-label={`Review note on ${note.path} line ${note.line}`}
        className="min-h-14 resize-none text-sm"
      />
      <div className="flex justify-end gap-1.5">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => actions.dropNote(note)}
        >
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={!text.trim()}>
          Send to {actions.agentName}
        </Button>
      </div>
    </form>
  );
}
