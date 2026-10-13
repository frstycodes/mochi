import { ClipboardText } from 'reicon-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { Thread } from '../model';
import { CriteriaList } from './CriteriaList';
import { currentReport } from './report';

/** The end of a turn of work, read in seconds: what needs you, what's done, what's left; the reply stays above. */
export function ReportCard({ thread }: { thread: Thread }) {
  const view = currentReport(thread);
  if (!view) return null;
  const { report, criteria, met, isReady, changes } = view;
  const status = isReady ? 'Ready for review' : criteria.length ? `${met} of ${criteria.length} criteria done` : 'Turn done';
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
        {changes.files.length > 0 && (
          <p className="tabular type-caption text-subtle-foreground">
            <span className="text-success">+{changes.added}</span> <span className="text-destructive">−{changes.removed}</span> in {changes.files.length} {changes.files.length === 1 ? 'file' : 'files'}
            {thread.prs.length > 0 && ` · ${thread.prs.map((p) => `#${p.number} ${p.state}`).join(', ')}`}
          </p>
        )}
      </CardContent>
    </Card>
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
