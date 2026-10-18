import type { ReactNode } from 'react';
import { ChevronRight, DiagramTree, CheckBadge } from '@/icons';
import { Shimmer } from '@/components/ai-elements/shimmer';
import { CardHeader, CardTitle } from '@/components/ui/card';
import { GitPullRequestIcon, REF_TONE_CLASS } from '@/icons/github';
import { cn } from '@/lib/utils';
import type { LineSlot, Thread } from '../../model';
import { ProjectIcon } from '../../ProjectIcon';
import { SubThreadGuide } from '../../goals/SubThreads';
import { NextMoveActions, NextMoveAsk, NextMoveCard, NextMoveContent, NextMoveSummary } from '../../goals/NextMove';
import { SummaryGoal, SummaryGoalText } from '../../goals/SummaryGoal';
import { StatusRing, VerdictIcon } from '../../goals/VerdictChip';
import type { Move } from '../../goals/moves';
import type { Verdict } from '../../goals/verdict';
import { CallList } from '../../WorkLog';
import { Block } from '../layout';

/** Threads an agent starts for a piece of its own goal, nested under it. Mock data; nothing is wired. */
export function SubThreadsBlock({ rl }: { rl: Thread }) {
  return (
    <>
      <Block
        title="Sub-threads · sidebar tree"
        use="A thread's agent hands one of its criteria to a sub-thread with its own agent, branch and PR. Sub-threads sit under their parent on an L-shaped guide, one line each, a second only when one asks for you; finished ones fold into one row. No time since activity on any row. A parent with three sub-threads (working, one gap, in review), a parent whose two finished, then a plain thread."
        wide
      >
        <ul className="flex w-[256px] flex-col gap-0.5 rounded-xl border bg-sidebar p-2">
          {FAMILIES.map((f) => (
            <GuideTree key={f.parent.title} family={f} rl={rl} />
          ))}
          <li>
            <ParentRow row={PLAIN} rl={rl} />
          </li>
        </ul>
      </Block>
      <Block
        title="Sub-threads · the parent's end-of-turn card"
        use="The parent's card lists its sub-threads with the criterion each one covers. A sub-thread that needs you asks here, so you watch one place. When all are done the move is to merge their PRs into the parent's branch. Each sub-thread's result lands in the parent's chat as one row."
        wide
      >
        <div className="flex flex-wrap items-start gap-6">
          <ParentFrame label="One sub-thread needs you">
            <ResultRow child={FAMILIES[0].children[2]} text="In review · PR #141 · verified “Every 429 carries RateLimit-* headers”" />
            <ParentCard state="needs-you" slot={rl.line} />
          </ParentFrame>
          <ParentFrame label="All sub-threads done">
            <ResultRow child={{ ...FAMILIES[0].children[0], ...DONE }} text="Done · PR #142 · verified “Holds 2k req/s with p99 under 50ms”" />
            <ParentCard state="done" slot={rl.line} />
          </ParentFrame>
        </div>
      </Block>
      <Block
        title="Sub-threads · verdicts"
        use="What changes in Mochi's verdicts. A parent whose own work stopped while its sub-threads run waits quietly: no question, no notification. A sub-thread's PR goes into the parent's branch, and its last move hands the result back instead of settling. In the summary, a criterion handed to a sub-thread shows that sub-thread's ring and opens it."
        wide
      >
        <div className="flex flex-wrap items-start gap-6">
          <ParentFrame label="Parent · waiting on its sub-threads">
            <ParentCard state="waiting" slot={rl.line} />
          </ParentFrame>
          <ParentFrame label="Sub-thread · done, no PR yet">
            <ChildCard hasPr={false} />
          </ParentFrame>
          <ParentFrame label="Sub-thread · PR into the parent's branch">
            <ChildCard hasPr />
          </ParentFrame>
          <figure className="flex w-[300px] flex-col gap-2">
            <figcaption className="type-caption text-muted-foreground">Summary · criteria handed to sub-threads</figcaption>
            <SummaryWithHandoffs slot={rl.line} />
          </figure>
        </div>
      </Block>
    </>
  );
}

export interface RowFixture {
  title: string;
  met: number;
  total: number;
  tone: Verdict['tone'] | null;
  isWorking?: boolean;
  /** The verdict's word, for the ring's label and the card's status column. */
  status: string;
  /** What it's doing while it works, else why it stopped. */
  reason: string;
  /** The parent's criterion this sub-thread covers. */
  covers?: string;
  pr?: { number: number; status: 'open' | 'merged' };
  isSettled?: boolean;
}

interface Family {
  parent: RowFixture;
  children: RowFixture[];
}

const DONE = { met: 2, total: 2, tone: 'success', isWorking: false, status: 'Done', reason: 'PR #142 in review', pr: { number: 142, status: 'open' } } satisfies Partial<RowFixture>;

const FAMILIES: Family[] = [
  {
    parent: { title: 'Public API rate limiting', met: 2, total: 5, tone: 'warning', status: 'Needs you', reason: 'Document 429 responses has 1 gap' },
    children: [
      { title: 'Load test at 2k req/s', met: 0, total: 2, tone: null, isWorking: true, status: 'Working', reason: 'Running k6 at 2k req/s', covers: 'Holds 2k req/s with p99 under 50ms' },
      { title: 'Document 429 responses', met: 1, total: 2, tone: 'warning', status: '1 gap', reason: 'Example not checked against the API', covers: 'Every 429 is documented with an example' },
      { title: 'Return RateLimit-* headers', met: 2, total: 2, tone: 'success', status: 'In review', reason: 'PR #141 in review', covers: 'Every 429 carries RateLimit-* headers', pr: { number: 141, status: 'open' } },
    ],
  },
  {
    parent: { title: 'Migrate auth to Better Auth', met: 3, total: 3, tone: 'success', status: 'Done', reason: 'Merge 2 sub-thread PRs', pr: { number: 487, status: 'open' } },
    children: [
      { title: 'Keep the session cookie name', met: 1, total: 1, tone: 'success', status: 'Merged', reason: 'Merged into the parent', pr: { number: 488, status: 'merged' }, isSettled: true },
      { title: 'Port the OAuth callbacks', met: 2, total: 2, tone: 'success', status: 'Merged', reason: 'Merged into the parent', pr: { number: 489, status: 'merged' }, isSettled: true },
    ],
  },
];

const PLAIN: RowFixture = { title: 'Fix flaky checkout e2e', met: 1, total: 2, tone: 'warning', status: 'Needs you', reason: 'Answer 2 questions' };

function GuideTree({ family, rl }: { family: Family; rl: Thread }) {
  const open = family.children.filter((c) => !c.isSettled);
  const settled = family.children.length - open.length;
  return (
    <li className="flex flex-col">
      <ParentRow row={family.parent} rl={rl} />
      <ul aria-label={`Sub-threads of ${family.parent.title}`} className="-mt-1 ml-[15px] flex flex-col gap-0.5">
        {open.map((c, i) => (
          <Branch key={c.title} isLast={i === open.length - 1 && settled === 0}>
            <ChildRow row={c} rl={rl} />
          </Branch>
        ))}
        {settled > 0 && (
          <Branch isLast>
            <RowShell className="flex-row items-center gap-2 px-1 py-1.5 text-subtle-foreground">
              <DiagramTree aria-hidden className="size-4 shrink-0" />
              <span className="type-caption">{`${settled} sub-threads done`}</span>
            </RowShell>
          </Branch>
        )}
      </ul>
    </li>
  );
}

/** One sub-thread on the parent's guide. */
export function Branch({ isLast, children }: { isLast: boolean; children: ReactNode }) {
  return (
    <li className="relative pl-3">
      <SubThreadGuide isLast={isLast} />
      {children}
    </li>
  );
}

function RowShell({ isActive, className, children }: { isActive?: boolean; className?: string; children: ReactNode }) {
  return <div className={cn('relative flex w-full min-w-0 flex-col gap-1 rounded-lg px-2 py-2 text-left text-sm hover:bg-sidebar-accent/60', isActive && 'bg-sidebar-accent', className)}>{children}</div>;
}

/** The sidebar's thread row as shipped: ring and title; project icon, reason, PR. */
export function ParentRow({ row, rl }: { row: RowFixture; rl: Thread }) {
  return (
    <RowShell>
      <TitleLine row={row} rl={rl} />
      <span className="flex min-w-0 items-center gap-1.5 pl-6 type-caption text-subtle-foreground">
        <span className="flex size-3.5 shrink-0 items-center justify-center [&>*]:scale-[0.875]">
          <ProjectIcon name="latitude" />
        </span>
        <Reason row={row} />
        {!!row.pr && <PrMark pr={row.pr} />}
      </span>
    </RowShell>
  );
}

/** One line under its parent; a second only when it asks for you. */
export function ChildRow({ row, rl }: { row: RowFixture; rl: Thread }) {
  const asks = row.tone === 'warning' || row.tone === 'destructive';
  return (
    <RowShell className="gap-0.5 px-1 py-1.5">
      <TitleLine row={row} rl={rl} extra={!!row.pr && <PrMark pr={row.pr} />} />
      {asks && <span className={cn('truncate pl-6 type-caption', TONE_TEXT[row.tone!])}>{row.reason}</span>}
    </RowShell>
  );
}

function TitleLine({ row, rl, extra }: { row: RowFixture; rl: Thread; extra?: ReactNode }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <StatusRing met={row.met} total={row.total} tone={row.tone} isWorking={!!row.isWorking} slot={rl.line} label={row.status} />
      <span className="min-w-0 flex-1 truncate text-foreground/75">{row.title}</span>
      {extra}
    </span>
  );
}

function Reason({ row }: { row: RowFixture }) {
  if (row.isWorking) return <Shimmer as="span" className="min-w-0 flex-1 truncate">{row.reason}</Shimmer>;
  return <span className="min-w-0 flex-1 truncate">{row.reason}</span>;
}

function PrMark({ pr }: { pr: NonNullable<RowFixture['pr']> }) {
  return <GitPullRequestIcon aria-label={`PR #${pr.number}, ${pr.status}`} className={cn('size-3 shrink-0', REF_TONE_CLASS[pr.status === 'merged' ? 'merged' : 'success'])} />;
}

function ParentFrame({ label, children }: { label: string; children: ReactNode }) {
  return (
    <figure className="flex w-[min(100%,560px)] flex-col gap-2">
      <figcaption className="type-caption text-muted-foreground">{label}</figcaption>
      <div className="flex flex-col gap-4 rounded-xl border bg-background p-4">{children}</div>
    </figure>
  );
}

/** A sub-thread's result in the parent's chat, like a message from another thread. */
function ResultRow({ child, text }: { child: RowFixture; text: string }) {
  return (
    <div className="-mx-2 flex h-7 w-fit max-w-full min-w-0 items-center gap-2 rounded-lg px-2 type-meta text-muted-foreground hover:bg-accent/60 hover:text-foreground">
      <DiagramTree aria-hidden className="size-4 shrink-0" />
      <span className="shrink-0 text-foreground">{child.title}</span>
      <span className="min-w-0 truncate">{text}</span>
      <ChevronRight aria-hidden className="size-3 shrink-0 text-subtle-foreground" />
    </div>
  );
}

function ParentCard({ state, slot }: { state: 'needs-you' | 'done' | 'waiting'; slot: LineSlot }) {
  const { title, summary, children, ask } = PARENT_STATES[state];
  return (
    <NextMoveCard>
      <CardHead tone={state === 'done' ? 'success' : state === 'needs-you' ? 'warning' : 'muted'} title={title} icon={state === 'waiting' ? <DiagramTree className="size-4" /> : <VerdictIcon kind={state} className="size-4" />} />
      <NextMoveContent>
        <NextMoveSummary>{summary}</NextMoveSummary>
        <CallList aria-label="Sub-threads">
          {children.map((c) => (
            <SubThreadRow key={c.title} row={c} slot={slot} />
          ))}
        </CallList>
        {ask ? (
          <NextMoveAsk question={ask.question}>
            <NextMoveActions move={ask.move} alternative={ask.alternative} onMove={() => undefined} onAlternative={() => undefined} />
          </NextMoveAsk>
        ) : (
          <p className="type-meta text-muted-foreground">Mochi asks when one finishes or needs you.</p>
        )}
      </NextMoveContent>
    </NextMoveCard>
  );
}

const [LOAD, DOCS, HEADERS] = FAMILIES[0].children;

const PARENT_STATES = {
  'needs-you': {
    title: 'A sub-thread needs you',
    summary: 'I split the rate limiting into three sub-threads. The headers are in review, the load test is running, and the docs need one thing from you.',
    children: FAMILIES[0].children,
    // The move acts on the sub-thread: Close 1 gap sends the gap to Document 429 responses' agent, not this one.
    ask: { question: 'Document 429 responses has 1 gap: hand it back to its agent?', move: { kind: 'close-gaps', label: 'Close 1 gap' }, alternative: 'Open thread' },
  },
  waiting: {
    title: 'Waiting on 2 sub-threads',
    summary: 'My part is done: the limiter and its config are in. The load test and the 429 docs are still running in their sub-threads.',
    children: [LOAD, { ...DOCS, tone: null, isWorking: true, status: 'Working', reason: 'Checking the example against the API' }, HEADERS],
    ask: null,
  },
  done: {
    title: 'Every sub-thread done',
    summary: 'All three sub-threads are verified and each has a PR into feat/api-rate-limits. Nothing is left on this branch.',
    children: FAMILIES[0].children.map((c, i) => ({ ...c, ...DONE, pr: c.pr ?? { number: 142 + i, status: 'open' as const } })),
    ask: { question: 'Merge the 3 sub-thread PRs into feat/api-rate-limits?', move: { kind: 'settle', label: 'Merge 3 PRs' }, alternative: 'Review first' },
  },
} satisfies Record<string, { title: string; summary: string; children: RowFixture[]; ask: { question: string; move: Move; alternative: string } | null }>;

/** A sub-thread's own end-of-turn card: what it's part of, then a PR into the parent's branch, then handing the result back. */
function ChildCard({ hasPr }: { hasPr: boolean }) {
  return (
    <NextMoveCard>
      <CardHead tone="success" title="Done" icon={<VerdictIcon kind="done" className="size-4" />} />
      <NextMoveContent>
        <p className="flex min-w-0 items-center gap-1.5 type-meta text-muted-foreground">
          <DiagramTree aria-hidden className="size-3.5 shrink-0" />
          <span className="min-w-0 truncate">
            Sub-thread of <span className="text-foreground">Public API rate limiting</span>, for “Every 429 carries RateLimit-* headers”
          </span>
        </p>
        <NextMoveSummary>Every 429 now carries RateLimit-Limit, -Remaining and -Reset, with a test per tier.</NextMoveSummary>
        {hasPr ? (
          <NextMoveAsk question="PR #141 is open into feat/api-rate-limits. Hand the result back to Public API rate limiting?">
            <NextMoveActions move={{ kind: 'settle', label: 'Hand back' }} alternative="Not yet" onMove={() => undefined} onAlternative={() => undefined} />
          </NextMoveAsk>
        ) : (
          <NextMoveAsk question="Open a pull request into feat/api-rate-limits?">
            <NextMoveActions move={{ kind: 'open-pr', label: 'Open pull request' }} alternative="Not yet" onMove={() => undefined} onAlternative={() => undefined} />
          </NextMoveAsk>
        )}
      </NextMoveContent>
    </NextMoveCard>
  );
}

/** The summary's goal block with two criteria the parent kept and three it handed off, each of those showing its sub-thread. */
function SummaryWithHandoffs({ slot }: { slot: LineSlot }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-xl border bg-card px-2 pt-2 pb-3">
      <SummaryGoal>
        <h2 className="type-title">Goal</h2>
        <SummaryGoalText>Every public API key is rate limited by plan tier, with per-key overrides and clear 429s.</SummaryGoalText>
        <ul aria-label="Done when" className="flex flex-col gap-1.5">
          <OwnCriterion text="Limits come from the plan tier" proof="Verified by Mochi in 38s" />
          <OwnCriterion text="Per-key overrides beat the tier" proof="Verified by Mochi in 41s" />
          {[LOAD, DOCS, HEADERS].map((c) => (
            <HandedCriterion key={c.title} row={c} slot={slot} />
          ))}
        </ul>
      </SummaryGoal>
    </div>
  );
}

function OwnCriterion({ text, proof }: { text: string; proof: string }) {
  return (
    <li className="flex gap-2 type-meta">
      <CheckBadge aria-label="Verified" className="mt-0.5 size-3.5 shrink-0 text-success" />
      <span className="flex min-w-0 flex-1 flex-col text-pretty">
        <span>{text}</span>
        <span className="type-caption text-subtle-foreground">{proof}</span>
      </span>
    </li>
  );
}

/** A criterion a sub-thread owns: its ring stands in for the tick, its proof line is the sub-thread's state, the row opens it. */
function HandedCriterion({ row, slot }: { row: RowFixture; slot: LineSlot }) {
  return (
    <li className="relative isolate -mx-1 flex gap-2 rounded-md px-1 type-meta hover:bg-accent/60">
      <button type="button" aria-label={`Open ${row.title}`} className="absolute inset-0 cursor-default rounded-[inherit] focus-visible:outline-2" />
      <span className="mt-px flex shrink-0 [&_svg]:size-3.5!">
        <StatusRing met={row.met} total={row.total} tone={row.tone} isWorking={!!row.isWorking} slot={slot} label={row.status} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col text-pretty">
        <span className={cn(row.tone === 'success' ? 'text-foreground' : 'text-foreground/75')}>{row.covers}</span>
        <span className="flex min-w-0 items-center gap-1 type-caption text-subtle-foreground">
          <DiagramTree aria-hidden className="size-3 shrink-0" />
          <span className="truncate">{row.title}</span>
          <span aria-hidden>·</span>
          {row.isWorking ? <Shimmer as="span" className="shrink-0">Working</Shimmer> : <span className={cn('shrink-0', TONE_TEXT[row.tone ?? 'muted'])}>{row.status}</span>}
        </span>
      </span>
      <ChevronRight aria-hidden className="mt-1 size-3 shrink-0 text-subtle-foreground" />
    </li>
  );
}

function CardHead({ icon, tone, title }: { icon: ReactNode; tone: Verdict['tone']; title: string }) {
  return (
    <CardHeader>
      <CardTitle className="flex items-center gap-2">
        <span aria-hidden className={cn('flex size-4 shrink-0 items-center justify-center', TONE_TEXT[tone])}>
          {icon}
        </span>
        <span className="min-w-0 truncate">{title}</span>
      </CardTitle>
    </CardHeader>
  );
}

/** One sub-thread: its ring, title and the criterion it covers, then its state in its tone. The row opens the thread. */
function SubThreadRow({ row, slot }: { row: RowFixture; slot: LineSlot }) {
  return (
    <li className="relative isolate flex h-11 min-w-0 items-center gap-2.5 px-3 type-meta hover:bg-accent/60">
      <button type="button" aria-label={`Open ${row.title}`} className="absolute inset-0 cursor-default focus-visible:outline-2 focus-visible:-outline-offset-2" />
      <StatusRing met={row.met} total={row.total} tone={row.tone} isWorking={!!row.isWorking} slot={slot} label={row.status} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-foreground">{row.title}</span>
        <span className="truncate type-caption text-subtle-foreground">{`For: ${row.covers}`}</span>
      </span>
      {row.isWorking ? <Shimmer as="span" className="shrink-0 type-caption">{row.reason}</Shimmer> : <span className={cn('shrink-0 type-caption font-medium', TONE_TEXT[row.tone ?? 'muted'])}>{row.status}</span>}
      {!!row.pr && <span className="flex shrink-0 items-center gap-1 tabular type-caption text-muted-foreground"><PrMark pr={row.pr} />{`#${row.pr.number}`}</span>}
      <ChevronRight aria-hidden className="size-3.5 shrink-0 text-subtle-foreground" />
    </li>
  );
}

const TONE_TEXT = { success: 'text-success', warning: 'text-warning', destructive: 'text-destructive', muted: 'text-muted-foreground' } satisfies Record<Verdict['tone'], string>;
