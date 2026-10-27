import { useRef, useState } from 'react';
import { setPrefs, usePrefs } from '../settings/prefs';
import { XCircle, File, Folder, Columns, List, Rows } from '@/icons';
import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { ScrollArea } from '@/components/ui/scroll-area';
import { SkeletonRows } from '@/components/SkeletonRows';
import {
  ChangeList,
  type ChangeActions,
  type DiffStyle,
  type LineNote,
} from '../git/ChangeList';
import { changeSections, fileKey, reviewNote } from '../git/files';
import { ChangeTree } from '../git/ChangeTree';
import { ComparePicker, type Compare } from '../git/ComparePicker';
import { ShipBar } from '../git/ShipBar';
import { useConfirm } from '../git/useConfirm';
import { useGitAction, useGitDiff } from '../git/useGit';
import { WorktreeMenu } from '../git/WorktreeMenu';
import { AskAboutHunk } from '../sidechat/AskInSideChat';
import { useWorktreePath } from '../git/worktrees';
import { host } from '../host';
import { threadCwd } from '../host/cwd';
import type { ChangeTarget, DiffFile, DiffScope } from '../host/types/git';
import { cn } from '@/lib/utils';
import { ModeToggle, TooltipIconButton, type Mode } from '../ui';
import type { Thread } from '../model';
import { useDispatch } from '../store';
import { DiffStat } from '../WorkLog';
import {
  PaneActions,
  PaneMenuItems,
  PaneTitle,
  usePaneMenu,
} from './PaneHeader';
import type { PaneTabProps } from './tabs';

export const DIFF_STYLES = [
  {
    value: 'unified',
    label: 'Unified diff',
    hint: 'Click for side by side',
    icon: <Rows />,
  },
  {
    value: 'split',
    label: 'Split diff',
    hint: 'Click for one column',
    icon: <Columns />,
  },
] as const satisfies readonly [Mode<DiffStyle>, Mode<DiffStyle>];

export function ChangesTab({ thread, tab }: PaneTabProps) {
  const cwd = useWorktreePath(thread.id) ?? threadCwd(thread);
  if (!cwd) return <NoFolder />;
  return <Changes key={cwd} thread={thread} cwd={cwd} tabId={tab.id} />;
}

function Changes({
  thread,
  cwd,
  tabId,
}: {
  thread: Thread;
  cwd: string;
  tabId: string;
}) {
  usePaneMenu();
  const [compare, setCompare] = useState<Compare>({ scope: 'branch' });
  const [isTreeOpen, setTreeOpen] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const diffColumn = useRef<HTMLDivElement>(null);
  const { diffStyle } = usePrefs();
  const diffQuery = useGitDiff(
    cwd,
    compare.scope,
    compare.base ?? thread.repo?.base,
  );
  const { run } = useGitAction(diffQuery.refresh);
  const { confirm, dialog } = useConfirm();
  const canStage = compare.scope === 'uncommitted';
  const actions = useChangeActions({
    thread,
    cwd,
    canStage,
    diffStyle,
    run,
    confirm,
  });

  const diff = diffQuery.data;
  const files = diff?.files ?? [];
  const sections = changeSections(files, canStage);
  const isEmpty = !!diff && diff.files.length === 0;

  const reveal = (file: DiffFile) => {
    setSelected(fileKey(file));
    diffColumn.current
      ?.querySelector(`[data-file-key="${CSS.escape(fileKey(file))}"]`)
      ?.scrollIntoView({ block: 'start' });
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PaneTitle>
        <TooltipIconButton
          label={isTreeOpen ? 'Hide the file tree' : 'Show the file tree'}
          aria-pressed={isTreeOpen}
          onClick={() => setTreeOpen((o) => !o)}
          className={cn(
            '-ml-1.5 shrink-0 text-muted-foreground',
            isTreeOpen && 'bg-accent text-foreground',
          )}
        >
          <List />
        </TooltipIconButton>
        <ComparePicker
          cwd={cwd}
          compare={compare}
          threadBase={thread.repo?.base}
          onChange={setCompare}
        />
      </PaneTitle>
      <PaneActions>
        {files.length > 0 && (
          <span className="hidden @lg:flex">
            <DiffStat
              added={sum(files, 'added')}
              removed={sum(files, 'removed')}
            />
          </span>
        )}
        <AskAboutHunk threadId={thread.id} files={files} />
        <ModeToggle
          value={diffStyle}
          modes={DIFF_STYLES}
          onSelect={(v) => setPrefs({ diffStyle: v })}
          className="text-muted-foreground"
        />
        <WorktreeMenu
          cwd={cwd}
          base={thread.repo?.base}
          diff={diff}
          run={run}
          confirm={confirm}
        >
          <PaneMenuItems kind="changes" threadId={thread.id} tabId={tabId} />
        </WorktreeMenu>
      </PaneActions>
      {!!diffQuery.error && !diff && (
        <DiffError message={diffQuery.error} onRetry={diffQuery.refresh} />
      )}
      {diffQuery.isLoading && (
        <SkeletonRows
          shape="change"
          count={4}
          label="Loading changes"
          className="px-2"
        />
      )}
      {isEmpty && <NoChanges scope={compare.scope} />}
      {files.length > 0 && (
        <div className="flex min-h-0 flex-1 border-t">
          {isTreeOpen && (
            <ScrollArea
              type="scroll"
              className="w-60 max-w-[40%] shrink-0 border-r"
            >
              <ChangeTree
                sections={sections}
                selected={selected}
                onSelect={reveal}
              />
            </ScrollArea>
          )}
          {/* Radix lays the viewport content out as `display: table`, which grows to the widest diff line instead of scrolling it. */}
          <ScrollArea
            ref={diffColumn}
            type="scroll"
            className="min-h-0 min-w-0 flex-1 [&_[data-slot=scroll-area-viewport]>div]:block!"
          >
            <ChangeList
              key={`${compare.scope}:${compare.base}`}
              sections={sections}
              actions={actions}
            />
          </ScrollArea>
        </div>
      )}
      {!!diff && (
        <ShipBar
          thread={thread}
          cwd={cwd}
          diff={diff}
          canCommit={canStage}
          run={run}
          confirm={confirm}
        />
      )}
      {dialog}
    </div>
  );
}

export interface ChangeActionsInput {
  thread: Thread;
  cwd: string;
  canStage: boolean;
  diffStyle: DiffStyle;
  run: ReturnType<typeof useGitAction>['run'];
  confirm: ReturnType<typeof useConfirm>['confirm'];
}

export function useChangeActions({
  thread,
  cwd,
  canStage,
  diffStyle,
  run,
  confirm,
}: ChangeActionsInput): ChangeActions {
  const dispatch = useDispatch();
  const [notes, setNotes] = useState<LineNote[]>([]);
  const agentName = thread.providers[0] === 'codex' ? 'Codex' : 'Claude';

  const revert = async (target: ChangeTarget) => {
    const ok = await confirm(revertRequest(target));
    if (ok) await run('Revert', () => host.git.revert(cwd, target));
  };

  const comment = (file: DiffFile, side: LineNote['side'], line: number) => {
    const key = fileKey(file);
    const id = `${key}:${side}:${line}`;
    setNotes((all) =>
      all.some((n) => n.id === id && !n.isSent)
        ? all
        : [
            ...all,
            {
              id,
              fileKey: key,
              path: file.path,
              side,
              line,
              text: '',
              isSent: false,
            },
          ],
    );
  };

  const sendNote = (note: LineNote, text: string) => {
    dispatch({
      type: 'say',
      threadId: thread.id,
      entry: {
        who: 'you',
        kind: 'message',
        text: reviewNote(note.path, note.side, note.line, text),
      },
    });
    setNotes((all) =>
      all.map((n) =>
        n.id === note.id
          ? { ...n, id: `${n.id}:${Date.now()}`, text, isSent: true }
          : n,
      ),
    );
  };

  return {
    canStage,
    diffStyle,
    agentName,
    notes,
    stage: (target) => void run('Stage', () => host.git.stage(cwd, target)),
    unstage: (target) =>
      void run('Unstage', () => host.git.unstage(cwd, target)),
    revert: (target) => void revert(target),
    comment,
    sendNote,
    dropNote: (note) => setNotes((all) => all.filter((n) => n.id !== note.id)),
  };
}

export function revertRequest(target: ChangeTarget) {
  const name = target.path.slice(target.path.lastIndexOf('/') + 1);
  if (target.untracked && !target.patch)
    return {
      title: `Delete ${name}?`,
      description: `${target.path} was never committed, so it can't be recovered.`,
      confirm: 'Delete file',
      cancel: 'Keep file',
      isDestructive: true,
    };
  return {
    title: target.patch ? 'Revert this hunk?' : `Revert ${name}?`,
    description: `Your uncommitted edits ${target.patch ? 'in this hunk of' : 'to'} ${target.path} are discarded. This can't be undone.`,
    confirm: target.patch ? 'Revert hunk' : 'Revert file',
    cancel: 'Keep changes',
    isDestructive: true,
  };
}

function sum(files: DiffFile[], key: 'added' | 'removed') {
  return files.reduce((n, f) => n + f[key], 0);
}

function NoFolder() {
  return (
    <Empty className="flex-1">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Folder />
        </EmptyMedia>
        <EmptyTitle>No folder</EmptyTitle>
        <EmptyDescription>
          This thread is a chat without a project, so it has no files to diff.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

export function NoChanges({ scope }: { scope: DiffScope }) {
  return (
    <Empty className="flex-1">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <File />
        </EmptyMedia>
        <EmptyTitle>No changes</EmptyTitle>
        <EmptyDescription>
          {scope === 'branch'
            ? 'This branch matches its base. Edits land here as the agent makes them.'
            : 'Everything is committed.'}
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

export function DiffError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <Empty className="flex-1">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <XCircle />
        </EmptyMedia>
        <EmptyTitle>Couldn't read the diff</EmptyTitle>
        <EmptyDescription className="font-mono text-xs break-words">
          {message}
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>
      </EmptyContent>
    </Empty>
  );
}
