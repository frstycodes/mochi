import { useState } from 'react';
import { ArrowUpRight, ChevronDown, MessageText, Send } from '@/icons';
import { GitPullRequestIcon, PrStateIcon } from '@/icons/github';
import { MessageResponse } from '@/components/ai-elements/message';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { plural } from '@mochi/domain/lib/format';
import { STATUS_WORDS } from '@mochi/domain/chat/refs';
import { ChangeList, type ChangeActions } from '../git/ChangeList';
import { CheckList, ChecksSummary } from '../git/Checks';
import { checkTally, MergeButton, pickMethod } from '../git/MergeButton';
import { changeSections } from '../git/files';
import { threadPlace, threadPrompt } from '../git/prReview';
import { useConfirm } from '../git/useConfirm';
import { useGitAction, usePr, usePrReview } from '../git/useGit';
import { useGithubScope, useThreadPrs } from '../git/useThreadPrs';
import { useWorktreePath } from '../git/worktrees';
import { host } from '../host';
import { threadCwd } from '../host/cwd';
import type {
  MergeMethod,
  MergeMode,
  PrComment,
  PrReview,
  ReviewThread,
  ReviewVerdict,
} from '../host/types/git';
import { isMod } from '../keys';
import type { Thread } from '../model';
import { timeAgo } from '../progress';
import { setPrefs, usePrefs } from '../settings/prefs';
import { useDispatch } from '../store';
import { ChangesSkeleton, DiffError, useChangeActions } from './ChangesTab';
import { PaneActions, PaneTitle } from './PaneHeader';
import type { PaneTabProps } from './tabs';

export function PrTab({ thread }: PaneTabProps) {
  const cwd = useWorktreePath(thread.id) ?? threadCwd(thread);
  if (!cwd) return <NoPr />;
  return <PrPicker thread={thread} cwd={cwd} />;
}

function PrPicker({ thread, cwd }: { thread: Thread; cwd: string }) {
  const prs = usePrChoices(thread, cwd);
  const [picked, setPicked] = useState<number | null>(null);
  if (prs.length === 0) return <NoPr />;
  const number = prs.some((p) => p.number === picked) ? picked! : prs[0].number;
  return (
    <>
      {prs.length > 1 && (
        <PaneTitle>
          <NativeSelect
            size="sm"
            value={number}
            onChange={(e) => setPicked(Number(e.target.value))}
            aria-label="Pull request"
          >
            {prs.map((p) => (
              <NativeSelectOption key={p.number} value={p.number}>
                #{p.number} {p.title}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </PaneTitle>
      )}
      <PrView key={number} thread={thread} cwd={cwd} number={number} />
    </>
  );
}

/** The thread's recorded PRs, most-needs-you first; before it has recorded one, the PR gh finds on the worktree's branch. */
function usePrChoices(thread: Thread, cwd: string) {
  const recorded = useThreadPrs(thread);
  const branchQuery = usePr(cwd, useGithubScope(thread).githubUser);
  if (recorded.length > 0)
    return recorded.map((p) => ({ number: p.pr.number, title: p.pr.title }));
  return branchQuery.data
    ? [{ number: branchQuery.data.number, title: branchQuery.data.title }]
    : [];
}

function PrView({
  thread,
  cwd,
  number,
}: {
  thread: Thread;
  cwd: string;
  number: number;
}) {
  const { githubUser } = useGithubScope(thread);
  const reviewQuery = usePrReview(cwd, number, githubUser);
  const { run, pending } = useGitAction(reviewQuery.refresh);
  const { confirm, dialog } = useConfirm();
  const { diffStyle, mergeMethod: preferred } = usePrefs();
  const changeActions = useChangeActions({
    thread,
    cwd,
    canStage: false,
    diffStyle,
    run,
    confirm,
  });
  const prActions = usePrActions({
    thread,
    cwd,
    number,
    githubUser,
    run,
  });

  const review = reviewQuery.data;
  if (reviewQuery.error && !review)
    return (
      <DiffError message={reviewQuery.error} onRetry={reviewQuery.refresh} />
    );
  if (review === undefined) return <ChangesSkeleton />;
  if (review === null) return <NoPr />;

  const actions: ChangeActions = {
    ...changeActions,
    review: {
      threads: review.threads,
      renderThread: (t) => (
        <div className="m-2">
          <ThreadCard thread={t} review={review} actions={prActions} />
        </div>
      ),
    },
  };
  const mergeMethod = pickMethod(review.mergeMethods, preferred);
  const unplaced = review.threads.filter((t) => !threadPlace(t, review.files));
  const isOpen = review.state === 'OPEN';

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PaneActions>
        {isOpen && !review.isDraft && review.mergeMethods.length > 0 && (
          <MergeButton
            head={review.head}
            base={review.base}
            tally={checkTally(review.checks)}
            checks={review.checks}
            isConflicting={review.isConflicting}
            method={mergeMethod}
            allowed={review.mergeMethods}
            isBusy={!!pending}
            onMethodChange={(m) => setPrefs({ mergeMethod: m })}
            onMerge={prActions.merge}
          />
        )}
        <Button
          asChild
          size="xs"
          variant="ghost"
          className="text-muted-foreground"
        >
          <a href={review.url} target="_blank" rel="noreferrer">
            GitHub
            <ArrowUpRight data-icon="inline-end" />
          </a>
        </Button>
      </PaneActions>
      {/* Radix lays the viewport content out as `display: table`, which grows to the widest diff line instead of scrolling it. */}
      <ScrollArea
        type="scroll"
        className="min-h-0 flex-1 border-t [&_[data-slot=scroll-area-viewport]>div]:block!"
      >
        <div className="flex flex-col gap-4 px-3 py-3">
          <PrHeader review={review} />
          {!!review.body.trim() && <Markdown text={review.body} />}
          {review.checks.length > 0 && <Checks review={review} />}
          <Section title="Conversation" count={review.comments.length}>
            {review.comments.map((c) => (
              <CommentRow key={c.id} comment={c} />
            ))}
            {isOpen && (
              <Composer
                review={review}
                isBusy={!!pending}
                actions={prActions}
              />
            )}
          </Section>
          {unplaced.length > 0 && (
            <Section title="File and outdated threads" count={unplaced.length}>
              {unplaced.map((t) => (
                <ThreadCard
                  key={t.id}
                  thread={t}
                  review={review}
                  actions={prActions}
                  showPath
                />
              ))}
            </Section>
          )}
        </div>
        <Section title="Files" count={review.files.length} className="px-3">
          <ChangeList
            sections={changeSections(review.files, false)}
            actions={actions}
          />
        </Section>
      </ScrollArea>
      {dialog}
    </div>
  );
}

interface PrActionsInput {
  thread: Thread;
  cwd: string;
  number: number;
  githubUser?: string;
  run: ReturnType<typeof useGitAction>['run'];
}

type PrActions = ReturnType<typeof usePrActions>;

function usePrActions({
  thread,
  cwd,
  number,
  githubUser,
  run,
}: PrActionsInput) {
  const dispatch = useDispatch();
  const agentName = thread.providers[0] === 'codex' ? 'Codex' : 'Claude';
  return {
    agentName,
    comment: (body: string) =>
      run('Comment', () => host.git.commentPr(cwd, number, body, githubUser)),
    review: (verdict: ReviewVerdict, body: string) =>
      run(VERDICT_LABELS[verdict], () =>
        host.git.reviewPr(cwd, number, verdict, body, githubUser),
      ),
    reply: (t: ReviewThread, body: string) =>
      run('Reply', () => host.git.replyThread(cwd, t.id, body, githubUser)),
    resolve: (t: ReviewThread) =>
      run(t.isResolved ? 'Unresolve' : 'Resolve', () =>
        host.git.resolveThread(cwd, t.id, !t.isResolved, githubUser),
      ),
    send: (t: ReviewThread, review: PrReview) =>
      dispatch({
        type: 'say',
        threadId: thread.id,
        entry: { who: 'you', kind: 'message', text: threadPrompt(t, review) },
      }),
    merge: (method: MergeMethod, mode: MergeMode) =>
      run(mode === 'auto' ? 'Merge when ready' : 'Merge', () =>
        host.git.mergePr(cwd, number, method, mode, githubUser),
      ),
  };
}

const VERDICT_LABELS = {
  approve: 'Approve',
  'request-changes': 'Request changes',
  comment: 'Review',
} satisfies Record<ReviewVerdict, string>;

function PrHeader({ review }: { review: PrReview }) {
  const status =
    review.state === 'OPEN'
      ? review.isDraft
        ? 'draft'
        : 'open'
      : review.state === 'MERGED'
        ? 'merged'
        : 'closed';
  return (
    <header className="flex flex-col gap-1">
      <h2 className="type-heading text-foreground">
        {review.title}{' '}
        <span className="tabular text-subtle-foreground">#{review.number}</span>
      </h2>
      <p className="flex flex-wrap items-center gap-1.5 type-meta text-muted-foreground">
        <PrStateIcon state={status} className="size-3.5" />
        <span>{STATUS_WORDS[status]}</span>
        <span>
          {review.author} wants to merge{' '}
          <code className="font-mono text-xs">{review.head}</code> into{' '}
          <code className="font-mono text-xs">{review.base}</code>
        </span>
        {review.isConflicting && <Badge variant="destructive">Conflicts</Badge>}
      </p>
    </header>
  );
}

function Checks({ review }: { review: PrReview }) {
  const [isOpen, setOpen] = useState(
    review.checks.some((c) => c.state === 'fail'),
  );
  return (
    <div className="flex flex-col gap-1">
      <ChecksSummary
        checks={review.checks}
        isOpen={isOpen}
        onToggle={() => setOpen((o) => !o)}
      />
      {isOpen && <CheckList checks={review.checks} />}
    </div>
  );
}

function Section({
  title,
  count,
  className,
  children,
}: {
  title: string;
  count: number;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-label={title} className="flex flex-col gap-2">
      <h3
        className={cn(
          'flex items-center gap-1.5 type-caption text-subtle-foreground',
          className,
        )}
      >
        {title}
        <span className="tabular">{count}</span>
      </h3>
      {children}
    </section>
  );
}

function CommentRow({ comment }: { comment: PrComment }) {
  return (
    <article className="flex flex-col gap-1 rounded-lg border bg-card px-3 py-2">
      <p className="flex items-center gap-1.5 type-meta">
        <span className="font-medium text-foreground">{comment.author}</span>
        {!!comment.verdict && (
          <Badge
            variant={
              comment.verdict === 'approved' ? 'secondary' : 'destructive'
            }
          >
            {comment.verdict === 'approved' ? 'Approved' : 'Changes requested'}
          </Badge>
        )}
        {!!comment.at && (
          <span className="ml-auto type-caption text-subtle-foreground">
            {ago(comment.at)}
          </span>
        )}
      </p>
      {!!comment.body.trim() && <Markdown text={comment.body} />}
    </article>
  );
}

function Markdown({ text }: { text: string }) {
  return (
    // PR bodies open with `## Summary`-style headings; capped so none outranks the PR's own title.
    <div className="min-w-0 text-sm text-foreground [&_:is(h1,h2,h3,h4)]:type-title">
      <MessageResponse isAnimating={false}>{text}</MessageResponse>
    </div>
  );
}

function Composer({
  review,
  isBusy,
  actions,
}: {
  review: PrReview;
  isBusy: boolean;
  actions: PrActions;
}) {
  const [text, setText] = useState('');
  const isOwn = review.author === review.viewer;
  const body = text.trim();
  const submit = async (action: () => Promise<unknown>) => {
    await action();
    setText('');
  };
  return (
    <div className="flex flex-col gap-2">
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) =>
          e.key === 'Enter' &&
          isMod(e) &&
          body &&
          void submit(() => actions.comment(body))
        }
        placeholder="Leave a comment"
        aria-label="Comment on the pull request"
        className="min-h-16 resize-none text-sm"
      />
      <div className="flex flex-wrap justify-end gap-1.5">
        {/* GitHub refuses a review of your own PR. */}
        {!isOwn && (
          <>
            <Button
              size="sm"
              variant="ghost"
              disabled={isBusy || !body}
              onClick={() =>
                submit(() => actions.review('request-changes', body))
              }
            >
              Request changes
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={isBusy}
              onClick={() => submit(() => actions.review('approve', body))}
            >
              Approve
            </Button>
          </>
        )}
        <Button
          size="sm"
          disabled={isBusy || !body}
          onClick={() => submit(() => actions.comment(body))}
        >
          Comment
        </Button>
      </div>
    </div>
  );
}

function ThreadCard({
  thread,
  review,
  actions,
  showPath,
}: {
  thread: ReviewThread;
  review: PrReview;
  actions: PrActions;
  showPath?: boolean;
}) {
  const [isOpen, setOpen] = useState(!thread.isResolved);
  const [reply, setReply] = useState<string | null>(null);
  const [first] = thread.comments;
  const send = async () => {
    if (!reply?.trim()) return;
    await actions.reply(thread, reply.trim());
    setReply(null);
  };
  return (
    <div className="flex flex-col rounded-lg border bg-background font-sans">
      <button
        type="button"
        aria-expanded={isOpen}
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 text-left type-meta outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <ChevronDown
          aria-hidden
          className={cn(
            'size-3 shrink-0 text-subtle-foreground transition-transform duration-150',
            !isOpen && '-rotate-90',
          )}
        />
        <MessageText
          aria-hidden
          className="size-3.5 shrink-0 text-subtle-foreground"
        />
        <span className="min-w-0 truncate text-muted-foreground">
          {showPath ? thread.path : (first?.author ?? 'Thread')}
        </span>
        <span className="ml-auto shrink-0 type-caption text-subtle-foreground">
          {thread.isResolved ? 'Resolved · ' : ''}
          {thread.comments.length}{' '}
          {plural(thread.comments.length, 'comment', 'comments')}
        </span>
      </button>
      {isOpen && (
        <div className="flex flex-col gap-2 border-t px-2.5 py-2">
          {thread.comments.map((c) => (
            <div key={c.id} className="flex flex-col gap-0.5">
              <p className="flex items-center gap-1.5 type-meta">
                <span className="font-medium text-foreground">{c.author}</span>
                {!!c.at && (
                  <span className="type-caption text-subtle-foreground">
                    {ago(c.at)}
                  </span>
                )}
              </p>
              <Markdown text={c.body} />
            </div>
          ))}
          {reply !== null && (
            <Textarea
              autoFocus
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && isMod(e)) void send();
                if (e.key === 'Escape') setReply(null);
              }}
              placeholder="Reply on GitHub"
              aria-label={`Reply to the thread on ${thread.path}`}
              className="min-h-14 resize-none text-sm"
            />
          )}
          <div className="flex flex-wrap justify-end gap-1.5">
            {reply === null ? (
              <Button size="xs" variant="ghost" onClick={() => setReply('')}>
                Reply
              </Button>
            ) : (
              <>
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => setReply(null)}
                >
                  Cancel
                </Button>
                <Button
                  size="xs"
                  disabled={!reply.trim()}
                  onClick={() => void send()}
                >
                  Reply
                </Button>
              </>
            )}
            <Button
              size="xs"
              variant="ghost"
              onClick={() => void actions.resolve(thread)}
            >
              {thread.isResolved ? 'Unresolve' : 'Resolve'}
            </Button>
            <Button
              size="xs"
              variant="outline"
              onClick={() => actions.send(thread, review)}
            >
              <Send data-icon="inline-start" />
              Send to {actions.agentName}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function NoPr() {
  return (
    <Empty className="flex-1">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <GitPullRequestIcon />
        </EmptyMedia>
        <EmptyTitle>No pull request</EmptyTitle>
        <EmptyDescription>
          Once this thread opens a PR, its conversation, checks and review
          threads show here.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

const ago = (at: string) =>
  timeAgo(Math.max(0, (Date.now() - Date.parse(at)) / 60_000));
