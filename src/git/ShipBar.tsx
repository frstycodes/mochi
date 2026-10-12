import { useState } from 'react';
import { ArrowUpRight, BranchUp, ChevronDown, ClockCircle, CloseCircle, MinusCircle, TickCircle } from 'reicon-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { host } from '../host';
import type { CheckState, GitDiff, PrCheck, PrInfo } from '../host/types/git';
import type { Thread } from '../model';
import { useProfiles } from '../profiles';
import type { ConfirmRequest } from './useConfirm';
import { usePr } from './useGit';
import { isMod } from '../keys';

interface ShipBarProps {
  thread: Thread;
  cwd: string;
  diff: GitDiff;
  canCommit: boolean;
  run: <T>(label: string, action: () => Promise<T>) => Promise<T | undefined>;
  confirm: (request: ConfirmRequest) => Promise<boolean>;
}

/** Commit staged changes, push the branch, open a PR and watch its checks. Push and PR ask first: both are visible to others. */
export function ShipBar({ thread, cwd, diff, canCommit, run, confirm }: ShipBarProps) {
  const [message, setMessage] = useState('');
  const [isChecksOpen, setChecksOpen] = useState(false);
  const githubUser = useProfiles().find((p) => p.id === thread.spaceId)?.github || undefined;
  const prQuery = usePr(cwd, githubUser);
  const pr = prQuery.data;
  const stagedCount = diff.files.filter((f) => f.staged).length;

  const commit = async () => {
    const sha = await run('Commit', () => host.git.commit(cwd, message));
    if (!sha) return;
    setMessage('');
    toast.success(`Committed ${sha}`);
  };

  const push = async () => {
    const ok = await confirm({
      title: `Push ${diff.branch}?`,
      description: `Your commits go to origin/${diff.branch}, where everyone with access to the repository can see them.`,
      confirm: 'Push branch',
      cancel: 'Not now',
    });
    if (!ok) return;
    await run('Push', () => host.git.push(cwd));
    await prQuery.refresh();
  };

  const createPr = async () => {
    const ok = await confirm({
      title: 'Open a pull request?',
      description: `"${thread.title}" from ${diff.branch} into ${diff.base.replace(/^origin\//, '')}${githubUser ? `, opened as ${githubUser}` : ''}. GitHub notifies the repository's watchers.`,
      confirm: 'Create pull request',
      cancel: 'Not now',
    });
    if (!ok) return;
    const url = await run('Create pull request', () => host.git.createPr(cwd, { title: thread.title, body: thread.goal }, githubUser));
    if (url) toast.success('Pull request opened', { description: url });
    await prQuery.refresh();
  };

  return (
    <div className="flex shrink-0 flex-col gap-2 px-3 pt-2 pb-3">
      {canCommit && (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void commit();
          }}
        >
          <Textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && isMod(e) && e.currentTarget.form?.requestSubmit()}
            placeholder={stagedCount ? 'Commit message' : 'Stage changes to commit them'}
            aria-label="Commit message"
            className="min-h-14 resize-none text-sm"
          />
          <div className="flex items-center gap-2">
            <span className="flex-1 type-caption text-subtle-foreground tabular">{stagedCount ? `${stagedCount} staged` : 'Nothing staged'}</span>
            <Button type="submit" size="sm" disabled={!stagedCount || !message.trim()}>
              Commit
            </Button>
          </div>
        </form>
      )}
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={push}>
          <BranchUp data-icon="inline-start" />
          Push
        </Button>
        {pr ? <PrLink pr={pr} /> : <Button variant="ghost" size="sm" onClick={createPr} disabled={prQuery.isLoading}>Create pull request</Button>}
        {!!pr && pr.checks.length > 0 && <ChecksSummary checks={pr.checks} isOpen={isChecksOpen} onToggle={() => setChecksOpen((o) => !o)} />}
      </div>
      {!!pr && isChecksOpen && <CheckList checks={pr.checks} />}
      {!!prQuery.error && <p className="type-caption text-subtle-foreground">PR status unavailable: {prQuery.error}</p>}
    </div>
  );
}

function PrLink({ pr }: { pr: PrInfo }) {
  return (
    <Button variant="ghost" size="sm" asChild className="min-w-0">
      <a href={pr.url} target="_blank" rel="noreferrer">
        <span className="tabular text-success">#{pr.number}</span>
        <span className="truncate text-muted-foreground lowercase">{pr.state}</span>
        <ArrowUpRight data-icon="inline-end" className="text-subtle-foreground" />
      </a>
    </Button>
  );
}

const CHECK = {
  pass: { icon: TickCircle, className: 'text-success', label: 'Passed' },
  fail: { icon: CloseCircle, className: 'text-destructive', label: 'Failed' },
  pending: { icon: ClockCircle, className: 'text-warning', label: 'Running' },
  skipping: { icon: MinusCircle, className: 'text-subtle-foreground', label: 'Skipped' },
  cancel: { icon: MinusCircle, className: 'text-subtle-foreground', label: 'Cancelled' },
} satisfies Record<CheckState, { icon: typeof TickCircle; className: string; label: string }>;

// Worst state first, so the summary icon is the one that needs you.
const SEVERITY = ['fail', 'pending', 'cancel', 'skipping', 'pass'] satisfies CheckState[];

function ChecksSummary({ checks, isOpen, onToggle }: { checks: PrCheck[]; isOpen: boolean; onToggle: () => void }) {
  const worst = SEVERITY.find((state) => checks.some((c) => c.state === state))!;
  const { icon: Icon, className } = CHECK[worst];
  const failed = checks.filter((c) => c.state === 'fail').length;
  const passed = checks.filter((c) => c.state === 'pass').length;
  return (
    <Button variant="ghost" size="sm" aria-expanded={isOpen} onClick={onToggle} className="ml-auto text-muted-foreground">
      <Icon data-icon="inline-start" className={className} />
      <span className="tabular">{failed ? `${failed} failing` : `${passed}/${checks.length} checks`}</span>
      <ChevronDown data-icon="inline-end" className={cn('text-subtle-foreground transition-transform duration-150', isOpen && 'rotate-180')} />
    </Button>
  );
}

function CheckList({ checks }: { checks: PrCheck[] }) {
  return (
    <ul className="flex flex-col gap-0.5" aria-label="PR checks">
      {checks.map((check) => {
        const { icon: Icon, className, label } = CHECK[check.state];
        return (
          <li key={check.name} className="flex h-6 items-center gap-2 px-1 type-meta">
            <Icon className={cn('size-3.5 shrink-0', className)} aria-label={label} />
            {check.link ? (
              <a href={check.link} target="_blank" rel="noreferrer" className="min-w-0 truncate text-muted-foreground hover:text-foreground">
                {check.name}
              </a>
            ) : (
              <span className="min-w-0 truncate text-muted-foreground">{check.name}</span>
            )}
            <span className="ml-auto shrink-0 type-caption text-subtle-foreground">{label}</span>
          </li>
        );
      })}
    </ul>
  );
}
