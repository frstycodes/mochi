import { ClipboardText } from 'reicon-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { Thread } from '../model';
import { RefChip } from '../chat/ChatLink';
import { TurnChangesCard } from '../chat/TurnChangesCard';
import { useThreadPrs } from '../git/useThreadPrs';
import { useHarness } from '../store';
import { CriteriaList } from './CriteriaList';
import { currentReport, NEXT_STEP_TITLES, nextStep, type NextStep } from './report';

/** The end of a turn of work, read in seconds: what needs you, what's done, what's left; the reply stays above. */
export function ReportCard({ thread }: { thread: Thread }) {
  const prs = useThreadPrs(thread);
  const view = currentReport(thread);
  if (!view) return null;
  const { report, criteria, met, isReady, changes } = view;
  const next = isReady ? nextStep(prs.map((p) => p.state.status)) : null;
  const status = next ? NEXT_STEP_TITLES[next] : criteria.length ? `${met} of ${criteria.length} criteria done` : 'Turn done';
  const hasAction = !!next && next !== 'review' && !!thread.repo && thread.status !== 'settled';
  return (
    <Card size="sm" role="group" aria-label="Report">
      <CardHeader>
        <CardDescription className="flex items-center gap-1 type-caption font-medium text-foreground">
          <ClipboardText aria-hidden className="size-3.5" />
          Report
        </CardDescription>
        <CardTitle className={cn(isReady && 'text-success')}>{status}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {!!report.question && (
          <p className="flex gap-2 type-body text-pretty">
            <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-warning" />
            <span>
              <span className="font-medium text-warning">Needs you: </span>
              {report.question}
            </span>
          </p>
        )}
        {criteria.length > 0 && <CriteriaList thread={thread} />}
        <ReportList label="Decided" items={report.decisions} />
        <ReportList label="Left" items={report.left} />
        {!!changes && <TurnChangesCard thread={thread} turn={changes} />}
        {prs.length > 0 && (
          <p className="flex flex-wrap gap-1.5">
            {prs.map((p) => !!p.githubRef && <RefChip key={p.pr.number} githubRef={p.githubRef} />)}
          </p>
        )}
      </CardContent>
      {hasAction && (
        <CardFooter className="justify-end">
          <NextStepButton thread={thread} step={next} />
        </CardFooter>
      )}
    </Card>
  );
}

/** The one thing a met goal waits on that you can do from here; a PR under review waits on GitHub, so its chip is enough. */
function NextStepButton({ thread, step }: { thread: Thread; step: Exclude<NextStep, 'review'> }) {
  const { dispatch } = useHarness();
  if (step === 'settle')
    return (
      <Button size="sm" onClick={() => dispatch({ type: 'settle', threadId: thread.id })}>
        Settle thread
      </Button>
    );
  return (
    <Button size="sm" onClick={() => dispatch({ type: 'send', threadId: thread.id, text: 'Open the pull request for this work with open_pr.', reason: 'Open pull request from the report' })}>
      Open pull request
    </Button>
  );
}

function ReportList({ label, items }: { label: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <section aria-label={label} className="flex flex-col gap-1">
      <h3 className="type-caption font-medium text-subtle-foreground">{label}</h3>
      <ul className="flex list-disc flex-col gap-0.5 pl-4 type-meta text-muted-foreground marker:text-subtle-foreground">
        {items.map((item) => (
          <li key={item} className="text-pretty">
            {item}
          </li>
        ))}
      </ul>
    </section>
  );
}
