import { useState, type ReactNode } from 'react';
import { ArrowUp, ChevronRight } from '@/icons';
import { Message, MessageContent } from '@/components/ai-elements/message';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { authorName, type NextOption, type Thread } from '../../model';
import { ComposerCard } from '../../Composer';
import { Evidence, GapList } from '../../goals/ReportCard';
import { NextMoveActions, NextMoveAsk, NextMoveCard, NextMoveContent, NextMoveHeader, NextMoveRecord, NextMoveSummary, PlanList, useNextMove } from '../../goals/NextMove';
import { isPlanComplete, type PlanItem } from '../../goals/plan';
import { VizThreadProvider } from '../../viz/WidgetVisual';
import { Block } from '../layout';
import { verdictFixtures } from '../verdictFixtures';

/** The chat's last rows at the end of a turn, clickable: the agent's plan while it works, then one move once it stops. Mock data. */
export function NextMoveBlock({ rl }: { rl: Thread }) {
  return (
    <Block
      title="Next move"
      use="In the chat, never the composer. While the agent works, its own to-do list is the last thing in the chat until every item is done: no header, no dividers, each step with how long it took on Mochi's clock. When it stops: Mochi's verdict, the agent's summary, Mochi's evidence, then the agent's question with its own answers as buttons; each sends the agent's written reply, or fills the message box. Mochi picks a move only when the agent wrote none. Answer it and the card stays as a record of what you chose."
      wide
    >
      <VizThreadProvider value={rl.id}>
        <div className="flex flex-col gap-12">
          <PlanMock rl={rl} />
          {nextMoveFixtures(rl).map((f) => (
            <TurnEndMock key={f.label} fixture={f} />
          ))}
        </div>
      </VizThreadProvider>
    </Block>
  );
}

function PlanMock({ rl }: { rl: Thread }) {
  const [items, setItems] = useState(PLAN);
  const isDone = isPlanComplete(items);
  return (
    <MockFrame label="Working · the plan stays last until it's done, then hides" control={isDone ? <Button size="xs" variant="outline" onClick={() => setItems(PLAN)}>Reset</Button> : <Button size="xs" variant="outline" onClick={() => setItems(advance)}>Finish a step</Button>}>
      <p className="type-prose">Adding Retry-After to the 429 path first, then the burst test.</p>
      <WorkLine>Edited rate-limit.ts</WorkLine>
      <PlanList items={items} slot={rl.line} isWorking={!isDone} />
      <ComposerStub placeholder={isDone ? `Message ${authorName(rl.providers[0])}` : `Steer ${authorName(rl.providers[0])} while it works`} />
    </MockFrame>
  );
}

function advance(items: PlanItem[]): PlanItem[] {
  const i = items.findIndex((x) => x.status === 'running');
  return items.map((x, j) => (j === i ? { ...x, status: 'done' } : j === i + 1 ? { ...x, status: 'running', ms: 0 } : x));
}

type Answer = { label: string; draft?: string; isMove?: boolean; reply?: string };

function TurnEndMock({ fixture }: { fixture: NextMoveFixture }) {
  const [answer, setAnswer] = useState<Answer | null>(null);
  const control = answer ? <Button size="xs" variant="outline" onClick={() => setAnswer(null)}>Reset</Button> : !!fixture.reply && <Button size="xs" variant="outline" onClick={() => setAnswer({ label: '', reply: fixture.reply })}>Reply in the message box</Button>;
  return (
    <MockFrame label={fixture.label} control={control}>
      <WorkLine>{fixture.before}</WorkLine>
      {answer ? <TurnEndRecord fixture={fixture} answer={answer} /> : <TurnEndCard fixture={fixture} onAnswer={setAnswer} />}
      {answer?.isMove && <WorkLine>{fixture.after}</WorkLine>}
      {!!answer?.reply && <YourMessage>{answer.reply}</YourMessage>}
      <ComposerStub placeholder={`Message ${authorName(fixture.thread.providers[0])}`} draft={answer?.draft} />
    </MockFrame>
  );
}

function TurnEndCard({ fixture, onAnswer }: { fixture: NextMoveFixture; onAnswer: (a: Answer) => void }) {
  const next = useNextMove(fixture.thread);
  if (!next) return null;
  const { verdict, prs, tiles } = next;
  const pick = (o: NextOption) => onAnswer(o.isDraft ? { label: o.label, draft: o.reply } : { label: o.label, reply: o.reply, isMove: true });
  return (
    <NextMoveCard>
      <NextMoveHeader thread={fixture.thread} verdict={verdict} />
      <NextMoveContent>
        <NextMoveSummary>{fixture.summary}</NextMoveSummary>
        <Evidence thread={fixture.thread} tiles={tiles} prs={prs} />
        {verdict.gaps.length > 0 && <GapList thread={fixture.thread} gaps={verdict.gaps} />}
        <NextMoveAsk question={fixture.question}>
          <NextMoveActions labels={fixture.options.map((o) => o.label)} onPick={(i) => pick(fixture.options[i])} />
        </NextMoveAsk>
      </NextMoveContent>
    </NextMoveCard>
  );
}

function TurnEndRecord({ fixture, answer }: { fixture: NextMoveFixture; answer: Answer }) {
  return <NextMoveRecord record={{ summary: fixture.summary, question: fixture.question, ...(answer.label && { answer: answer.label }) }} />;
}

function MockFrame({ label, control, children }: { label: string; control?: ReactNode; children: ReactNode }) {
  return (
    <figure className="flex max-w-[720px] flex-col gap-5">
      <figcaption className="flex h-6 items-center gap-2 type-caption text-muted-foreground">
        {label}
        <span className="ml-auto">{control}</span>
      </figcaption>
      {children}
    </figure>
  );
}

/** Stands in for a finished work-log group. */
function WorkLine({ children }: { children: ReactNode }) {
  return (
    <p className="type-prose text-muted-foreground">
      {children} <ChevronRight aria-hidden className="inline size-3 align-middle" />
    </p>
  );
}

function YourMessage({ children }: { children: ReactNode }) {
  return (
    <Message from="user">
      <MessageContent className="type-prose">{children}</MessageContent>
    </Message>
  );
}

/** Stands in for the editor: the placeholder, or what an answer put there for you to finish. */
function ComposerStub({ placeholder, draft }: { placeholder: string; draft?: string }) {
  return (
    <ComposerCard>
      <div className="flex items-center gap-2 py-2 pr-2 pl-4">
        <span className={cn('min-w-0 flex-1 truncate type-prose', !draft && 'text-muted-foreground')}>{draft ?? placeholder}</span>
        <Button size="icon" className="rounded-full" aria-label="Send" disabled>
          <ArrowUp />
        </Button>
      </div>
    </ComposerCard>
  );
}

const PLAN: PlanItem[] = [
  { title: 'Read the rate limiter and its tests', status: 'done', ms: 4 * 60_000 },
  { title: 'Add Retry-After to every 429', status: 'running', ms: 12 * 60_000 + 7_000 },
  { title: 'Cover the burst case in rate-limit.test.ts', status: 'pending' },
  { title: 'Typecheck, test, then check the headers with curl', status: 'pending' },
];

interface NextMoveFixture {
  label: string;
  thread: Thread;
  /** What the agent would write in report_turn. */
  summary: string;
  question: string;
  options: NextOption[];
  /** The chat's row before the card, and after it when you take the move. */
  before: string;
  after: string;
  /** Needs you: what you'd type instead. */
  reply?: string;
}

/** One per move, on the verdict fixtures' threads. */
function nextMoveFixtures(rl: Thread): NextMoveFixture[] {
  const byLabel = new Map(verdictFixtures(rl).map((f) => [f.label, f.thread]));
  const thread = (label: string) => byLabel.get(label)!;
  const done = thread('Done · no PR yet');
  return [
    {
      label: 'Done · uncommitted · Commit',
      thread: { ...done, idle: { ...done.idle!, uncommitted: 2 } },
      summary: 'The session cookie keeps its name through the Better Auth migration, so signed-in people stay signed in. The old cookie is read once and rewritten on the next response.',
      question: 'Commit the cookie fix and its test?',
      options: [
        { label: 'Commit', reply: 'Commit the cookie fix and its test.' },
        { label: 'Show the diff first', reply: 'Show me the diff before you commit.' },
      ],
      before: 'Edited 2 files, ran pnpm test',
      after: 'Committed 2 files as fix(auth): keep the session cookie name',
    },
    {
      label: 'Done · committed · Open pull request',
      thread: done,
      summary: 'Committed as fix(auth): keep the session cookie name. Every criterion passes on the branch.',
      question: 'Open a pull request for the cookie fix?',
      options: [
        { label: 'Open pull request', reply: 'Open the pull request for the cookie fix.' },
        { label: 'Not yet', reply: "Hold the pull request, I'll review the branch first." },
      ],
      before: 'Committed 2 files',
      after: 'Opened #136 fix(auth): keep the session cookie name',
    },
    {
      label: "Gaps · Close gaps, or the agent's other answer",
      thread: thread('Gaps · 1 critical, 2 unverified'),
      summary: "PR chips now fall back to your home folder when the thread's worktree is gone, and #135 is open with the fix.",
      question: 'Fix the 5 failing git tests, then check the #133 chip in the app?',
      options: [
        { label: 'Fix both', reply: 'Fix the 5 failing git tests, then check the #133 chip in the app.' },
        { label: 'Only the tests', reply: "Fix the failing git tests only, I'll check the chip myself.", isDraft: true },
      ],
      before: 'Edited 3 files, ran 2 commands',
      after: 'Working on the 3 gaps',
    },
    {
      label: 'Needs you · answered in the message box',
      thread: thread('Needs you · asked in prose'),
      summary: 'The checkout test fails about 1 in 20 runs, only on CI. It times out waiting for the payment iframe, which loads slower on the CI runners.',
      question: 'Retry it, or quarantine it and open an issue?',
      options: [
        { label: 'Quarantine it', reply: 'Quarantine it and open an issue.' },
        { label: 'Retry it', reply: 'Wait longer for the payment iframe and retry it.' },
      ],
      before: 'Ran the e2e suite 20 times',
      after: '',
      reply: 'Quarantine it and open an issue.',
    },
    {
      label: 'Stopped mid-plan · Continue',
      thread: thread('Stalled · stopped mid-plan'),
      summary: "The Devices list reads the registry and shows each computer's icon. Offline ages and the theme check aren't done yet.",
      question: 'Pick up where it stopped: offline ages, then both themes?',
      options: [
        { label: 'Continue', reply: 'Continue: offline ages, then check both themes.' },
        { label: 'Change the plan', reply: 'Before you continue, I want to change the plan:', isDraft: true },
      ],
      before: 'Edited 4 files',
      after: 'Continuing with offline ages',
    },
    {
      label: 'Merged · Settle thread',
      thread: thread('Done · merged'),
      summary: '#133 merged into main. Nothing is left open on this goal.',
      question: 'Settle this thread?',
      options: [
        { label: 'Settle', reply: 'Settle this thread.' },
        { label: 'Keep it open', reply: 'Keep this thread open for now.' },
      ],
      before: 'Merged #133',
      after: 'Settled',
    },
    {
      label: 'Worst case · long everything',
      thread: thread('Worst case · 12 gaps, long everything'),
      summary:
        'I rewrote the checkout flow so the payment step no longer blocks on the address lookup, moved the retry logic into one helper used by every provider, and split the 1,400 line CheckoutPage into five components with their own tests. Two of the provider sandboxes were down, so their paths are only covered by mocks.',
      question: 'Fix the 5 failing checks, then run the two provider sandboxes again once they are back up before opening the pull request?',
      options: [
        { label: 'Fix checks, rerun sandboxes', reply: 'Fix the 5 failing checks, then rerun both provider sandboxes once they are back up, then open the pull request.' },
        { label: 'Open it with gaps', reply: 'Open the pull request now and list the gaps in its description.' },
        { label: 'Only the checks', reply: 'Fix the 5 failing checks only.' },
      ],
      before: 'Edited 23 files, ran 14 commands',
      after: 'Working on the 12 gaps',
    },
  ];
}
