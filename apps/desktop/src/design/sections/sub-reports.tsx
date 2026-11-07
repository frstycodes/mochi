import type { ActivityEntry, SubReport, Thread } from '../../model';
import { SubReports } from '../../chat/SubReports';
import { useHarness } from '../../store';
import { Block } from '../layout';

/** What sub-threads hand their parent, as one card in the parent's chat. Mock reports on real demo threads, so each name opens one. */
export function SubReportsBlock({ rl }: { rl: Thread }) {
  const entries = useDemoReports(rl);
  return (
    <Block
      title="Sub-threads · messages in the parent's chat"
      use="Messages from sub-threads (their reports, turn ends without one, PR events) and replies from messaged threads that land back to back share one card in the parent's chat, never bubbles: what needs you first, each with its agent's mark, its name (opens the thread), its status and the first line, which opens to the whole message and whether the parent's agent has it yet. One reads as a message from a sub-thread; up to 4 show open; more fold into one counted line that opens to the same card."
      wide
    >
      <div className="flex flex-col gap-8">
        {[entries.slice(0, 1), entries.slice(0, 3), entries].map((list) => (
          <div key={list.length} className="flex flex-wrap items-start gap-6">
            <Frame
              label={`${list.length} ${list.length === 1 ? 'message' : 'messages'} · chat width`}
              className="w-[640px] max-w-full"
            >
              <SubReports entries={list} />
            </Frame>
            <Frame label="Narrow · 320px" className="w-[320px]">
              <SubReports entries={list} />
            </Frame>
          </div>
        ))}
      </div>
    </Block>
  );
}

function Frame({
  label,
  className,
  children,
}: {
  label: string;
  className: string;
  children: React.ReactNode;
}) {
  return (
    <figure className={`flex flex-col gap-2 ${className}`}>
      <figcaption className="type-caption text-muted-foreground">
        {label}
      </figcaption>
      {children}
    </figure>
  );
}

/** The fixtures pointed at real demo threads, Claude and Codex mixed. */
function useDemoReports(rl: Thread): ActivityEntry[] {
  const { state } = useHarness();
  const claude = state.threads.filter((t) => t.providers[0] === 'claude');
  const codex = state.threads.filter((t) => t.providers[0] === 'codex');
  return subReportFixtures(rl).map(({ entry, report }, i) => {
    const pool = i % 2 && codex.length ? codex : claude;
    const thread = pool[Math.floor(i / 2) % pool.length] ?? rl;
    return {
      ...entry,
      subReport: { ...report, threadId: thread.id, title: thread.title },
    };
  });
}

function subReportFixtures(rl: Thread) {
  const at = Date.now();
  const fixture = (text: string, report: SubReport, ago: number) => ({
    entry: { at: at - ago, who: 'harness', kind: 'event', text } as const,
    report,
  });
  return [
    fixture(
      'Added the endpoint.\nBranch piece-a · PR #7\nChanged: a.ts, b.ts\nChecks: pnpm test passed; pnpm lint failed',
      { threadId: rl.id, title: rl.title, status: 'done', isDelivered: true },
      600_000,
    ),
    fixture(
      'The burst test needs a Redis instance and none is configured in this worktree.',
      {
        threadId: 'piece-b',
        title: 'Burst test',
        status: 'blocked',
        isUrgent: true,
      },
      480_000,
    ),
    fixture(
      'Which header name should the client read, Retry-After or RateLimit-Reset?',
      {
        threadId: 'piece-c',
        title: 'Client retries',
        status: 'needs_input',
        isUrgent: true,
      },
      420_000,
    ),
    fixture(
      'pnpm test exited 1: 3 suites failed in rate-limit.test.ts after the token bucket refactor.',
      {
        threadId: 'piece-d',
        title: 'Token bucket refactor',
        status: 'failed',
        isUrgent: true,
      },
      360_000,
    ),
    fixture(
      'Last action: Ran pnpm build',
      {
        threadId: 'piece-e',
        title: 'Docs for the RateLimit headers',
        status: 'has had no activity for 10 min; it may be stuck',
        isUrgent: true,
      },
      300_000,
    ),
    fixture(
      '',
      {
        threadId: 'piece-a',
        title: 'Endpoint',
        status: 'PR #12: merged',
        isDelivered: true,
      },
      240_000,
    ),
    fixture(
      'Yes: the staging gateway already sends RateLimit-* headers, since v2.4.',
      {
        threadId: 'gateway',
        title: 'Gateway audit',
        status: 'done',
        isReply: true,
      },
      180_000,
    ),
    fixture(
      '',
      { threadId: 'piece-f', title: 'Metrics', status: 'interrupted' },
      120_000,
    ),
  ];
}
