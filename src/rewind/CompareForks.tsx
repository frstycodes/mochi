import { FileIcon } from '@react-symbols/icons/utils';
import { toast } from '@/toast/store';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import { useGitDiff } from '../git/useGit';
import { useWorktreePath } from '../git/worktrees';
import { threadCwd } from '../host/cwd';
import type { DiffFile } from '../host/types/git';
import type { Thread } from '../model';
import { goalProgress } from '../progress';
import { useHarness } from '../store';
import { lineColor, ProgressRing } from '../ui';
import { DiffStat } from '../WorkLog';

/** Two forks' branch diffs side by side; keeping one settles the other. */
export function CompareForks({ thread, otherId, onClose }: { thread: Thread; otherId: string; onClose: () => void }) {
  const { state, dispatch } = useHarness();
  const other = state.threads.find((t) => t.id === otherId);
  const left = useForkDiff(thread);
  const right = useForkDiff(other);
  if (!other) return null;

  const keep = (kept: Thread, dropped: Thread) => {
    dispatch({ type: 'fork-keep', keepId: kept.id, dropId: dropped.id });
    toast.success(`Kept "${kept.title}"`, { description: `"${dropped.title}" settled. Remove its worktree with "Clean up settled worktrees" in the Changes tab.` });
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Compare forks</DialogTitle>
          <DialogDescription>Each side is its branch against the base. Keep the approach you want; the other thread settles and its branch stays.</DialogDescription>
        </DialogHeader>
        <div className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2">
          <ForkSide thread={thread} diff={left} otherFiles={right.data?.files} onKeep={() => keep(thread, other)} />
          <ForkSide thread={other} diff={right} otherFiles={left.data?.files} onKeep={() => keep(other, thread)} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

type ForkDiff = ReturnType<typeof useForkDiff>;

function useForkDiff(thread: Thread | undefined) {
  useWorktreePath(thread?.id ?? '');
  const cwd = thread ? threadCwd(thread) : null;
  // Hooks can't be conditional: a thread without a folder still reads '.', and `hasFolder` hides the result.
  const diff = useGitDiff(cwd ?? '.', 'branch');
  return { ...diff, hasFolder: !!cwd };
}

function ForkSide({ thread, diff, otherFiles, onKeep }: { thread: Thread; diff: ForkDiff; otherFiles: DiffFile[] | undefined; onKeep: () => void }) {
  const { met, total } = goalProgress(thread);
  const files = diff.data?.files ?? [];
  const added = files.reduce((n, f) => n + f.added, 0);
  const removed = files.reduce((n, f) => n + f.removed, 0);
  const done = thread.steps.filter((s) => s.status === 'done').length;
  const open = thread.steps.filter((s) => s.status !== 'dropped').length;

  return (
    <section aria-label={thread.title} className="flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-3">
      <header className="flex min-w-0 flex-col gap-1">
        <div className="flex min-w-0 items-center gap-2">
          <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: lineColor(thread.line) }} />
          <h3 className="min-w-0 truncate type-title">{thread.title}</h3>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 type-meta text-muted-foreground">
          {!!thread.repo && <span className="min-w-0 truncate font-mono type-caption">{thread.repo.branch}</span>}
          <span className="flex items-center gap-1.5 tabular">
            <ProgressRing met={met} total={total} slot={thread.line} size={12} />
            {!!total && `${met}/${total} criteria · `}{done} of {open} steps
          </span>
          {files.length > 0 && <DiffStat added={added} removed={removed} />}
        </div>
      </header>
      <SideFiles diff={diff} files={files} otherFiles={otherFiles} />
      <Button variant="outline" className="self-start" onClick={onKeep}>
        Keep this one
      </Button>
    </section>
  );
}

function SideFiles({ diff, files, otherFiles }: { diff: ForkDiff; files: DiffFile[]; otherFiles: DiffFile[] | undefined }) {
  if (!diff.hasFolder) return <NoDiff title="No folder" description="This thread is a chat without a project, so there are no files to compare." />;
  if (diff.error) return <NoDiff title="Could not read the diff" description={diff.error} />;
  if (diff.isLoading) return <FilesSkeleton />;
  if (files.length === 0) return <NoDiff title="No changes yet" description="This branch matches its base." />;
  return (
    <div className="max-h-72 overflow-y-auto overscroll-contain">
      <ul className="flex flex-col gap-0.5">
        {files.map((f) => (
          <FileRow key={`${f.staged}:${f.path}`} file={f} mark={otherFiles && markFor(f, otherFiles)} />
        ))}
      </ul>
    </div>
  );
}

type Mark = 'same' | 'differs' | 'only';
const MARK_LABEL = { same: 'Same in both', differs: 'Differs', only: 'Only here' } satisfies Record<Mark, string>;

function markFor(file: DiffFile, otherFiles: DiffFile[]): Mark {
  const match = otherFiles.find((o) => o.path === file.path);
  if (!match) return 'only';
  return match.patch === file.patch ? 'same' : 'differs';
}

function FileRow({ file, mark }: { file: DiffFile; mark?: Mark }) {
  const slash = file.path.lastIndexOf('/') + 1;
  return (
    <li className="flex min-w-0 items-center gap-2 rounded-md px-1 py-0.5 type-meta">
      <FileIcon fileName={file.path.slice(slash)} autoAssign aria-hidden className="size-3.5 shrink-0" />
      <span className="min-w-0 flex-1 truncate font-mono type-caption" title={file.path}>
        <span className="text-subtle-foreground">{file.path.slice(0, slash)}</span>
        {file.path.slice(slash)}
      </span>
      {!!mark && mark !== 'same' && <Badge variant="outline">{MARK_LABEL[mark]}</Badge>}
      <DiffStat added={file.added} removed={file.removed} />
    </li>
  );
}

function NoDiff({ title, description }: { title: string; description: string }) {
  return (
    <Empty className="p-4">
      <EmptyHeader>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

function FilesSkeleton() {
  return (
    <div className="flex flex-col gap-1.5" aria-label="Loading the diff">
      {['w-3/4', 'w-1/2', 'w-2/3'].map((w) => (
        <Skeleton key={w} className={`h-4 ${w}`} />
      ))}
    </div>
  );
}
