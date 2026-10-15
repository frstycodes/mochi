import { useState, type ReactNode } from 'react';
import { ArrowDown, Broom, Copy } from 'reicon-react';
import { toast } from '@/toast/store';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { host } from '../host';
import type { GitDiff } from '../host/types/git';
import { useHarness } from '../store';
import type { ConfirmRequest } from './useConfirm';
import { gitError } from './useGit';
import { setWorktreePath, worktreePath } from './worktrees';
import { OverflowIcon } from '../ui';

interface WorktreeMenuProps {
  cwd: string;
  /** The thread's chosen base; the default branch when unset. */
  base?: string;
  diff: GitDiff | undefined;
  run: <T>(label: string, action: () => Promise<T>) => Promise<T | undefined>;
  confirm: (request: ConfirmRequest) => Promise<boolean>;
  /** Items after the worktree's own: the pane's, when this is the pane header's one ⋯. */
  children?: ReactNode;
}

/** The thread's worktree: where it is, its size, sync with base, and cleanup of settled threads' worktrees. */
export function WorktreeMenu({ cwd, base: chosenBase, diff, run, confirm, children }: WorktreeMenuProps) {
  const bytes = useDiskUsage(cwd);
  const settled = useSettledWorktrees();
  const base = diff?.base ?? chosenBase ?? 'base';

  const sync = async () => {
    const result = await run(`Sync with ${base}`, () => host.git.sync(cwd, chosenBase));
    if (!result) return;
    if (result.conflicts.length) toast.warning(`Merged ${result.base} with conflicts`, { description: result.conflicts.join('\n') });
    else toast.success(`Up to date with ${result.base}`);
  };

  const cleanUp = async () => {
    const ok = await confirm({
      title: `Remove ${settled.length === 1 ? '1 worktree' : `${settled.length} worktrees`}?`,
      description: (
        <div className="flex flex-col gap-2">
          <p>Worktrees of settled threads are deleted from disk. Their branches stay, and a worktree with uncommitted changes is kept.</p>
          <ul className="flex flex-col gap-0.5 font-mono text-xs">
            {settled.map((w) => (
              <li key={w.threadId} className="truncate" title={w.path}>
                {w.path}
              </li>
            ))}
          </ul>
        </div>
      ),
      confirm: 'Remove worktrees',
      cancel: 'Keep them',
      isDestructive: true,
    });
    if (!ok) return;
    const results = await Promise.allSettled(settled.map((w) => host.git.removeWorktree(w.path).then(() => setWorktreePath(w.threadId, null))));
    const failed = results.flatMap((r, i) => (r.status === 'rejected' ? [`${settled[i].title}: ${gitError(r.reason)}`] : []));
    if (failed.length) toast.error(`Kept ${failed.length} of ${settled.length} worktrees`, { description: failed.join('\n') });
    else toast.success(`Removed ${settled.length} worktrees`);
  };

  return (
    <DropdownMenu onOpenChange={(open) => open && bytes.refresh()}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="More Changes actions" className="text-muted-foreground">
          <OverflowIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel className="flex flex-col gap-0.5">
          <span className="truncate font-mono text-xs text-foreground">{diff ? `${diff.branch} → ${diff.base}` : 'Worktree'}</span>
          <span className="truncate font-mono type-caption font-normal text-subtle-foreground" title={cwd}>
            {cwd}
          </span>
          <span className="type-caption font-normal text-subtle-foreground tabular">{diskLabel(bytes.value)}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem onSelect={sync}>
            <ArrowDown />
            Sync with {base}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => navigator.clipboard?.writeText(cwd).catch(() => undefined)}>
            <Copy />
            Copy worktree path
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={settled.length === 0} onSelect={cleanUp}>
          <Broom />
          {settled.length ? `Clean up settled worktrees (${settled.length})` : 'No settled worktrees to clean up'}
        </DropdownMenuItem>
        {!!children && (
          <>
            <DropdownMenuSeparator />
            {children}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function useDiskUsage(cwd: string) {
  const [value, setValue] = useState<number>();
  const refresh = () => {
    setValue(undefined);
    host.git.diskUsage(cwd).then(setValue, () => setValue(Number.NaN));
  };
  return { value, refresh };
}

function useSettledWorktrees() {
  const { state } = useHarness();
  return state.threads.flatMap((t) => {
    const path = t.status === 'settled' ? worktreePath(t.id) : undefined;
    return path ? [{ threadId: t.id, title: t.title, path }] : [];
  });
}

const MB = new Intl.NumberFormat(undefined, { style: 'unit', unit: 'megabyte', maximumFractionDigits: 1 });
const GB = new Intl.NumberFormat(undefined, { style: 'unit', unit: 'gigabyte', maximumFractionDigits: 1 });

function diskLabel(bytes: number | undefined) {
  if (bytes === undefined) return 'Measuring disk usage…';
  if (Number.isNaN(bytes)) return 'Disk usage unavailable';
  return `${bytes >= 1e9 ? GB.format(bytes / 1e9) : MB.format(bytes / 1e6)} on disk`;
}
