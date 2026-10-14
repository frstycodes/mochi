import { useState } from 'react';
import { ChevronDown } from 'reicon-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { REF_CHIP_CLASS } from '@/icons/github';
import { cn } from '@/lib/utils';
import { authorName, isMet, type Thread, type TurnReport } from '../model';
import { RefChip } from '../chat/ChatLink';
import type { RefStatus } from '../chat/refs';
import { openTurn } from '../chat/turnChanges';
import { TurnChangesCard } from '../chat/TurnChangesCard';
import { useThreadPrs } from '../git/useThreadPrs';
import { useHarness } from '../store';
import { CriteriaList } from './CriteriaList';
import { nextStep, showsVerdictCard, type NextStep } from './report';
import { useIdleVerdict, VerdictIcon } from './VerdictChip';
import { verdictHeading, verdictTiles, type Gap, type Tile, type TileTone, type Verdict } from './verdict';

/**
 * The end of a turn of work, read in seconds: Mochi's verdict on why the agent stopped, the evidence behind it, the gaps with one
 * action each, then the agent's own decisions and what's left. `onJump` scrolls the transcript to the agent's quoted words.
 */
export function ReportCard({ thread, onJump }: { thread: Thread; onJump?: (quote: string) => void }) {
  const prs = useThreadPrs(thread);
  const verdict = useIdleVerdict(thread);
  if (!verdict || !showsVerdictCard(thread)) return null;
  const states = prs.map((p) => p.state);
  const heading = verdictHeading(verdict, thread);
  const report = thread.report && thread.report.at >= (thread.idle?.at ?? 0) - TURN_SLACK ? thread.report : undefined;
  const changes = openTurn(thread.activity);
  const criteria = thread.criteria ?? [];
  return (
    <Card size="sm" role="group" aria-label="Verdict" className="@container/card">
      <CardHeader className="flex items-center gap-2.5">
        <span className={cn('flex size-7 shrink-0 items-center justify-center rounded-md', REF_CHIP_CLASS[verdict.tone])}>
          <VerdictIcon kind={verdict.kind} className="size-4" />
        </span>
        <span className="flex min-w-0 flex-col">
          <CardTitle className={cn('truncate', VERDICT_TITLE_CLASS[verdict.tone])}>{heading.title}</CardTitle>
          <CardDescription className="truncate type-meta">{heading.detail}</CardDescription>
        </span>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <EvidenceTiles tiles={verdictTiles(thread, states, verdict)} isDim={verdict.kind === 'needs-you'} />
        {verdict.kind === 'needs-you' && <AskedQuestion text={verdict.reason} />}
        {verdict.gaps.length > 0 && <GapList thread={thread} gaps={verdict.gaps} onJump={onJump} />}
        {criteria.length > 0 && <CriteriaDisclosure thread={thread} />}
        {!!report && <ReportList label="Decided" items={report.decisions} />}
        {!!report && <ReportList label="Left" items={report.left} />}
        {!!changes && <TurnChangesCard thread={thread} turn={changes} />}
        {prs.length > 0 && (
          <p className="flex flex-wrap gap-1.5">
            {prs.map((p) => !!p.githubRef && <RefChip key={p.pr.number} githubRef={p.githubRef} />)}
          </p>
        )}
      </CardContent>
      <VerdictFooter thread={thread} verdict={verdict} prStates={states.map((s) => s.status)} />
    </Card>
  );
}

// The agent reports just before its turn ends, so its report lands a moment before Mochi's idle record.
const TURN_SLACK = 1;

const VERDICT_TITLE_CLASS = {
  success: 'text-success',
  warning: 'text-[color-mix(in_oklab,var(--warning)_75%,var(--foreground))]',
  destructive: 'text-[color-mix(in_oklab,var(--destructive)_75%,var(--foreground))]',
  muted: 'text-foreground',
} satisfies Record<Verdict['tone'], string>;

const BAR_CLASS = { success: 'bg-success', warning: 'bg-warning', destructive: 'bg-destructive', info: 'bg-info', merged: 'bg-merged', none: 'bg-foreground/15' } satisfies Record<TileTone, string>;

const VALUE_CLASS = { warning: 'text-[color-mix(in_oklab,var(--warning)_75%,var(--foreground))]', destructive: 'text-[color-mix(in_oklab,var(--destructive)_75%,var(--foreground))]', none: 'text-muted-foreground' } satisfies Record<NonNullable<Tile['tone']>, string>;

/** Five tiles, so the state scans without prose; dimmed while a question waits, since the answer comes first. */
function EvidenceTiles({ tiles, isDim }: { tiles: Tile[]; isDim: boolean }) {
  return (
    <ul aria-label="Evidence" className={cn('grid grid-cols-5 gap-1.5 @max-sm/card:grid-cols-3', isDim && 'opacity-60')}>
      {tiles.map((t) => (
        <li key={t.name} className="flex min-w-0 flex-col gap-1 rounded-md bg-muted px-2 py-1.5">
          <span className="truncate type-caption text-muted-foreground">{t.name}</span>
          <span aria-hidden className="flex gap-0.5">
            {t.bars.map((bar, i) => (
              <i key={i} className={cn('h-1 flex-1 rounded-full', BAR_CLASS[bar])} />
            ))}
          </span>
          <span className={cn('truncate type-meta', t.tone ? VALUE_CLASS[t.tone] : 'text-foreground')}>{t.value}</span>
        </li>
      ))}
    </ul>
  );
}

/** A question the agent asked in its reply, lifted out so it isn't lost in the prose; you answer in the composer. */
function AskedQuestion({ text }: { text: string }) {
  return <p className="rounded-lg bg-warning/8 px-2.5 py-2 type-body text-pretty">{text}</p>;
}

const SHOWN_GAPS = 5;

/** Critical first (the verdict lists them so); past five, the rest wait behind Show more. */
function GapList({ thread, gaps, onJump }: { thread: Thread; gaps: Gap[]; onJump?: (quote: string) => void }) {
  const [isAll, setIsAll] = useState(false);
  const shown = isAll ? gaps : gaps.slice(0, SHOWN_GAPS);
  const hidden = gaps.length - shown.length;
  return (
    <div className="flex flex-col items-start gap-1">
      <ul aria-label="Gaps" className="flex w-full flex-col gap-0.5">
        {shown.map((g) => (
          <GapRow key={g.id} thread={thread} gap={g} onJump={onJump} />
        ))}
      </ul>
      {hidden > 0 && (
        <Button size="sm" variant="ghost" onClick={() => setIsAll(true)}>
          {`Show ${hidden} more`}
        </Button>
      )}
    </div>
  );
}

function GapRow({ thread, gap, onJump }: { thread: Thread; gap: Gap; onJump?: (quote: string) => void }) {
  const [isOutputOpen, setIsOutputOpen] = useState(false);
  const criterion = gap.criterionId ? thread.criteria?.find((c) => c.id === gap.criterionId) : undefined;
  const output = criterion?.check?.output;
  const tag = gap.isAccepted ? 'Accepted' : gap.severity === 'critical' ? 'Critical' : 'Unverified';
  return (
    <li className={cn('flex flex-col gap-2 rounded-lg px-2.5 py-2', gap.severity === 'critical' && !gap.isAccepted && 'bg-destructive/6', gap.isAccepted && 'opacity-60')}>
      <div className="flex items-start gap-2.5">
        <span className={cn('mt-px w-[4.75rem] shrink-0 rounded-sm px-1.5 text-center type-caption font-semibold', REF_CHIP_CLASS[gap.isAccepted ? 'muted' : gap.severity === 'critical' ? 'destructive' : 'warning'], 'pointer-events-none')}>{tag}</span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className={cn('text-pretty', gap.isAccepted && 'line-through')}>{gap.text}</span>
          <GapSource gap={gap} command={criterion?.command} onJump={onJump} />
        </span>
        {!!output && (
          <Button size="sm" variant="secondary" aria-expanded={isOutputOpen} onClick={() => setIsOutputOpen((open) => !open)}>
            {isOutputOpen ? 'Hide output' : 'Show output'}
          </Button>
        )}
        {gap.severity === 'unverified' && <AcceptGap thread={thread} gap={gap} />}
      </div>
      {isOutputOpen && <pre className="max-h-48 overflow-auto rounded-md bg-muted p-2 font-mono type-caption whitespace-pre-wrap text-muted-foreground">{output}</pre>}
    </li>
  );
}

function GapSource({ gap, command, onJump }: { gap: Gap; command?: string; onJump?: (quote: string) => void }) {
  if (command) return <span className="truncate font-mono type-caption text-muted-foreground">{command}</span>;
  if (!gap.quote) return null;
  return (
    <span className="type-caption text-pretty text-muted-foreground">
      {`Agent: “${gap.quote}”`}
      {!!onJump && (
        <>
          {' · '}
          <button type="button" className="cursor-pointer text-foreground underline-offset-2 hover:underline focus-visible:underline" onClick={() => onJump(gap.quote!)}>
            Jump to message
          </button>
        </>
      )}
    </span>
  );
}

function AcceptGap({ thread, gap }: { thread: Thread; gap: Gap }) {
  const { dispatch } = useHarness();
  const accepted = thread.idle?.accepted ?? [];
  const toggle = () => dispatch({ type: 'idle-update', threadId: thread.id, patch: { accepted: gap.isAccepted ? accepted.filter((id) => id !== gap.id) : [...accepted, gap.id] } });
  return (
    <Button size="sm" variant="secondary" onClick={toggle}>
      {gap.isAccepted ? 'Undo' : 'Accept gap'}
    </Button>
  );
}

/** Criteria live in the goal card; here they fold away under a count. */
function CriteriaDisclosure({ thread }: { thread: Thread }) {
  const criteria = thread.criteria ?? [];
  return (
    <Collapsible>
      <CollapsibleTrigger className="group/criteria flex items-center gap-1 type-caption text-muted-foreground hover:text-foreground">
        {`${criteria.filter(isMet).length} of ${criteria.length} criteria met`}
        <ChevronDown aria-hidden className="size-3 transition-transform group-data-[state=open]/criteria:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-2">
        <CriteriaList thread={thread} />
      </CollapsibleContent>
    </Collapsible>
  );
}

/** One primary per state: hand the gaps back, continue the plan, or the next step of a met goal. A question or a limit waits on you or the clock. */
function VerdictFooter({ thread, verdict, prStates }: { thread: Thread; verdict: Verdict; prStates: RefStatus[] }) {
  const { dispatch } = useHarness();
  const agent = authorName(thread.session?.provider ?? thread.providers[0]);
  const open = verdict.gaps.filter((g) => !g.isAccepted);
  const send = (text: string, reason: string) => dispatch({ type: 'send', threadId: thread.id, text, reason });
  const isBlocked = open.some((g) => g.severity === 'critical') && !!thread.repo && !prStates.some((s) => s === 'open' || s === 'draft' || s === 'merged');
  const openAnyway = () => {
    dispatch({ type: 'idle-update', threadId: thread.id, patch: { canOpenPr: true } });
    send('Open the pull request with open_pr. I chose Open anyway: the gaps go in its description.', 'Open anyway from the verdict');
  };
  if (verdict.kind === 'gaps')
    return (
      <CardFooter className="gap-2">
        {isBlocked && (
          <Button size="sm" variant="outline" onClick={openAnyway}>
            Open anyway
          </Button>
        )}
        <Button size="sm" className="ml-auto" onClick={() => send(closeGapsPrompt(open), 'Close gaps from the verdict')}>
          {`Ask ${agent} to close ${open.length} ${open.length === 1 ? 'gap' : 'gaps'}`}
        </Button>
      </CardFooter>
    );
  if (verdict.kind === 'stalled' && verdict.chip !== 'Limit')
    return (
      <CardFooter className="justify-end">
        <Button size="sm" onClick={() => send(verdict.chip === 'Stopped' ? 'Continue the plan from where you stopped.' : 'Continue where you left off.', 'Continue from the verdict')}>
          {verdict.chip === 'Stopped' ? 'Continue the plan' : `Continue with ${agent}`}
        </Button>
      </CardFooter>
    );
  if (verdict.kind !== 'done' || !thread.repo) return null;
  const next = nextStep(prStates);
  if (next === 'review') return null;
  return (
    <CardFooter className="justify-end">
      <NextStepButton thread={thread} step={next} />
    </CardFooter>
  );
}

function closeGapsPrompt(gaps: Gap[]) {
  return `Mochi found these gaps when you went idle. Close each one, or say why it can't be:\n${gaps.map((g) => `- ${g.severity === 'critical' ? 'Critical' : 'Unverified'}: ${g.text}${g.quote ? ` (you wrote: "${g.quote}")` : ''}`).join('\n')}`;
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

/** The one line in a report that asks for anything. */
export function ReportQuestion({ report }: { report: TurnReport }) {
  if (!report.question) return null;
  return (
    <p className="flex gap-2 type-body text-pretty">
      <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-warning" />
      <span>
        <span className="font-medium text-warning">Needs you: </span>
        {report.question}
      </span>
    </p>
  );
}

export function ReportList({ label, items }: { label: string; items: string[] }) {
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
