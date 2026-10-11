import { useState } from 'react';
import { Danger, Document, Folder, RowHorizontal, RowVertical } from 'reicon-react';
import { Button } from '@/components/ui/button';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { ChangeList, type ChangeActions, type DiffStyle, type LineNote } from '../git/ChangeList';
import { fileKey, filesForStep } from '../git/files';
import { ShipBar } from '../git/ShipBar';
import { useConfirm } from '../git/useConfirm';
import { useGitAction, useGitDiff } from '../git/useGit';
import { WorktreeMenu } from '../git/WorktreeMenu';
import { AskAboutHunk } from '../sidechat/AskInSideChat';
import { useWorktreePath } from '../git/worktrees';
import { host } from '../host';
import { threadCwd } from '../host/cwd';
import type { ChangeTarget, DiffFile, DiffScope } from '../host/types/git';
import type { Thread } from '../model';
import { useHarness } from '../store';
import { DiffStat } from '../WorkLog';
import type { PaneTabProps } from './tabs';

export function ChangesTab({ thread }: PaneTabProps) {
  const cwd = useWorktreePath(thread.id) ?? threadCwd(thread);
  if (!cwd) return <NoFolder />;
  return <Changes key={cwd} thread={thread} cwd={cwd} />;
}

const ALL_STEPS = 'all';

function Changes({ thread, cwd }: { thread: Thread; cwd: string }) {
  const [scope, setScope] = useState<DiffScope>('branch');
  const [stepId, setStepId] = useState(ALL_STEPS);
  const [diffStyle, setDiffStyle] = useState<DiffStyle>('unified');
  const diffQuery = useGitDiff(cwd, scope);
  const { run } = useGitAction(diffQuery.refresh);
  const { confirm, dialog } = useConfirm();
  const actions = useChangeActions({ thread, cwd, canStage: scope === 'uncommitted', diffStyle, run, confirm });

  const diff = diffQuery.data;
  const steps = thread.steps.filter((s) => s.footprint.length > 0);
  const files = filesForStep(diff?.files ?? [], steps.find((s) => s.id === stepId));
  const isEmpty = !!diff && diff.files.length === 0;
  const isFilteredEmpty = !!diff && !isEmpty && files.length === 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="@container flex h-11 shrink-0 items-center gap-1.5 px-3">
        <Select value={scope} onValueChange={(v) => setScope(v as DiffScope)}>
          <SelectTrigger size="sm" aria-label="Compare" className="shrink-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="branch">Branch</SelectItem>
              <SelectItem value="uncommitted">Uncommitted</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
        {steps.length > 0 && (
          <Select value={stepId} onValueChange={setStepId}>
            <SelectTrigger size="sm" aria-label="Filter by step" className="min-w-0 max-w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value={ALL_STEPS}>All steps</SelectItem>
                {steps.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.title}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        )}
        <span className="flex-1" />
        {files.length > 0 && (
          <span className="hidden @lg:flex">
            <DiffStat added={sum(files, 'added')} removed={sum(files, 'removed')} />
          </span>
        )}
        <AskAboutHunk threadId={thread.id} files={files} />
        <ToggleGroup type="single" size="sm" value={diffStyle} onValueChange={(v) => v && setDiffStyle(v as DiffStyle)} aria-label="Diff layout">
          <ToggleGroupItem value="unified" aria-label="Unified diff">
            <RowVertical />
          </ToggleGroupItem>
          <ToggleGroupItem value="split" aria-label="Split diff">
            <RowHorizontal />
          </ToggleGroupItem>
        </ToggleGroup>
        <WorktreeMenu cwd={cwd} diff={diff} run={run} confirm={confirm} />
      </div>
      {!!diffQuery.error && !diff && <DiffError message={diffQuery.error} onRetry={diffQuery.refresh} />}
      {diffQuery.isLoading && <ChangesSkeleton />}
      {isEmpty && <NoChanges scope={scope} />}
      {isFilteredEmpty && <NoStepChanges />}
      {/* Radix lays the viewport content out as `display: table`, which grows to the widest diff line instead of scrolling it. */}
      {files.length > 0 && (
        <ScrollArea type="scroll" className="min-h-0 flex-1 [&_[data-slot=scroll-area-viewport]>div]:block!">
          <ChangeList key={`${scope}:${stepId}`} files={files} actions={actions} />
        </ScrollArea>
      )}
      {!!diff && <ShipBar thread={thread} cwd={cwd} diff={diff} canCommit={scope === 'uncommitted'} run={run} confirm={confirm} />}
      {dialog}
    </div>
  );
}

interface ChangeActionsInput {
  thread: Thread;
  cwd: string;
  canStage: boolean;
  diffStyle: DiffStyle;
  run: ReturnType<typeof useGitAction>['run'];
  confirm: ReturnType<typeof useConfirm>['confirm'];
}

function useChangeActions({ thread, cwd, canStage, diffStyle, run, confirm }: ChangeActionsInput): ChangeActions {
  const { dispatch } = useHarness();
  const [notes, setNotes] = useState<LineNote[]>([]);
  const agentName = thread.providers[0] === 'codex' ? 'Codex' : 'Claude';

  const revert = async (target: ChangeTarget) => {
    const ok = await confirm(revertRequest(target));
    if (ok) await run('Revert', () => host.git.revert(cwd, target));
  };

  const comment = (file: DiffFile, side: LineNote['side'], line: number) => {
    const key = fileKey(file);
    const id = `${key}:${side}:${line}`;
    setNotes((all) => (all.some((n) => n.id === id && !n.isSent) ? all : [...all, { id, fileKey: key, path: file.path, side, line, text: '', isSent: false }]));
  };

  const sendNote = (note: LineNote, text: string) => {
    const where = note.side === 'deletions' ? `${note.path}, removed line ${note.line}` : `${note.path}:${note.line}`;
    dispatch({ type: 'say', threadId: thread.id, entry: { who: 'you', kind: 'message', text: `Review note on \`${where}\`\n\n${text}` } });
    setNotes((all) => all.map((n) => (n.id === note.id ? { ...n, id: `${n.id}:${Date.now()}`, text, isSent: true } : n)));
  };

  return {
    canStage,
    diffStyle,
    agentName,
    notes,
    stage: (target) => void run('Stage', () => host.git.stage(cwd, target)),
    unstage: (target) => void run('Unstage', () => host.git.unstage(cwd, target)),
    revert: (target) => void revert(target),
    comment,
    sendNote,
    dropNote: (note) => setNotes((all) => all.filter((n) => n.id !== note.id)),
  };
}

function revertRequest(target: ChangeTarget) {
  const name = target.path.slice(target.path.lastIndexOf('/') + 1);
  if (target.untracked && !target.patch)
    return { title: `Delete ${name}?`, description: `${target.path} was never committed, so it can't be recovered.`, confirm: 'Delete file', cancel: 'Keep file', isDestructive: true };
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

function ChangesSkeleton() {
  return (
    <div className="flex flex-col gap-0.5 px-2" aria-busy aria-label="Loading changes">
      {[52, 38, 64, 44].map((w) => (
        <div key={w} className="flex h-7 items-center gap-1.5 px-1.5">
          <Skeleton className="size-3.5" />
          <Skeleton className="h-2.5" style={{ width: `${w}%` }} />
          <Skeleton className="ml-auto h-2.5 w-10" />
        </div>
      ))}
    </div>
  );
}

function NoFolder() {
  return (
    <Empty className="flex-1">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Folder />
        </EmptyMedia>
        <EmptyTitle>No folder</EmptyTitle>
        <EmptyDescription>This thread is a chat without a project, so it has no files to diff.</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

function NoChanges({ scope }: { scope: DiffScope }) {
  return (
    <Empty className="flex-1">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Document />
        </EmptyMedia>
        <EmptyTitle>No changes</EmptyTitle>
        <EmptyDescription>{scope === 'branch' ? 'This branch matches its base. Edits land here as the agent makes them.' : 'Everything is committed.'}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

function NoStepChanges() {
  return (
    <Empty className="flex-1">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Document />
        </EmptyMedia>
        <EmptyTitle>No changes for this step</EmptyTitle>
        <EmptyDescription>None of the changed files are in this step's footprint.</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

function DiffError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Empty className="flex-1">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Danger />
        </EmptyMedia>
        <EmptyTitle>Couldn't read the diff</EmptyTitle>
        <EmptyDescription className="font-mono text-xs break-words">{message}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>
      </EmptyContent>
    </Empty>
  );
}
