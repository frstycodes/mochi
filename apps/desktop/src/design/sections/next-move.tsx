import { useState, type ReactNode } from 'react';
import { ArrowUp, ChevronRight } from '@/icons';
import { Message, MessageContent } from '@/components/ai-elements/message';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  authorName,
  type NextAction,
  type Step,
  type Thread,
  type TurnReport,
} from '../../model';
import { ComposerCard } from '../../Composer';
import { NextMoveRecord, PlanList, nextMoveOf } from '../../goals/NextMove';
import { WrapUpBox } from '../../goals/ReportCard';
import { PlanRecordRow } from '../../goals/PlanRecordRow';
import { moveRecord } from '../../goals/report';
import { useDispatch, useHarnessSelector } from '../../store';
import { yourText } from '../../store/threads';
import { isPlanComplete, type PlanItem } from '../../goals/plan';
import { VizThreadProvider } from '../../viz/WidgetVisual';
import { Block } from '../layout';
import { verdictFixtures } from '../verdictFixtures';

/** The chat's last rows at the end of a turn, clickable: the agent's plan while it works, then one move once it stops. Mock data. */
export function NextMoveBlock({ rl }: { rl: Thread }) {
  return (
    <Block
      title="Next move"
      use="In the chat, never the composer. While the agent works, its own to-do list is the last thing in the chat: no header, no dividers, each step with how long it took. When the turn ends it folds into one plan record row, and the wrap-up box follows: Mochi's verdict when the agent is blocked, the recap, this turn's assumptions, then the agent's question with its answers as buttons; each sends its label, or fills the message box. Answer it and the box stays as a muted record."
      wide
    >
      <VizThreadProvider value={rl.id}>
        <div className="flex flex-col gap-12">
          <PlanMock rl={rl} />
          <PlanStatesMock rl={rl} />
          <AssumedMock rl={rl} />
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
    <MockFrame
      label="Working · the plan stays last while the agent works; at the turn's end it folds into a record row"
      control={
        isDone ? (
          <Button size="xs" variant="outline" onClick={() => setItems(PLAN)}>
            Reset
          </Button>
        ) : (
          <Button size="xs" variant="outline" onClick={() => setItems(advance)}>
            Finish a step
          </Button>
        )
      }
    >
      <p className="type-prose">
        Adding Retry-After to the 429 path first, then the burst test.
      </p>
      <WorkLine>Edited rate-limit.ts</WorkLine>
      <PlanList items={items} slot={rl.line} />
      <ComposerStub
        placeholder={
          isDone
            ? `Message ${authorName(rl.providers[0])}`
            : `Steer ${authorName(rl.providers[0])} while it works`
        }
      />
    </MockFrame>
  );
}

function PlanStatesMock({ rl }: { rl: Thread }) {
  return (
    <MockFrame label="Every status · only the running step moves; paused stops its clock, blocked waits on you">
      <PlanList items={PLAN_STATES} slot={rl.line} />
    </MockFrame>
  );
}

function advance(items: PlanItem[]): PlanItem[] {
  const i = items.findIndex((x) => x.status === 'running');
  return items.map((x, j) =>
    j === i
      ? { ...x, status: 'done' }
      : j === i + 1
        ? { ...x, status: 'running', ms: 0 }
        : x,
  );
}

type Answer = {
  label: string;
  draft?: string;
  isMove?: boolean;
  reply?: string;
};

function TurnEndMock({ fixture }: { fixture: NextMoveFixture }) {
  const [answer, setAnswer] = useState<Answer | null>(null);
  const control = answer ? (
    <Button size="xs" variant="outline" onClick={() => setAnswer(null)}>
      Reset
    </Button>
  ) : (
    !!fixture.reply && (
      <Button
        size="xs"
        variant="outline"
        onClick={() => setAnswer({ label: '', reply: fixture.reply })}
      >
        Reply in the message box
      </Button>
    )
  );
  return (
    <MockFrame label={fixture.label} control={control}>
      <WorkLine>{fixture.before}</WorkLine>
      {answer ? (
        <TurnEndRecord fixture={fixture} answer={answer} />
      ) : (
        <TurnEndCard fixture={fixture} onAnswer={setAnswer} />
      )}
      {answer?.isMove && <WorkLine>{fixture.after}</WorkLine>}
      {!!answer?.reply && <YourMessage>{answer.reply}</YourMessage>}
      <ComposerStub
        placeholder={`Message ${authorName(fixture.thread.providers[0])}`}
        draft={answer?.draft}
      />
    </MockFrame>
  );
}

function TurnEndCard({
  fixture,
  onAnswer,
}: {
  fixture: NextMoveFixture;
  onAnswer: (a: Answer) => void;
}) {
  const next = nextMoveOf(fixture.thread);
  if (!next) return null;
  // A turn no assumption is from: these boxes show none.
  const report: TurnReport = {
    at: 0,
    turn: -1,
    by: fixture.thread.providers[0],
    recap: fixture.summary,
    decisions: [],
    ask: fixture.question,
    actions: fixture.actions,
  };
  return (
    <WrapUpBox
      thread={fixture.thread}
      verdict={next.verdict}
      report={report}
      question={fixture.question}
      actions={fixture.actions}
      onPick={(a) =>
        onAnswer(
          a.isDraft
            ? { label: a.label, draft: a.label }
            : { label: a.label, reply: a.label, isMove: true },
        )
      }
      onDismiss={() => onAnswer({ label: '' })}
    />
  );
}

function TurnEndRecord({
  fixture,
  answer,
}: {
  fixture: NextMoveFixture;
  answer: Answer;
}) {
  return (
    <NextMoveRecord
      record={{
        summary: fixture.summary,
        question: fixture.question,
        ...(answer.label && { answer: answer.label }),
      }}
    />
  );
}

/**
 * The box on the demo thread itself, so its assumptions are the store's: Change edits in place, and picking an answer or sending
 * a message sends it with the corrections on top, accepting the rest. Then the turn's plan record, its answers folded in.
 */
function AssumedMock({ rl }: { rl: Thread }) {
  const dispatch = useDispatch();
  const thread = useHarnessSelector((s) =>
    s.threads.find((t) => t.id === rl.id),
  );
  const [record, setRecord] = useState<ReturnType<typeof moveRecord>>();
  const [sent, setSent] = useState<string>();
  const [typed, setTyped] = useState('');
  const load = () => {
    setRecord(undefined);
    setSent(undefined);
    dispatch({
      type: 'agent',
      event: {
        threadId: rl.id,
        type: 'plan',
        items: RECORD_STEPS.map((s) => ({ title: s.title, status: 'done' })),
        isFresh: true,
      },
      ms: Date.now(),
    });
    dispatch({ type: 'report', threadId: rl.id, report: ASSUMED_REPORT });
  };
  const isLoaded = thread?.report?.ask === ASSUMED_REPORT.ask;
  if (!thread?.report || !isLoaded)
    return (
      <MockFrame label="Assumed · the box on the demo thread, with its plan record">
        <Button size="sm" variant="secondary" className="w-fit" onClick={load}>
          Load the demo turn
        </Button>
      </MockFrame>
    );
  const { report } = thread;
  const send = (text: string, label?: string) => {
    setRecord(moveRecord(thread, report.ask!, label));
    setSent(yourText(thread, { type: 'send', threadId: rl.id, text }));
    dispatch({ type: 'send', threadId: rl.id, text });
  };
  const turnIds = (thread.assumptions ?? [])
    .filter((a) => a.turn === report.turn)
    .map((a) => a.id);
  return (
    <MockFrame
      label="Assumed · Change or click a sentence to edit it in place; your next message carries the corrections"
      control={
        <Button size="xs" variant="outline" onClick={load}>
          Reset
        </Button>
      }
    >
      <WorkLine>Edited rate-limit.ts and rate-limit.test.ts</WorkLine>
      <PlanRecordRow
        thread={thread}
        record={{
          steps: RECORD_STEPS,
          decisions: report.decisions.flatMap((d) =>
            typeof d === 'string' ? [] : [d],
          ),
          assumptionIds: turnIds,
        }}
      />
      {record ? (
        <NextMoveRecord record={record} />
      ) : (
        <WrapUpBox
          thread={thread}
          verdict={{ kind: 'idle', chip: 'Idle', tone: 'muted', reason: '' }}
          report={report}
          question={report.ask ?? null}
          actions={report.actions ?? []}
          onPick={(a) => send(a.label, a.label)}
          onDismiss={() => setRecord(moveRecord(thread, report.ask!))}
        />
      )}
      {!!sent && <YourMessage>{sent}</YourMessage>}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!typed.trim() || record) return;
          send(typed.trim());
          setTyped('');
        }}
      >
        <input
          aria-label="Message"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder="Or write a message instead"
          className="min-w-0 flex-1 rounded-md border bg-transparent px-3 py-1.5 type-body outline-none focus-visible:border-ring"
        />
        <Button size="sm" variant="secondary" type="submit">
          Send
        </Button>
      </form>
    </MockFrame>
  );
}

const RECORD_STEPS: Step[] = [
  'Read the rate limiter and its tests',
  'Find every route that returns 429',
  'Add a shared retryAfter helper',
  'Add Retry-After to every 429',
  'Cover the burst case in rate-limit.test.ts',
  'Typecheck and run the tests',
].map((title, k) => ({
  id: `record-${k}`,
  title,
  status: k < 5 ? 'done' : 'ready',
  addedAt: 0,
  addedBy: 'claude',
  ...(k < 5 && {
    startedAt: 0,
    startedMs: 0,
    doneAt: 0,
    doneMs: (k + 2) * 47_000,
  }),
}));

const ASSUMED_REPORT = {
  by: 'claude',
  recap:
    'Every 429 now carries Retry-After, and the burst case has its own test. The full test run is not done yet.',
  ask: 'Commit the Retry-After change and its test?',
  actions: [{ label: 'Commit' }, { label: 'Show the diff first' }],
  decisions: [
    {
      text: 'Retry-After in seconds, not an HTTP date: every client we ship parses seconds',
      step: 4,
    },
    { text: 'Kept the limiter in memory instead of moving it to Redis' },
  ],
  assumptions: [
    { text: 'The window resets on the minute, not rolling', step: 4 },
    { text: 'Bursts above 20 a second count as abuse', step: 5 },
  ],
} satisfies Omit<TurnReport, 'at'>;

export function MockFrame({
  label,
  control,
  children,
}: {
  label: string;
  control?: ReactNode;
  children: ReactNode;
}) {
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
export function WorkLine({ children }: { children: ReactNode }) {
  return (
    <p className="type-prose text-muted-foreground">
      {children}{' '}
      <ChevronRight aria-hidden className="inline size-3 align-middle" />
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
export function ComposerStub({
  placeholder,
  draft,
}: {
  placeholder: string;
  draft?: string;
}) {
  return (
    <ComposerCard>
      <div className="flex items-center gap-2 py-2 pr-2 pl-4">
        <span
          className={cn(
            'min-w-0 flex-1 truncate type-prose',
            !draft && 'text-muted-foreground',
          )}
        >
          {draft ?? placeholder}
        </span>
        <Button size="icon" className="rounded-full" aria-label="Send" disabled>
          <ArrowUp />
        </Button>
      </div>
    </ComposerCard>
  );
}

const PLAN: PlanItem[] = [
  {
    title: 'Read the rate limiter and its tests',
    status: 'done',
    ms: 4 * 60_000,
  },
  {
    title: 'Add Retry-After to every 429',
    status: 'running',
    ms: 12 * 60_000 + 7_000,
  },
  { title: 'Cover the burst case in rate-limit.test.ts', status: 'pending' },
  {
    title: 'Typecheck, test, then check the headers with curl',
    status: 'pending',
  },
];

const PLAN_STATES: PlanItem[] = [
  {
    title: 'Read the rate limiter and its tests',
    status: 'done',
    ms: 4 * 60_000,
  },
  {
    title: 'Add Retry-After to every 429',
    status: 'running',
    ms: 2 * 60_000 + 7_000,
  },
  { title: 'Migrate the limiter config', status: 'paused', ms: 6 * 60_000 },
  {
    title: 'Rotate the staging API key',
    status: 'blocked',
    note: 'Needs the new key from you',
  },
  { title: 'Cover the burst case in rate-limit.test.ts', status: 'pending' },
];

interface NextMoveFixture {
  label: string;
  thread: Thread;
  /** What the agent would write in wrap_up. */
  summary: string;
  question: string;
  actions: NextAction[];
  /** The chat's row before the card, and after it when you take the move. */
  before: string;
  after: string;
  /** Needs you: what you'd type instead. */
  reply?: string;
}

/** One per kind of answer, on the verdict fixtures' threads. */
function nextMoveFixtures(rl: Thread): NextMoveFixture[] {
  const byLabel = new Map(verdictFixtures(rl).map((f) => [f.label, f.thread]));
  const thread = (label: string) => byLabel.get(label)!;
  const done = thread('Idle · no PR yet');
  return [
    {
      label: 'Commit',
      thread: done,
      summary:
        'The session cookie keeps its name through the Better Auth migration, so signed-in people stay signed in. The old cookie is read once and rewritten on the next response.',
      question: 'Commit the cookie fix and its test?',
      actions: [{ label: 'Commit' }, { label: 'Show the diff first' }],
      before: 'Edited 2 files, ran pnpm test',
      after: 'Committed 2 files as fix(auth): keep the session cookie name',
    },
    {
      label: 'Open pull request',
      thread: done,
      summary:
        'Committed as fix(auth): keep the session cookie name. Every criterion passes on the branch.',
      question: 'Open a pull request for the cookie fix?',
      actions: [{ label: 'Open pull request' }, { label: 'Not yet' }],
      before: 'Committed 2 files',
      after: 'Opened #136 fix(auth): keep the session cookie name',
    },
    {
      label: 'Needs you · answered in the message box',
      thread: thread('Needs you · asked in its report'),
      summary:
        'The checkout test fails about 1 in 20 runs, only on CI. It times out waiting for the payment iframe, which loads slower on the CI runners.',
      question: 'Retry it, or quarantine it and open an issue?',
      actions: [{ label: 'Quarantine it' }, { label: 'Retry it' }],
      before: 'Ran the e2e suite 20 times',
      after: '',
      reply: 'Quarantine it and open an issue.',
    },
    {
      label: 'Continue',
      thread: done,
      summary:
        "The Devices list reads the registry and shows each computer's icon. Offline ages and the theme check aren't done yet.",
      question: 'Pick up where it stopped: offline ages, then both themes?',
      actions: [
        { label: 'Continue' },
        { label: 'Change the plan', isDraft: true },
      ],
      before: 'Edited 4 files',
      after: 'Continuing with offline ages',
    },
    {
      label: 'Settle thread',
      thread: thread('Idle · merged'),
      summary: '#133 merged into main. Nothing is left open.',
      question: 'Settle this thread?',
      actions: [{ label: 'Settle' }, { label: 'Keep it open' }],
      before: 'Merged #133',
      after: 'Settled',
    },
    {
      label: 'Worst case · long everything',
      thread: thread('Worst case · long everything'),
      summary:
        'I rewrote the checkout flow so the payment step no longer blocks on the address lookup, moved the retry logic into one helper used by every provider, and split the 1,400 line CheckoutPage into five components with their own tests. Two of the provider sandboxes were down, so their paths are only covered by mocks.',
      question:
        'Fix the 5 failing checks, then run the two provider sandboxes again once they are back up before opening the pull request?',
      actions: [
        { label: 'Fix checks, rerun sandboxes' },
        { label: 'Open it with gaps' },
        { label: 'Only the checks' },
      ],
      before: 'Edited 23 files, ran 14 commands',
      after: 'Working on the 12 gaps',
    },
  ];
}
