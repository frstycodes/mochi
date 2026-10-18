import { useState, type CSSProperties } from 'react';
import { useDiffTheme } from '../themes/highlight';
import { PatchDiff } from '@pierre/diffs/react';
import { FileIcon } from '@react-symbols/icons/utils';
import { ChevronRight, Folder, MessageText, Minus, PlusBold, Undo } from '@/icons';
import { Button } from '@/components/ui/button';
import { Item, ItemActions, ItemContent, ItemMedia } from '@/components/ui/item';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { ChangeKind, ChangeTarget, DiffFile, DiffHunk } from '../host/types/git';
import { DiffStat } from '../WorkLog';
import { fileKey, groupByDir, hunkCovers } from './files';
import { isMod } from '../keys';

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
}

export function ChangeList({ files, actions }: { files: DiffFile[]; actions: ChangeActions }) {
  const [openKeys, setOpenKeys] = useState(() => new Set(files.slice(0, 1).map(fileKey)));
  const toggle = (key: string) =>
    setOpenKeys((keys) => {
      const next = new Set(keys);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  const sections = actions.canStage
    ? [
        { title: 'Staged', files: files.filter((f) => f.staged) },
        { title: 'Changes', files: files.filter((f) => !f.staged) },
      ].filter((s) => s.files.length > 0)
    : [{ title: null, files }];

  return (
    <div className="flex flex-col gap-3 px-2 pb-3">
      {sections.map((section) => (
        <section key={section.title ?? 'all'} className="flex flex-col gap-0.5" aria-label={section.title ?? 'Changed files'}>
          {!!section.title && (
            <h3 className="flex h-6 items-center gap-1.5 px-2 type-caption font-medium text-subtle-foreground">
              {section.title}
              <span className="tabular">{section.files.length}</span>
            </h3>
          )}
          {groupByDir(section.files).map((group) => (
            <div key={group.dir} className="flex flex-col gap-0.5">
              {!!group.dir && (
                <div className="flex h-6 min-w-0 items-center gap-1.5 px-2 font-mono text-xs text-subtle-foreground">
                  <Folder className="size-3.5 shrink-0" aria-hidden />
                  <span className="truncate">{group.dir}</span>
                </div>
              )}
              {group.files.map((file) => (
                <FileEntry key={fileKey(file)} file={file} isNested={!!group.dir} isOpen={openKeys.has(fileKey(file))} onToggle={() => toggle(fileKey(file))} actions={actions} />
              ))}
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

function FileEntry({ file, isNested, isOpen, onToggle, actions }: { file: DiffFile; isNested: boolean; isOpen: boolean; onToggle: () => void; actions: ChangeActions }) {
  const name = file.path.slice(file.path.lastIndexOf('/') + 1);
  const target = { path: file.path, staged: file.staged, untracked: file.kind === 'untracked' };
  return (
    <div className="flex flex-col">
      <Item size="xs" className={cn('relative isolate h-7 gap-1.5 rounded-md py-0 pr-1.5 hover:bg-accent/60', isNested ? 'pl-5' : 'pl-1.5')}>
        <ItemMedia className="gap-1">
          <ChevronRight className={cn('size-3.5 text-subtle-foreground transition-transform duration-150', isOpen && 'rotate-90')} aria-hidden />
          <FileIcon fileName={name} autoAssign aria-hidden className="size-3.5" />
        </ItemMedia>
        <ItemContent className="min-w-0">
          <span className="flex min-w-0 items-center gap-1.5">
            <button type="button" aria-expanded={isOpen} onClick={onToggle} className="min-w-0 truncate text-left font-mono text-xs text-foreground outline-none after:absolute after:inset-0 after:rounded-md focus-visible:after:ring-2 focus-visible:after:ring-ring/50" title={file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}>
              {name}
            </button>
            <KindLetter kind={file.kind} />
          </span>
        </ItemContent>
        <ItemActions className="relative z-10 gap-0.5">
          {actions.canStage && (
            <span className="flex gap-0.5 opacity-0 group-hover/item:opacity-100 focus-within:opacity-100">
              {!file.staged && <IconAction label="Revert file" icon={Undo} onClick={() => actions.revert(target)} />}
              {file.staged ? <IconAction label="Unstage file" icon={Minus} onClick={() => actions.unstage(target)} /> : <IconAction label="Stage file" icon={PlusBold} onClick={() => actions.stage(target)} />}
            </span>
          )}
          <DiffStat added={file.added} removed={file.removed} />
        </ItemActions>
      </Item>
      {isOpen && <FileBody file={file} actions={actions} />}
    </div>
  );
}

const KIND = {
  modified: { letter: 'M', label: 'Modified', className: 'text-warning' },
  added: { letter: 'A', label: 'Added', className: 'text-success' },
  untracked: { letter: 'U', label: 'Untracked', className: 'text-success' },
  deleted: { letter: 'D', label: 'Deleted', className: 'text-destructive' },
  renamed: { letter: 'R', label: 'Renamed', className: 'text-subtle-foreground' },
} satisfies Record<ChangeKind, { letter: string; label: string; className: string }>;

function KindLetter({ kind }: { kind: ChangeKind }) {
  const { letter, label, className } = KIND[kind];
  return (
    <span className={cn('shrink-0 font-mono type-caption font-medium', className)} title={label} aria-label={label}>
      {letter}
    </span>
  );
}

function IconAction({ label, icon: Icon, onClick }: { label: string; icon: typeof PlusBold; onClick: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-xs" aria-label={label} onClick={onClick} className="text-muted-foreground hover:text-foreground">
          <Icon />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function FileBody({ file, actions }: { file: DiffFile; actions: ChangeActions }) {
  const isEmpty = file.hunks.length === 0;
  return (
    <div className="my-1 mr-1 ml-6 overflow-hidden rounded-xl border bg-card">
      {isEmpty && <p className="px-3 py-2 type-meta text-subtle-foreground">{file.binary ? 'Binary file changed' : file.oldPath ? `Renamed from ${file.oldPath}` : 'No content changes'}</p>}
      {file.hunks.map((hunk, i) => (
        <HunkBlock key={hunk.header + i} file={file} hunk={hunk} isFirst={i === 0} actions={actions} />
      ))}
    </div>
  );
}

function HunkBlock({ file, hunk, isFirst, actions }: { file: DiffFile; hunk: DiffHunk; isFirst: boolean; actions: ChangeActions }) {
  const target = { path: file.path, staged: file.staged, untracked: file.kind === 'untracked', patch: hunk.patch };
  const key = fileKey(file);
  return (
    <div className={cn(!isFirst && 'border-t')}>
      <div className="flex h-7 items-center gap-2 bg-muted/40 pr-1 pl-3">
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-subtle-foreground">{hunk.header}</span>
        {actions.canStage && (
          <span className="flex shrink-0 gap-0.5">
            {!file.staged && (
              <Button variant="ghost" size="xs" onClick={() => actions.revert(target)} className="text-muted-foreground">
                Revert
              </Button>
            )}
            <Button variant="ghost" size="xs" onClick={() => (file.staged ? actions.unstage(target) : actions.stage(target))} className="text-muted-foreground">
              {file.staged ? 'Unstage' : 'Stage'}
            </Button>
          </span>
        )}
      </div>
      <HunkDiff patch={hunk.patch} diffStyle={actions.diffStyle} notes={actions.notes.filter((n) => n.fileKey === key && hunkCovers(hunk.header, n.side, n.line))} onComment={(side, line) => actions.comment(file, side, line)} renderNote={(note) => <NoteCard note={note} actions={actions} />} />
    </div>
  );
}

const DIFF_STYLE = { '--diffs-font-family': 'var(--font-mono)', '--diffs-font-size': '12px', '--diffs-line-height': '20px' } as CSSProperties;

function HunkDiff({ patch, diffStyle, notes, onComment, renderNote }: { patch: string; diffStyle: DiffStyle; notes: LineNote[]; onComment: (side: NoteSide, line: number) => void; renderNote: (note: LineNote) => React.ReactNode }) {
  const diffTheme = useDiffTheme();
  return (
    <PatchDiff<LineNote>
      patch={patch}
      disableWorkerPool
      options={{
        diffStyle,
        lineDiffType: 'word',
        hunkSeparators: 'simple',
        disableFileHeader: true,
        overflow: 'wrap',
        ...diffTheme,
        enableGutterUtility: true,
        onGutterUtilityClick: (range) => onComment(range.side ?? 'additions', range.start),
      }}
      lineAnnotations={notes.map((n) => ({ side: n.side, lineNumber: n.line, metadata: n }))}
      renderAnnotation={(annotation) => renderNote(annotation.metadata)}
      style={DIFF_STYLE}
    />
  );
}

function NoteCard({ note, actions }: { note: LineNote; actions: ChangeActions }) {
  const [text, setText] = useState(note.text);
  if (note.isSent)
    return (
      <div className="m-2 flex gap-2 rounded-lg border bg-background px-2.5 py-2 font-sans">
        <MessageText className="mt-0.5 size-3.5 shrink-0 text-subtle-foreground" aria-hidden />
        <div className="flex min-w-0 flex-col">
          <p className="type-meta whitespace-pre-wrap text-foreground">{note.text}</p>
          <p className="type-caption text-subtle-foreground">Sent to {actions.agentName}</p>
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
        <Button type="button" variant="ghost" size="sm" onClick={() => actions.dropNote(note)}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={!text.trim()}>
          Send to {actions.agentName}
        </Button>
      </div>
    </form>
  );
}
