import { useState } from 'react';
import { ArrowUp, ArrowUpRight, Sparkles } from '@/icons';
import { toast } from '@/toast/store';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { PrStateIcon } from '@/icons/github';
import type { RefStatus } from '@mochi/domain/chat/refs';
import { host } from '../host';
import type { GitDiff, PrInfo } from '../host/types/git';
import { CheckList, ChecksSummary } from './Checks';
import type { Thread } from '../model';
import { useProfiles } from '../profiles';
import type { ConfirmRequest } from './useConfirm';
import { refreshGithub, useBranchPr } from './githubWatch';
import { isMod } from '../keys';
import { TooltipIconButton } from '../ui';
import { commitPrompt, localCommit, parseCommit } from '../utility/prompts';
import { useDraft } from '../utility/useDraft';
import { PrDialog } from './PrDialog';
import { RefHoverCard } from '../chat/RefHoverCard';
import { useThreadPr } from './useThreadPrs';
import { openedPr } from './prs';
import { useDispatch } from '../store';

interface ShipBarProps {
  thread: Thread;
  cwd: string;
  diff: GitDiff;
  canCommit: boolean;
  run: <T>(label: string, action: () => Promise<T>) => Promise<T | undefined>;
  confirm: (request: ConfirmRequest) => Promise<boolean>;
}

/** Commit staged changes, push the branch, open a PR and watch its checks. Push and PR ask first: both are visible to others. */
export function ShipBar({
  thread,
  cwd,
  diff,
  canCommit,
  run,
  confirm,
}: ShipBarProps) {
  const [message, setMessage] = useState('');
  const [isChecksOpen, setChecksOpen] = useState(false);
  const githubUser =
    useProfiles().find((p) => p.id === thread.spaceId)?.github || undefined;
  const prQuery = useBranchPr(cwd, githubUser);
  const dispatch = useDispatch();
  const { pr } = prQuery;
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
      description: `Your commits go to origin/${diff.branch}${githubUser ? `, pushed as ${githubUser}` : ''}, where everyone with access to the repository can see them.`,
      confirm: 'Push branch',
      cancel: 'Not now',
    });
    if (!ok) return;
    await run('Push', () => host.git.push(cwd, githubUser));
    refreshGithub({ cwd, githubUser, isPush: true });
  };

  const [isPrOpen, setPrOpen] = useState(false);
  const commitDraft = useDraft('commit', thread.spaceId);
  const draftCommit = async () => {
    const staged = diff.files.filter((f) => f.staged);
    const text = await commitDraft.draft(commitPrompt(staged));
    // What you typed while it drafted wins.
    setMessage(
      (typed) => typed || (text && parseCommit(text)) || localCommit(staged),
    );
  };

  return (
    <div className="flex shrink-0 flex-col gap-2 px-2 pt-2 pb-2">
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
            onKeyDown={(e) =>
              e.key === 'Enter' &&
              isMod(e) &&
              e.currentTarget.form?.requestSubmit()
            }
            placeholder={
              commitDraft.isDrafting
                ? 'Drafting from the staged changes…'
                : stagedCount
                  ? 'Commit message'
                  : 'Stage changes to commit them'
            }
            aria-label="Commit message"
            className="min-h-14 resize-none text-sm"
          />
          <div className="flex items-center gap-2">
            <span className="flex-1 type-caption text-subtle-foreground tabular">
              {stagedCount ? `${stagedCount} staged` : 'Nothing staged'}
            </span>
            <TooltipIconButton
              label="Draft a message"
              hint={
                stagedCount
                  ? 'Written from the staged changes on your Background tasks model. Edit it before you commit.'
                  : 'Stage changes first.'
              }
              disabled={!stagedCount || commitDraft.isDrafting}
              onClick={draftCommit}
            >
              <Sparkles />
            </TooltipIconButton>
            <Button
              type="submit"
              size="sm"
              disabled={!stagedCount || !message.trim()}
            >
              Commit
            </Button>
          </div>
        </form>
      )}
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={push}
          className="text-muted-foreground"
        >
          <ArrowUp data-icon="inline-start" />
          Push
        </Button>
        {!!pr && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              dispatch({
                type: 'pane-open-tab',
                threadId: thread.id,
                kind: 'pr',
              })
            }
            className="text-muted-foreground"
          >
            Review
          </Button>
        )}
        {pr ? (
          <PrLink thread={thread} pr={pr} />
        ) : (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setPrOpen(true)}
            disabled={prQuery.isPending}
            className="text-muted-foreground"
          >
            Create pull request
          </Button>
        )}
        {!!pr && pr.checks.length > 0 && (
          <ChecksSummary
            checks={pr.checks}
            isOpen={isChecksOpen}
            onToggle={() => setChecksOpen((o) => !o)}
          />
        )}
      </div>
      {!!pr && isChecksOpen && <CheckList checks={pr.checks} />}
      {!!prQuery.error && (
        <p className="type-caption text-subtle-foreground">
          PR status unavailable: {prQuery.error}
        </p>
      )}
      {isPrOpen && (
        <PrDialog
          thread={thread}
          cwd={cwd}
          diff={diff}
          githubUser={githubUser}
          onCreate={async (pr) => {
            const url = await run('Create pull request', () =>
              host.git.createPr(cwd, pr, githubUser),
            );
            const opened = url && openedPr(url, pr.title);
            if (opened)
              dispatch({
                type: 'prs-seen',
                threadId: thread.id,
                prs: [opened],
              });
            if (url) toast.success('Pull request opened', { description: url });
            refreshGithub({ cwd, githubUser, isPush: true });
          }}
          onClose={() => setPrOpen(false)}
        />
      )}
    </div>
  );
}

const PR_STATUS: Record<string, RefStatus | undefined> = {
  OPEN: 'open',
  MERGED: 'merged',
  CLOSED: 'closed',
};

function PrLink({ thread, pr }: { thread: Thread; pr: PrInfo }) {
  const item = useThreadPr(thread, {
    number: pr.number,
    state: pr.state === 'MERGED' ? 'merged' : 'open',
    title: pr.title,
    url: pr.url,
  });
  return (
    <RefHoverCard item={item}>
      <Button variant="ghost" size="sm" asChild className="min-w-0">
        <a href={pr.url} target="_blank" rel="noreferrer">
          <PrStateIcon
            state={PR_STATUS[pr.state] ?? 'unknown'}
            hasConflicts={item.state?.hasConflicts}
          />
          <span className="tabular">#{pr.number}</span>
          <span className="truncate text-muted-foreground lowercase">
            {pr.state}
          </span>
          <ArrowUpRight
            data-icon="inline-end"
            className="text-subtle-foreground"
          />
        </a>
      </Button>
    </RefHoverCard>
  );
}
