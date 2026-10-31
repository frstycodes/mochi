import type { ReactNode } from 'react';
import { Shimmer } from '@/components/ai-elements/shimmer';
import { GitPullRequestIcon, REF_TONE_CLASS } from '@/icons/github';
import { cn } from '@/lib/utils';
import type { Thread } from '../../model';
import { ProjectIcon } from '../../ProjectIcon';
import { SubThreadGuide, TONE_TEXT } from '../../goals/SubThreads';
import { StatusRing } from '../../goals/VerdictChip';
import type { Verdict } from '../../goals/verdict';
import { Block } from '../layout';

/** Threads an agent starts for a piece of its work, nested under it. Mock data; nothing is wired. */
export function SubThreadsBlock({ rl }: { rl: Thread }) {
  return (
    <Block
      title="Sub-threads · sidebar tree"
      use="A sub-thread has its own agent, branch and PR. Sub-threads sit under their parent on an L-shaped guide, one line each, a second only when one asks for you; finished ones fold into one row. No time since activity on any row. A parent with three sub-threads (working, one asking, in review), a parent whose two finished, then a plain thread."
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
  );
}

interface RowFixture {
  title: string;
  tone: Verdict['tone'] | null;
  isWorking?: boolean;
  /** The verdict's word, for the ring's label. */
  status: string;
  /** What it's doing while it works, else why it stopped. */
  reason: string;
  pr?: { number: number; status: 'open' | 'merged' };
  isSettled?: boolean;
}

interface Family {
  parent: RowFixture;
  children: RowFixture[];
}

const FAMILIES: Family[] = [
  {
    parent: {
      title: 'Public API rate limiting',
      tone: 'warning',
      status: 'Needs you',
      reason: 'Document 429 responses asks for you',
    },
    children: [
      {
        title: 'Load test at 2k req/s',
        tone: null,
        isWorking: true,
        status: 'Working',
        reason: 'Running k6 at 2k req/s',
      },
      {
        title: 'Document 429 responses',
        tone: 'warning',
        status: 'Question',
        reason: 'Use the staging API for the example?',
      },
      {
        title: 'Return RateLimit-* headers',
        tone: null,
        status: 'Idle',
        reason: 'PR #141 in review',
        pr: { number: 141, status: 'open' },
      },
    ],
  },
  {
    parent: {
      title: 'Migrate auth to Better Auth',
      tone: null,
      status: 'Idle',
      reason: 'Merge 2 sub-thread PRs',
      pr: { number: 487, status: 'open' },
    },
    children: [
      {
        title: 'Keep the session cookie name',
        tone: null,
        status: 'Idle',
        reason: 'Merged into the parent',
        pr: { number: 488, status: 'merged' },
        isSettled: true,
      },
      {
        title: 'Port the OAuth callbacks',
        tone: null,
        status: 'Idle',
        reason: 'Merged into the parent',
        pr: { number: 489, status: 'merged' },
        isSettled: true,
      },
    ],
  },
];

const PLAIN: RowFixture = {
  title: 'Fix flaky checkout e2e',
  tone: 'warning',
  status: 'Needs you',
  reason: 'Answer 2 questions',
};

function GuideTree({ family, rl }: { family: Family; rl: Thread }) {
  const open = family.children.filter((c) => !c.isSettled);
  return (
    <li className="flex flex-col">
      <ParentRow row={family.parent} rl={rl} />
      <ul
        aria-label={`Sub-threads of ${family.parent.title}`}
        className="-mt-1 ml-[15px] flex flex-col gap-0.5"
      >
        {open.map((c, i) => (
          <Branch key={c.title} isLast={i === open.length - 1}>
            <ChildRow row={c} rl={rl} />
          </Branch>
        ))}
      </ul>
    </li>
  );
}

/** One sub-thread on the parent's guide. */
function Branch({
  isLast,
  children,
}: {
  isLast: boolean;
  children: ReactNode;
}) {
  return (
    <li className="relative pl-3">
      <SubThreadGuide isLast={isLast} />
      {children}
    </li>
  );
}

function RowShell({
  isActive,
  className,
  children,
}: {
  isActive?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        'relative flex w-full min-w-0 flex-col gap-1 rounded-lg px-2 py-2 text-left text-sm hover:bg-sidebar-accent/60',
        isActive && 'bg-sidebar-accent',
        className,
      )}
    >
      {children}
    </div>
  );
}

/** The sidebar's thread row as shipped: ring and title; project icon, reason, PR. */
function ParentRow({ row, rl }: { row: RowFixture; rl: Thread }) {
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
function ChildRow({ row, rl }: { row: RowFixture; rl: Thread }) {
  const asks = row.tone === 'warning' || row.tone === 'destructive';
  return (
    <RowShell className="gap-0.5 px-1 py-1.5">
      <TitleLine row={row} rl={rl} extra={!!row.pr && <PrMark pr={row.pr} />} />
      {asks && (
        <span
          className={cn('truncate pl-6 type-caption', TONE_TEXT[row.tone!])}
        >
          {row.reason}
        </span>
      )}
    </RowShell>
  );
}

function TitleLine({
  row,
  rl,
  extra,
}: {
  row: RowFixture;
  rl: Thread;
  extra?: ReactNode;
}) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <StatusRing
        tone={row.tone}
        isWorking={!!row.isWorking}
        slot={rl.line}
        label={row.status}
      />
      <span className="min-w-0 flex-1 truncate text-foreground/75">
        {row.title}
      </span>
      {extra}
    </span>
  );
}

function Reason({ row }: { row: RowFixture }) {
  if (row.isWorking)
    return (
      <Shimmer as="span" className="min-w-0 flex-1 truncate">
        {row.reason}
      </Shimmer>
    );
  return <span className="min-w-0 flex-1 truncate">{row.reason}</span>;
}

function PrMark({ pr }: { pr: NonNullable<RowFixture['pr']> }) {
  return (
    <GitPullRequestIcon
      aria-label={`PR #${pr.number}, ${pr.status}`}
      className={cn(
        'size-3 shrink-0',
        REF_TONE_CLASS[pr.status === 'merged' ? 'merged' : 'success'],
      )}
    />
  );
}
