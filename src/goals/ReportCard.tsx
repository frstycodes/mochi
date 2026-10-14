import { useState } from 'react';
import { ChevronRight, CloseCircle, Hierarchy2, MessageText, TickCircle, Warning } from 'reicon-react';
import { Button } from '@/components/ui/button';
import { GitMergeIcon, GitPullRequestIcon, REF_CHIP_CLASS, REF_TONE_CLASS } from '@/icons/github';
import { TerminalIcon } from '@/icons/panes';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { authorName, isMet, type Thread, type TurnReport } from '../model';
import { ProgressRing } from '../ui';
import { RefChip } from '../chat/ChatLink';
import type { RefStatus, RefTone } from '../chat/refs';
import { openTurn } from '../chat/turnChanges';
import { TurnChangesCard } from '../chat/TurnChangesCard';
import { useThreadPrs, type ThreadPr } from '../git/useThreadPrs';
import { useHarness } from '../store';
import { CallList, Expand } from '../WorkLog';
import { nextStep, showsVerdictCard, type NextStep } from './report';
import { useIdleVerdict, VerdictIcon } from './VerdictChip';
import { turnReport, verdictHeading, verdictTiles, type Gap, type Tile, type TileTone, type Verdict } from './verdict';

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
  const report = turnReport(thread);
  const changes = openTurn(thread.activity);
  const hasNotes = !!report && report.decisions.length + report.left.length > 0;
  const isAsked = verdict.kind === 'needs-you';
  const hasBody = isAsked || verdict.gaps.length > 0 || !!changes || hasNotes;
  return (
    <Card size="sm" role="group" aria-label="Verdict">
      <CardHeader className="flex flex-col gap-1">
        <CardTitle className="flex items-center gap-2">
          <VerdictIcon kind={verdict.kind} className={cn('size-4 shrink-0', ICON_CLASS[verdict.tone])} />
          <span className="truncate">{heading.title}</span>
          {!!heading.detail && <span className="truncate type-meta font-normal text-muted-foreground">{heading.detail}</span>}
        </CardTitle>
        <Evidence thread={thread} tiles={verdictTiles(thread, states, verdict)} prs={prs} />
      </CardHeader>
      {hasBody && (
        <CardContent className="flex flex-col gap-3">
          {isAsked && <AskedQuestion text={verdict.reason} />}
          {verdict.gaps.length > 0 && <GapList thread={thread} gaps={verdict.gaps} onJump={onJump} />}
          {!!changes && <TurnChangesCard thread={thread} turn={changes} />}
          {hasNotes && <AgentNotes thread={thread} report={report} />}
        </CardContent>
      )}
      <VerdictFooter thread={thread} verdict={verdict} prStates={states.map((s) => s.status)} />
    </Card>
  );
}

const ICON_CLASS = { success: 'text-success', warning: 'text-warning', destructive: 'text-destructive', muted: 'text-muted-foreground' } satisfies Record<Verdict['tone'], string>;


/** What Mochi read, one fact each: an icon in its status colour and plain text; a fact asking for you becomes a toned badge, and a PR is its own chip. */
function Evidence({ thread, tiles, prs }: { thread: Thread; tiles: Tile[]; prs: ThreadPr[] }) {
  const chips = prs.filter((p) => !!p.githubRef);
  return (
    <ul aria-label="Evidence" className="flex flex-wrap items-center gap-x-3.5 gap-y-1 type-meta text-subtle-foreground">
      {tiles.map((t) =>
        t.id === 'pr' && chips.length > 0 ? (
          <li key={t.id} className="flex items-center gap-1.5">
            {chips.map((p) => (
              <RefChip key={p.pr.number} githubRef={p.githubRef!} />
            ))}
          </li>
        ) : (
        <li key={t.id} className={cn('flex h-5 items-center gap-1.5 whitespace-nowrap', !!t.tone && t.tone !== 'none' && cn('rounded-sm px-1.5', REF_CHIP_CLASS[t.tone]))}>
          <FactIcon thread={thread} tile={t} />
          <span className={cn(t.tone && t.tone !== 'none' && 'opacity-75')}>{t.name}</span>
          <span className={t.tone === 'none' ? 'text-muted-foreground' : t.tone ? 'font-medium' : 'text-foreground'}>{t.value}</span>
        </li>
        ),
      )}
    </ul>
  );
}

function FactIcon({ thread, tile }: { thread: Thread; tile: Tile }) {
  const criteria = thread.criteria ?? [];
  if (tile.id === 'criteria' && criteria.length > 0) return <ProgressRing met={criteria.filter(isMet).length} total={criteria.length} slot={thread.line} size={14} />;
  const className = cn('size-3.5 shrink-0', REF_TONE_CLASS[factTone(tile.bars)]);
  if (tile.id === 'pr') return tile.bars.includes('merged') ? <GitMergeIcon aria-hidden className={className} /> : <GitPullRequestIcon aria-hidden className={className} />;
  const Icon = FACT_ICONS[tile.id];
  return <Icon aria-hidden className={className} />;
}

const FACT_ICONS = { criteria: TickCircle, checks: TerminalIcon, git: Hierarchy2, agent: MessageText } satisfies Record<Exclude<Tile['id'], 'pr'>, unknown>;

function factTone(bars: TileTone[]): RefTone {
  if (bars.includes('destructive')) return 'destructive';
  if (bars.includes('warning')) return 'warning';
  if (bars.every((b) => b === 'none')) return 'muted';
  if (bars.includes('info')) return 'info';
  return bars.includes('merged') ? 'merged' : 'success';
}


/** A question the agent asked in its reply, lifted out so it isn't lost in the prose; you answer in the composer. */
function AskedQuestion({ text }: { text: string }) {
  return <p className="type-body text-pretty">{text}</p>;
}

const SHOWN_GAPS = 5;

/** Critical first (the verdict lists them so); past five, the rest wait behind Show more. Rows match the work log's call list. */
function GapList({ thread, gaps, onJump }: { thread: Thread; gaps: Gap[]; onJump?: (quote: string) => void }) {
  const [isAll, setIsAll] = useState(false);
  const shown = isAll ? gaps : gaps.slice(0, SHOWN_GAPS);
  const hidden = gaps.length - shown.length;
  return (
    <div className="flex flex-col items-start gap-1">
      <CallList aria-label="Gaps" className="w-full">
        {shown.map((g) => (
          <GapRow key={g.id} thread={thread} gap={g} onJump={onJump} />
        ))}
      </CallList>
      {hidden > 0 && (
        <Button size="sm" variant="ghost" onClick={() => setIsAll(true)}>
          {`Show ${hidden} more`}
        </Button>
      )}
    </div>
  );
}

/** One gap: its status icon says how bad, the row opens to the failing output or the agent's own words. */
function GapRow({ thread, gap, onJump }: { thread: Thread; gap: Gap; onJump?: (quote: string) => void }) {
  const [isOpen, setOpen] = useState(false);
  const criterion = gap.criterionId ? thread.criteria?.find((c) => c.id === gap.criterionId) : undefined;
  const output = criterion?.check?.output?.trim();
  const hasDetail = !!output || !!gap.quote;
  const severity = gap.isAccepted ? 'Accepted' : gap.severity === 'critical' ? 'Critical' : 'Unverified';
  return (
    <li className="flex flex-col">
      <div className={cn('relative isolate flex h-9 min-w-0 items-center gap-2.5 px-3 type-meta', hasDetail && 'hover:bg-accent/60', gap.isAccepted && 'text-muted-foreground')}>
        {hasDetail && <button type="button" aria-expanded={isOpen} aria-label={`${severity}: ${gap.text}`} onClick={() => setOpen((o) => !o)} className="absolute inset-0 cursor-default focus-visible:outline-2 focus-visible:-outline-offset-2" />}
        <GapIcon gap={gap} />
        <span className={cn('min-w-0 flex-1 truncate', !gap.isAccepted && 'text-foreground', gap.isAccepted && 'line-through')}>
          <span className="sr-only">{`${severity}: `}</span>
          {gap.text}
        </span>
        {!!criterion?.command && <code className="max-w-[40%] shrink-0 truncate font-mono type-caption text-muted-foreground">{criterion.command}</code>}
        {gap.severity === 'unverified' && <AcceptGap thread={thread} gap={gap} />}
        {hasDetail ? <ChevronRight aria-hidden className={cn('size-3.5 shrink-0 text-subtle-foreground transition-transform duration-150', isOpen && 'rotate-90')} /> : <span aria-hidden className="size-3.5 shrink-0" />}
      </div>
      {hasDetail && (
        <Expand isOpen={isOpen}>
          <div className="px-3 pb-3">{output ? <pre className="max-h-48 overflow-auto rounded-md bg-muted p-2 font-mono type-caption whitespace-pre-wrap text-muted-foreground">{output}</pre> : <GapQuote quote={gap.quote!} onJump={onJump} />}</div>
        </Expand>
      )}
    </li>
  );
}

function GapIcon({ gap }: { gap: Gap }) {
  if (gap.isAccepted) return <TickCircle aria-hidden className="size-3.5 shrink-0 text-subtle-foreground" />;
  if (gap.severity === 'critical') return <CloseCircle aria-hidden className="size-3.5 shrink-0 text-destructive" />;
  return <Warning aria-hidden className="size-3.5 shrink-0 text-warning" />;
}

function GapQuote({ quote, onJump }: { quote: string; onJump?: (quote: string) => void }) {
  return (
    <p className="type-meta text-pretty text-muted-foreground">
      {`“${quote}”`}
      {!!onJump && (
        <>
          {' '}
          <button type="button" className="cursor-pointer text-foreground underline-offset-2 hover:underline focus-visible:underline" onClick={() => onJump(quote)}>
            Jump to message
          </button>
        </>
      )}
    </p>
  );
}

function AcceptGap({ thread, gap }: { thread: Thread; gap: Gap }) {
  const { dispatch } = useHarness();
  const accepted = thread.idle?.accepted ?? [];
  const toggle = () => dispatch({ type: 'idle-update', threadId: thread.id, patch: { accepted: gap.isAccepted ? accepted.filter((id) => id !== gap.id) : [...accepted, gap.id] } });
  return (
    <Button size="xs" variant="ghost" className="relative z-10" onClick={toggle}>
      {gap.isAccepted ? 'Undo' : 'Accept'}
    </Button>
  );
}

/** The agent's own decisions and what it left, folded: the verdict above is Mochi's reading, this is the agent's word. */
function AgentNotes({ thread, report }: { thread: Thread; report: TurnReport }) {
  const agent = authorName(thread.session?.provider ?? thread.providers[0]);
  return (
    <Collapsible>
      <CollapsibleTrigger className="group/notes flex items-center gap-1 type-meta text-muted-foreground hover:text-foreground">
        {`${agent}'s notes`}
        <ChevronRight aria-hidden className="size-3 transition-transform group-data-[state=open]/notes:rotate-90" />
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-2 pt-2">
        <ReportList label="Decided" items={report.decisions} />
        <ReportList label="Left" items={report.left} />
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
