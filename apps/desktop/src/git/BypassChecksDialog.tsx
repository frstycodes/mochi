import { Warning, GitBranch, ArrowLeft } from '@/icons';
import { ProgressRing } from '../ui';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog';
import { CHECK } from './Checks';
import {
  finishedChecksFirst,
  mergeCheckSummary,
  mergeCheckTitle,
} from './mergeChecks';
import type { CheckTally } from './MergeButton';
import type { PrCheck } from '../host/types/git';

export function BypassChecksDialog({
  open,
  onOpenChange,
  head,
  base,
  tally,
  checks,
  checksError,
  onBypass,
  onAutoMerge,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  head: string;
  base: string;
  tally: CheckTally;
  checks?: PrCheck[];
  checksError?: boolean;
  onBypass: () => void;
  onAutoMerge: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-[calc(100%-2rem)] sm:max-w-xl max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <AlertDialogHeader className="flex flex-col items-stretch gap-2 text-left">
          <div className="flex items-center gap-2">
            <Warning
              aria-hidden="true"
              className="size-5 shrink-0 text-warning"
            />
            <AlertDialogTitle>{mergeCheckTitle(tally)}</AlertDialogTitle>
          </div>
          <AlertDialogDescription>
            Review the checks before merging. Bypassing merges immediately, even
            if checks fail or are still running.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div
          aria-label={`Merge ${head} into ${base}`}
          className="flex min-w-0 items-center gap-2 [&>span:first-child]:max-w-[40%] [&>span:first-child]:shrink-0"
        >
          <BranchChip name={base} label="Base branch" />
          <ArrowLeft
            aria-hidden="true"
            className="size-4 shrink-0 text-muted-foreground"
          />
          <BranchChip name={head} label="Head branch" />
        </div>
        <section aria-label="Check statuses" className="min-w-0">
          <div className="mb-2 flex items-baseline justify-between gap-2">
            <h2 className="type-body font-medium">Checks</h2>
            <span className="type-meta text-muted-foreground">
              {checks && mergeCheckSummary(checks)}
            </span>
          </div>
          {checks?.length ? (
            <div className="max-h-56 overflow-y-auto rounded-lg border p-2">
              <MergeCheckList checks={checks} />
            </div>
          ) : (
            <p role="status" className="type-meta text-muted-foreground">
              {checksError
                ? 'Could not load check details. The counts above are the last known status.'
                : checks
                  ? 'No check details are available.'
                  : 'Loading check details…'}
            </p>
          )}
          {!!checks?.length && checksError && (
            <p role="status" className="mt-2 type-meta text-muted-foreground">
              Could not refresh checks. Showing their last known status.
            </p>
          )}
        </section>
        <p className="type-meta text-muted-foreground">
          {tally.failed
            ? 'Review the failed check before merging.'
            : 'Merge when ready waits for required checks and reviews to pass.'}{' '}
          Bypassing branch rules may require admin rights.
        </p>
        <AlertDialogFooter>
          <AlertDialogCancel>Not yet</AlertDialogCancel>
          {!tally.failed && (
            <AlertDialogAction variant="outline" onClick={onAutoMerge}>
              Merge when ready
            </AlertDialogAction>
          )}
          <AlertDialogAction variant="danger" onClick={onBypass}>
            Bypass checks and merge
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function BranchChip({ name, label }: { name: string; label: string }) {
  return (
    <span
      aria-label={`${label}: ${name}`}
      title={`${label}: ${name}`}
      className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-md bg-accent px-2 py-1 text-foreground"
    >
      <GitBranch
        aria-hidden="true"
        className="size-3.5 shrink-0 text-muted-foreground"
      />
      <code className="min-w-0 break-all type-meta">{name}</code>
    </span>
  );
}

function MergeCheckList({ checks }: { checks: PrCheck[] }) {
  return (
    <ul aria-label="PR checks" className="divide-y divide-border">
      {finishedChecksFirst(checks).map((check) => (
        <MergeCheck key={check.name} check={check} />
      ))}
    </ul>
  );
}

function MergeCheck({ check }: { check: PrCheck }) {
  const status = CHECK[check.state];
  return (
    <li className="flex items-start gap-2.5 px-1 py-2 type-body">
      {check.state === 'pending' ? (
        <span
          role="status"
          aria-label="Running"
          className="mt-0.5 shrink-0 [&_circle:last-child]:stroke-warning"
        >
          <ProgressRing slot={1} size={16} isWorking />
        </span>
      ) : (
        'icon' in status && (
          <status.icon
            aria-hidden="true"
            className={`mt-0.5 size-4 shrink-0 ${status.tone}`}
          />
        )
      )}
      {check.link ? (
        <a
          href={check.link}
          target="_blank"
          rel="noreferrer"
          className="min-w-0 flex-1 break-words hover:underline"
        >
          {check.name}
        </a>
      ) : (
        <span className="min-w-0 flex-1 break-words">{check.name}</span>
      )}
      <span
        className={`shrink-0 type-meta ${check.state === 'pending' ? 'text-warning' : status.tone}`}
      >
        {status.label}
      </span>
    </li>
  );
}
