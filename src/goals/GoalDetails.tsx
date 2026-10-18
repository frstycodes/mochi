import { ChevronRight, CloseCircle, TickCircle } from 'reicon-react';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Shimmer } from '@/components/ai-elements/shimmer';
import { cn } from '@/lib/utils';
import type { Author, Criterion, Revision, Thread } from '../model';
import { clock } from '../progress';
import { PROVIDER_NAME } from '../rewind/handoff';
import { CriteriaList } from './CriteriaList';
import { revisionDiff } from './edit';
import { currentReport } from './report';
import { ReportList, ReportQuestion } from './ReportCard';

/** The expanded goal: the outcome, what done means with its checks, the agent's last report, and the goal's history. */
export function GoalDetails({ thread }: { thread: Thread }) {
  return (
    <div className="flex flex-col gap-5">
      <p className="type-title text-pretty">{thread.goal}</p>
      {!!thread.criteria?.length && (
        <DetailSection title="Done when">
          <CriteriaList thread={thread} />
        </DetailSection>
      )}
      <LatestReport thread={thread} />
      <DetailSection title="History">
        <ol className="flex flex-col">
          {goalEvents(thread).map((e) => (
            <li key={e.key}>{e.kind === 'version' ? <VersionRow thread={thread} revision={e.revision} /> : <CriterionEventRow criterion={e.criterion} kind={e.kind} />}</li>
          ))}
        </ol>
      </DetailSection>
    </div>
  );
}

/** The last turn's report stays here after the chat's report card gives way to your next message. */
function LatestReport({ thread }: { thread: Thread }) {
  const { report } = thread;
  if (!report || (!report.question && !report.decisions.length && !report.left.length)) return null;
  const isStale = !currentReport(thread);
  return (
    <DetailSection title="Report" hint={`${PROVIDER_NAME[report.by]} · ${clock(report.at)}${isStale ? ' · before your last message' : ''}`}>
      <div className="flex flex-col gap-3">
        {isStale ? <ReportList label="Asked" items={report.question ? [report.question] : []} /> : <ReportQuestion report={report} />}
        <ReportList label="Decided" items={report.decisions} />
        <ReportList label="Left" items={report.left} />
      </div>
    </DetailSection>
  );
}

function DetailSection({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-1.5">
      <h3 className="flex items-baseline gap-2 type-meta text-subtle-foreground">
        {title}
        {!!hint && <span className="type-caption">{hint}</span>}
      </h3>
      {children}
    </section>
  );
}

type GoalEvent = { key: string; at: number } & ({ kind: 'version'; revision: Revision } | { kind: 'claim' | 'check'; criterion: Criterion });

/**
 * Versions (changes to what done means) and criteria claims and checks, newest first.
 * GAP: a criterion keeps only its latest claim and check, so earlier attempts don't show here.
 */
function goalEvents(thread: Thread): GoalEvent[] {
  const events: GoalEvent[] = thread.revisions.map((r) => ({ key: `v${r.n}`, at: r.at, kind: 'version', revision: r }));
  for (const c of thread.criteria ?? []) {
    if (c.claim) events.push({ key: `claim-${c.id}`, at: c.claim.at, kind: 'claim', criterion: c });
    if (c.check) events.push({ key: `check-${c.id}`, at: c.check.at, kind: 'check', criterion: c });
  }
  // Same minute: the version came first, so it sits below what followed it.
  return events.sort((a, b) => b.at - a.at || Number(a.kind === 'version') - Number(b.kind === 'version'));
}

function VersionRow({ thread, revision: r }: { thread: Thread; revision: Revision }) {
  const diff = revisionDiff(thread, r.n);
  return (
    <Collapsible className="group/rev">
      <CollapsibleTrigger disabled={diff.length === 0} className="flex w-full min-w-0 items-center gap-2 rounded-md px-1 py-1 text-left type-meta hover:bg-accent/60 disabled:hover:bg-transparent">
        <Badge variant="outline">v{r.n}</Badge>
        <span className="min-w-0 flex-1 truncate">
          {r.label}
          <span className="text-subtle-foreground"> · {AUTHOR_NAME[r.by]}</span>
        </span>
        <span className="tabular type-caption text-subtle-foreground">{clock(r.at)}</span>
        <ChevronRight aria-hidden className={cn('size-3 shrink-0 text-subtle-foreground transition-transform duration-150 group-data-[state=open]/rev:rotate-90', diff.length === 0 && 'invisible')} />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul aria-label={r.n > 1 ? `Changes from v${r.n - 1} to v${r.n}` : 'First goal'} className="flex flex-col gap-0.5 py-1 pl-10 type-caption">
          {diff.map((line, i) => (
            <li key={i} className="flex min-w-0 gap-1.5">
              <span aria-hidden className={cn('w-2 shrink-0 font-mono', DIFF_TONE[line[0] as DiffMark] ?? 'text-subtle-foreground')}>
                {line[0]}
              </span>
              <span className="min-w-0 text-muted-foreground text-pretty">{line.slice(2)}</span>
            </li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}

const AUTHOR_NAME = { ...PROVIDER_NAME, you: 'You', harness: 'Mochi' } satisfies Record<Author, string>;

type DiffMark = '+' | '−' | '~';
const DIFF_TONE = { '+': 'text-success', '−': 'text-destructive', '~': 'text-subtle-foreground' } satisfies Record<DiffMark, string>;

function CriterionEventRow({ criterion: c, kind }: { criterion: Criterion; kind: 'claim' | 'check' }) {
  const event = kind === 'claim' ? claimEvent(c) : checkEvent(c);
  const Icon = event.isFailed ? CloseCircle : TickCircle;
  return (
    <div className="flex min-w-0 items-start gap-2 px-1 py-1 type-meta">
      <Icon aria-hidden className={cn('mt-0.5 size-3.5 shrink-0', event.isFailed ? 'text-destructive' : kind === 'check' ? 'text-success' : 'text-subtle-foreground')} />
      <span className="flex min-w-0 flex-1 flex-col">
        {event.isRunning ? <Shimmer as="span">{event.title}</Shimmer> : <span>{event.title}</span>}
        <span className="truncate type-caption text-subtle-foreground">{c.text}</span>
      </span>
      <span className="tabular type-caption text-subtle-foreground">{clock(event.at)}</span>
    </div>
  );
}

function claimEvent(c: Criterion) {
  const claim = c.claim!;
  return { at: claim.at, title: `${PROVIDER_NAME[claim.by]} claimed it: ${claim.evidence}`, isFailed: false, isRunning: false };
}

function checkEvent(c: Criterion) {
  const check = c.check!;
  const seconds = Math.round((check.ms ?? 0) / 1000);
  const title = { running: 'Check running', passed: `Check passed in ${seconds}s`, failed: 'Check failed' }[check.status];
  return { at: check.at, title, isFailed: check.status === 'failed', isRunning: check.status === 'running' };
}
