import { useState } from 'react';
import { FileIcon } from '@react-symbols/icons/utils';
import {
  ChevronRight,
  XCircle,
  Refresh,
  ArrowUp,
  ShieldX,
  ShieldCheck,
  Warning,
} from '@/icons';
import { Shimmer } from '@/components/ai-elements/shimmer';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { AgentLoader } from '../AgentLoader';
import {
  openFromScope,
  useThreadFiles,
  type ThreadFiles,
} from '../files/viewer';
import type { Thread } from '../model';
import { useDispatch } from '../store';
import { ProviderMark } from '../ui';
import { Expand } from '../WorkLog';
import { askSecondOpinion, sendFindings } from './run';
import {
  providerName,
  type Finding,
  type Review,
  type VerdictKind,
} from './verdict';

/** A second opinion in the chat: a work-log-style row while it runs, then its verdict card. */
export function SecondOpinionRow({
  thread,
  review,
}: {
  thread: Thread;
  review: Review;
}) {
  if (review.status === 'running') return <ReviewProgress review={review} />;
  if (review.isDismissed)
    return review.result ? (
      <DismissedReview thread={thread} review={review} />
    ) : null;
  if (review.status === 'failed')
    return <ReviewFailed thread={thread} review={review} />;
  return <VerdictCard thread={thread} review={review} />;
}

function ReviewProgress({ review }: { review: Review }) {
  const [isOpen, setOpen] = useState(false);
  const current = review.steps.at(-1);
  return (
    <div className="-mx-2 flex flex-col">
      <button
        type="button"
        aria-expanded={isOpen}
        onClick={() => setOpen((o) => !o)}
        className="flex h-7 cursor-default items-center gap-2 rounded-lg px-2 text-left type-meta text-muted-foreground hover:bg-accent/60 hover:text-foreground"
      >
        <ChevronRight
          className={cn(
            'size-3.5 shrink-0 text-subtle-foreground transition-transform duration-150',
            isOpen && 'rotate-90',
          )}
        />
        <AgentLoader
          phase={!current ? 'think' : READING.test(current) ? 'read' : 'run'}
          className="size-3.5 shrink-0 text-foreground"
        />
        <Shimmer
          as="span"
          className="min-w-0 truncate"
        >{`${providerName(review.provider)} is giving a second opinion${current ? ` · ${stepLabel(current)}` : '…'}`}</Shimmer>
      </button>
      <Expand isOpen={isOpen}>
        <ol className="flex flex-col pt-0.5 pl-10">
          {review.steps.map((step, i) => (
            <li
              key={i}
              className="flex h-7 min-w-0 items-center truncate type-meta text-subtle-foreground"
            >
              {step}
            </li>
          ))}
        </ol>
      </Expand>
    </div>
  );
}

const READING = /^(Read|Grep|Glob|Search)\b/;

// Claude steps read "Read: /abs/path", demo ones "Read src/a.ts", Codex ones are the shell command itself.
function stepLabel(step: string) {
  const [, verb, target = ''] = /^(\w+):?\s*(.*)$/.exec(step) ?? [];
  if (verb === 'Read') return `Reading ${target.split('/').pop()}`;
  if (verb === 'Grep' || verb === 'Glob' || verb === 'Search')
    return 'Searching the code';
  return step.length > 48 ? `${step.slice(0, 47)}…` : step;
}

const VERDICT = {
  approve: {
    label: 'Approve',
    icon: ShieldCheck,
    className: 'bg-success/10 text-success',
  },
  concerns: {
    label: 'Concerns',
    icon: Warning,
    className: 'bg-warning/8 text-warning',
  },
  block: {
    label: 'Block',
    icon: ShieldX,
    className: 'bg-destructive/10 text-destructive',
  },
} satisfies Record<VerdictKind, unknown>;

function VerdictBadge({ verdict }: { verdict: VerdictKind }) {
  const { label, icon: Icon, className } = VERDICT[verdict];
  return (
    <Badge variant="secondary" className={className}>
      <Icon aria-hidden />
      {label}
    </Badge>
  );
}

function VerdictCard({ thread, review }: { thread: Thread; review: Review }) {
  const dispatch = useDispatch();
  const files = useThreadFiles();
  const result = review.result!;
  const dismiss = () =>
    dispatch({
      type: 'review-update',
      threadId: thread.id,
      id: review.id,
      patch: { isDismissed: true },
    });
  return (
    <section
      data-file-scope
      aria-label={`${providerName(review.provider)}'s second opinion`}
      className="flex flex-col gap-3 rounded-xl border bg-card p-4"
    >
      <header className="flex min-w-0 items-center gap-2">
        <ProviderMark provider={review.provider} size={16} />
        <h3 className="min-w-0 truncate type-body font-medium text-foreground">
          {providerName(review.provider)}'s second opinion
        </h3>
        <VerdictBadge verdict={result.verdict} />
      </header>
      <p className="type-body text-pretty text-foreground">{result.summary}</p>
      {review.isTruncated && (
        <p className="type-caption text-subtle-foreground">
          The diff was too long to send whole; {providerName(review.provider)}{' '}
          saw its start and read the rest from the files.
        </p>
      )}
      {result.findings.length > 0 && (
        <ul className="-mx-2 flex flex-col gap-0.5">
          {result.findings.map((finding, i) => (
            <FindingRow key={i} finding={finding} files={files} />
          ))}
        </ul>
      )}
      <footer className="flex flex-wrap items-center justify-end gap-2">
        {review.isAgentAsked && (
          <p className="me-auto type-caption text-subtle-foreground">
            {providerName(thread.providers[0])} asked for this · sent to this
            thread
          </p>
        )}
        <Button variant="ghost" size="sm" onClick={dismiss}>
          Dismiss
        </Button>
        {!review.isAgentAsked && result.findings.length > 0 && (
          <Button
            variant="secondary"
            size="sm"
            disabled={review.isSent}
            onClick={() => sendFindings(thread, review, dispatch)}
          >
            <ArrowUp aria-hidden />
            {review.isSent
              ? 'Sent to this thread'
              : 'Send findings to this thread'}
          </Button>
        )}
      </footer>
    </section>
  );
}

const SEVERITY = {
  high: { label: 'High', className: 'text-destructive' },
  medium: { label: 'Medium', className: 'text-warning' },
  low: { label: 'Low', className: 'text-subtle-foreground' },
} satisfies Record<Finding['severity'], unknown>;

function FindingRow({
  finding,
  files,
}: {
  finding: Finding;
  files: ThreadFiles | null;
}) {
  const severity = SEVERITY[finding.severity];
  const link = finding.line ? `${finding.file}:${finding.line}` : finding.file;
  return (
    <li className="flex min-w-0 gap-3 rounded-lg px-2 py-1.5">
      <span
        className={cn(
          'w-12 shrink-0 type-meta font-medium',
          severity.className,
        )}
      >
        {severity.label}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {!!finding.file && (
          <button
            type="button"
            data-file-link={link}
            disabled={!files}
            onClick={(e) => files && openFromScope(e.currentTarget, files)}
            className="-mx-1 flex w-fit max-w-full min-w-0 cursor-default items-center gap-1.5 rounded-md px-1 font-mono text-xs hover:bg-accent/60 disabled:hover:bg-transparent"
          >
            <FileIcon
              fileName={finding.file.split('/').pop() ?? finding.file}
              autoAssign
              aria-hidden
              className="size-3.5 shrink-0"
            />
            <FilePath path={finding.file} line={finding.line} />
          </button>
        )}
        <p className="type-meta text-pretty text-muted-foreground">
          {finding.text}
        </p>
      </div>
    </li>
  );
}

function FilePath({ path, line }: { path: string; line?: number }) {
  const slash = path.lastIndexOf('/');
  return (
    <span className="flex min-w-0" title={path}>
      <span className="truncate text-subtle-foreground">
        {path.slice(0, slash + 1)}
      </span>
      <span className="shrink-0 text-foreground">{path.slice(slash + 1)}</span>
      {!!line && (
        <span className="shrink-0 text-subtle-foreground">:{line}</span>
      )}
    </span>
  );
}

function ReviewFailed({ thread, review }: { thread: Thread; review: Review }) {
  const dispatch = useDispatch();
  const name = providerName(review.provider);
  const dismiss = () =>
    dispatch({
      type: 'review-update',
      threadId: thread.id,
      id: review.id,
      patch: { isDismissed: true },
    });
  const retry = () => {
    dismiss();
    askSecondOpinion(thread, dispatch);
  };
  return (
    <div
      role="status"
      className="flex flex-col gap-2 rounded-xl border bg-card p-4"
    >
      <p className="flex items-center gap-2 type-body font-medium text-foreground">
        <XCircle aria-hidden className="size-4 shrink-0 text-destructive" />
        {name} couldn't give a second opinion
      </p>
      <p className="type-meta text-pretty break-words text-muted-foreground">
        {review.error}
      </p>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={dismiss}>
          Dismiss
        </Button>
        <Button variant="secondary" size="sm" onClick={retry}>
          <Refresh aria-hidden />
          Try again
        </Button>
      </div>
    </div>
  );
}

function DismissedReview({
  thread,
  review,
}: {
  thread: Thread;
  review: Review;
}) {
  const dispatch = useDispatch();
  return (
    <button
      type="button"
      onClick={() =>
        dispatch({
          type: 'review-update',
          threadId: thread.id,
          id: review.id,
          patch: { isDismissed: false },
        })
      }
      className="-mx-2 flex min-h-7 w-fit max-w-full cursor-default items-center gap-2 rounded-lg px-2 py-1 text-left type-meta text-subtle-foreground hover:bg-accent/60 hover:text-foreground"
    >
      <ProviderMark provider={review.provider} size={14} className="shrink-0" />
      <span className="min-w-0">
        {providerName(review.provider)}'s second opinion:{' '}
        {VERDICT[review.result!.verdict].label}{' '}
        <span className="text-muted-foreground">· Show</span>
      </span>
    </button>
  );
}
