import type { ActivityEntry, SubReport, Thread } from '../../model';
import { SubReportRow } from '../../chat/ThreadMessage';
import { Block } from '../layout';

/** What a sub-thread hands its parent, as rows in the parent's chat. Mock data; the first fixture's name opens the real thread. */
export function SubReportsBlock({ rl }: { rl: Thread }) {
  const entries = subReportFixtures(rl);
  return (
    <Block
      title="Sub-threads · reports in the parent's chat"
      use="A sub-thread's report, a turn end without one, a PR event or a reply from a messaged thread lands in the parent's chat as one log line, never a bubble: who sent it, its status, the first line muted. Done and merged stay quiet, anything that needs the parent is in the warning colour, a failure in red. Open, the whole report and whether the parent's agent has it yet. An empty one has nothing to open."
      wide
    >
      <div className="flex flex-wrap items-start gap-6">
        <ReportFrame label="Chat width" className="w-[640px] max-w-full">
          {entries}
        </ReportFrame>
        <ReportFrame label="Narrow · 320px" className="w-[320px]">
          {entries}
        </ReportFrame>
      </div>
    </Block>
  );
}

function ReportFrame({
  label,
  className,
  children,
}: {
  label: string;
  className: string;
  children: { entry: ActivityEntry; report: SubReport }[];
}) {
  return (
    <figure className={`flex flex-col gap-2 ${className}`}>
      <figcaption className="type-caption text-muted-foreground">
        {label}
      </figcaption>
      <div className="flex flex-col gap-1 rounded-xl border px-4 py-3">
        {children.map(({ entry, report }) => (
          <SubReportRow
            key={`${report.status}-${entry.at}`}
            entry={entry}
            report={report}
          />
        ))}
      </div>
    </figure>
  );
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
