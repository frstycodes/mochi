import type { ReactNode } from 'react';
import { Separator } from '@/components/ui/separator';
import { toast } from '@/toast/store';
import type { Criterion, Thread } from '../../model';
import { SummaryPanel } from '../../SummaryPanel';
import { useIdleVerdict } from '../../goals/VerdictChip';
import {
  SummaryCriteria,
  SummaryGoal,
  SummaryGoalHeader,
  SummaryGoalOutcome,
  SummaryGoalStatus,
  SummaryGoalText,
  SummaryNextMove,
} from '../../goals/SummaryGoal';
import { Block } from '../layout';
import { verdictFixtures } from '../verdictFixtures';

/** The summary's goal block as proposed, beside today's for the same thread. Mock data; nothing is wired. */
export function SummaryGoalBlock({ rl }: { rl: Thread }) {
  const columns = summaryGoalFixtures(rl);
  return (
    <Block
      title="Summary goal block"
      use="Top of the summary column. Mochi's verdict in the sidebar chip's words, the outcome as the headline, then each criterion with its proof: verified by Mochi, only claimed by the agent, failed, or open. A waiting end-of-turn question shows as one row that opens the card in the chat. No steps: the plan lives at the bottom of the chat."
      wide
    >
      <div className="flex flex-wrap items-start gap-6">
        <Column label="Today · same thread as Gaps">
          <SummaryPanel
            thread={columns[2].thread}
            className="max-h-[440px] w-[300px] overflow-hidden rounded-xl border bg-card"
          />
        </Column>
        {columns.map((c) => (
          <Column key={c.label} label={c.label}>
            <SummaryColumn fixture={c} />
          </Column>
        ))}
      </div>
    </Block>
  );
}

function SummaryColumn({ fixture }: { fixture: SummaryGoalFixture }) {
  const { thread, question, step, outcome } = fixture;
  const verdict = useIdleVerdict(thread);
  const isWaiting = !!verdict && !!question;
  return (
    <div className="flex w-[300px] flex-col gap-0.5 rounded-xl border bg-card px-2 pt-2 pb-3">
      <p className="truncate px-2 pb-1 type-caption text-subtle-foreground">{`${thread.repo?.project ?? 'No project'} · ${thread.repo?.branch ?? ''}`}</p>
      <SummaryGoal>
        <SummaryGoalHeader
          thread={thread}
          onEdit={() => toast('Opens the goal editor')}
          onOpen={() => toast('Opens the goal with its history')}
        />
        <SummaryGoalStatus thread={thread} verdict={verdict} step={step} />
        <SummaryGoalText>{thread.goal}</SummaryGoalText>
        <SummaryCriteria thread={thread} />
      </SummaryGoal>
      <Separator className="mx-2 my-2 w-auto!" />
      {isWaiting && (
        <SummaryNextMove
          question={question}
          onShow={() => toast('Scrolls to the card in the chat')}
        />
      )}
      {!!outcome && <SummaryGoalOutcome rows={outcome} />}
      <p className="px-2 py-1 type-caption text-subtle-foreground">
        Changes, pull requests and the rest of the summary
      </p>
    </div>
  );
}

function Column({ label, children }: { label: string; children: ReactNode }) {
  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="type-caption text-muted-foreground">
        {label}
      </figcaption>
      {children}
    </figure>
  );
}

interface SummaryGoalFixture {
  label: string;
  thread: Thread;
  /** The end-of-turn question still waiting in the chat. */
  question?: string;
  /** The agent's plan step in flight, while it works. */
  step?: string;
  outcome?: [string, string][];
}

function summaryGoalFixtures(rl: Thread): SummaryGoalFixture[] {
  const byLabel = new Map(verdictFixtures(rl).map((f) => [f.label, f.thread]));
  const thread = (label: string) => byLabel.get(label)!;
  const at = rl.activity.at(-1)?.at ?? 0;
  const claimed = (
    id: string,
    text: string,
    evidence: string,
    command?: string,
  ): Criterion => ({
    id,
    text,
    command,
    claim: { evidence, at, by: 'claude' },
  });
  const done = thread('Done · no PR yet');
  const [checked, tests, types] = done.criteria!;
  return [
    {
      label: 'Working',
      thread: {
        ...done,
        title: 'Rate limit the public API',
        goal: 'Every rate-limited response from the public API tells the client when to retry',
        live: { isWorking: true },
        criteria: [
          checked,
          claimed(
            'c2',
            'Bursts over the limit get 429',
            'rate-limit.test.ts covers 50 calls in 1s',
            'pnpm test',
          ),
          { id: 'c3', text: 'Types and lint pass', command: 'vp check' },
        ],
      },
      step: 'Cover the burst case in rate-limit.test.ts',
    },
    {
      label: 'Done · question waiting',
      thread: {
        ...done,
        goal: 'Signed-in people stay signed in through the Better Auth migration',
        idle: { ...done.idle!, uncommitted: 2 },
        criteria: [
          claimed(
            'c1',
            'The old session cookie still signs you in',
            'Logged in with a pre-migration cookie in the preview',
          ),
          tests,
          types,
        ],
      },
      question: 'Commit the cookie fix and its test?',
    },
    {
      label: 'Gaps',
      thread: {
        ...thread('Gaps · 1 critical, 2 unverified'),
        goal: "PR chips in a deleted worktree show live GitHub state, not “GitHub couldn't be read”",
      },
      question:
        'Fix the 5 failing git tests, then check the #133 chip in the app?',
    },
    {
      label: 'Needs you',
      thread: {
        ...thread('Needs you · asked in prose'),
        goal: 'The checkout e2e passes on CI every time without retries',
      },
      question: 'Retry it, or quarantine it and open an issue?',
    },
    {
      label: 'Archived',
      thread: {
        ...done,
        status: 'settled',
        goal: 'Admins see API usage per key for the last 30 days',
        prs: [{ number: 133, state: 'merged', title: 'Admin usage dashboard' }],
      },
      outcome: [
        ['Time', '2h 14m from start to settle'],
        ['Criteria', '3 of 3 verified'],
        ['Goal', 'Changed once, by you'],
        ['Cost', '$4.12'],
        ['PRs', '#133 merged'],
      ],
    },
    {
      label: 'Worst case',
      thread: {
        ...thread('Worst case · 12 gaps, long everything'),
        goal: 'Checkout never blocks on the address lookup, every payment provider retries the same way, and CheckoutPage is split into components small enough to test on their own',
      },
      question:
        'Fix the 5 failing checks, then run the two provider sandboxes again once they are back up before opening the pull request?',
    },
  ];
}
