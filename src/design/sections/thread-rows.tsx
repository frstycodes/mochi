import type { ReactNode } from 'react';
import { Chat } from '@/icons';
import { Shimmer } from '@/components/ai-elements/shimmer';
import { cn } from '@/lib/utils';
import { isMet, type Thread } from '../../model';
import { AgentLoader } from '../../AgentLoader';
import { PrStack } from '../../git/PrStack';
import { ProjectIcon } from '../../ProjectIcon';
import { StatusRing, useIdleVerdict, VerdictChip, VerdictIcon } from '../../goals/VerdictChip';
import type { Verdict } from '../../goals/verdict';
import { lineColor } from '../../ui';
import { Block } from '../layout';
import { verdictFixtures } from '../verdictFixtures';

/** Sidebar thread rows with one status mark instead of ring + count, verdict chip and Mochi, and no branch or project name. Mock data. */
export function ThreadRowVariantsBlock({ rl }: { rl: Thread }) {
  const rows = rowFixtures(rl);
  return (
    <Block
      title="Thread rows · one status"
      use="Four ways to say a thread's state with one mark. Each column is the same nine threads: working, needs you, your call, gaps, done, in review, limit, stopped, a plain chat. Project is its icon only; no branch."
      wide
    >
      <div className="flex flex-wrap items-start gap-6">
        {VARIANTS.map(({ name, note, Row }) => (
          <figure key={name} className="flex w-[256px] flex-col gap-2">
            <figcaption className="flex flex-col">
              <span className="type-meta font-medium">{name}</span>
              <span className="type-caption text-muted-foreground">{note}</span>
            </figcaption>
            <ul className="flex flex-col gap-0.5 rounded-xl border bg-sidebar p-2">
              {rows.map((r, i) => (
                <li key={r.thread.title}>
                  <Row row={r} isActive={i === 1} />
                </li>
              ))}
            </ul>
          </figure>
        ))}
      </div>
    </Block>
  );
}

interface RowFixture {
  thread: Thread;
  ago: string;
  /** What a working agent is doing right now. */
  action?: string;
}

interface RowProps {
  row: RowFixture;
  isActive: boolean;
}

const VARIANTS = [
  { name: 'A · Status line', note: 'One toned mark leads the second line: its word, then why.', Row: StatusLineRow },
  { name: 'B · The ring is the status', note: 'The ring fills by criteria and takes the verdict’s colour; the line under the title says why.', Row: RingRow },
  { name: 'C · Mochi is the status', note: 'Mochi acts out what the agent does; idle, a toned dot on Mochi says the verdict.', Row: MochiRow },
  { name: 'D · One line', note: 'Title only; the status sits at the right edge: a spinner while working, else the verdict chip.', Row: OneLineRow },
] satisfies { name: string; note: string; Row: (p: RowProps) => ReactNode }[];

function RowShell({ isActive, className, children }: { isActive: boolean; className?: string; children: ReactNode }) {
  return <button type="button" className={cn('flex w-full min-w-0 flex-col gap-1 rounded-lg px-2 py-2 text-left text-sm hover:bg-sidebar-accent/60 focus-visible:bg-sidebar-accent/60 focus-visible:outline-none', isActive && 'bg-sidebar-accent', className)}>{children}</button>;
}

function ProjectMark({ thread }: { thread: Thread }) {
  return thread.repo ? <ProjectIcon name={thread.repo.project} /> : <Chat aria-label="No project" className="size-4 shrink-0 text-subtle-foreground" />;
}

function TitleLine({ thread, ago, isActive, lead }: { thread: Thread; ago: string; isActive: boolean; lead: ReactNode }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      {lead}
      <span className={cn('min-w-0 flex-1 truncate', isActive ? 'text-foreground' : 'text-foreground/75')}>{thread.title}</span>
      <span className="shrink-0 tabular type-caption text-subtle-foreground">{ago}</span>
    </span>
  );
}

/** The one line a row says about its state: the action while working, the verdict's reason when idle. */
function Reason({ row, verdict }: { row: RowFixture; verdict: Verdict | null }) {
  if (row.thread.live?.isWorking) return <Shimmer as="span" className="min-w-0 truncate">{row.action ?? 'Working'}</Shimmer>;
  return <span className="min-w-0 truncate">{verdict && verdict.kind !== 'idle' ? verdict.reason : 'Idle'}</span>;
}

// A · The status reads as a line
function StatusLineRow({ row, isActive }: RowProps) {
  const { thread, ago } = row;
  const verdict = useIdleVerdict(thread);
  const isWorking = !!thread.live?.isWorking;
  const hasVerdict = !isWorking && !!verdict && verdict.kind !== 'idle';
  return (
    <RowShell isActive={isActive}>
      <TitleLine thread={thread} ago={ago} isActive={isActive} lead={<ProjectMark thread={thread} />} />
      <span className="flex min-w-0 items-center gap-1.5 pl-6 type-caption text-subtle-foreground">
        {isWorking ? <Spinner thread={thread} /> : hasVerdict && <ToneIcon verdict={verdict} />}
        {hasVerdict && <span className={cn('shrink-0 font-medium', TONE_TEXT[verdict.tone])}>{verdict.chip}</span>}
        {hasVerdict && <span aria-hidden>·</span>}
        <Reason row={row} verdict={verdict} />
        <span className="ml-auto flex shrink-0 items-center">
          <PrStack thread={thread} />
        </span>
      </span>
    </RowShell>
  );
}

// B · The ring is the status
function RingRow({ row, isActive }: RowProps) {
  const { thread, ago } = row;
  const verdict = useIdleVerdict(thread);
  return (
    <RowShell isActive={isActive}>
      <TitleLine thread={thread} ago={ago} isActive={isActive} lead={<RingFor thread={thread} verdict={verdict} />} />
      <span className="flex min-w-0 items-center gap-1.5 pl-6 type-caption text-subtle-foreground">
        <span className="flex size-3 shrink-0 items-center justify-center [&>*]:scale-75">
          <ProjectMark thread={thread} />
        </span>
        <Reason row={row} verdict={verdict} />
        <span className="ml-auto flex shrink-0 items-center">
          <PrStack thread={thread} />
        </span>
      </span>
    </RowShell>
  );
}

function RingFor({ thread, verdict }: { thread: Thread; verdict: Verdict | null }) {
  const criteria = thread.criteria ?? [];
  const isWorking = !!thread.live?.isWorking;
  const shown = !isWorking && verdict && verdict.kind !== 'idle' ? verdict : null;
  return <StatusRing met={criteria.filter((c) => isMet(c, thread.idle?.isConfirmed)).length} total={criteria.length} tone={shown?.tone ?? null} isWorking={isWorking} slot={thread.line} label={isWorking ? 'Working' : (shown?.chip ?? 'Idle')} />;
}

// C · Mochi is the status
function MochiRow({ row, isActive }: RowProps) {
  const { thread, ago } = row;
  const verdict = useIdleVerdict(thread);
  const isWorking = !!thread.live?.isWorking;
  const tone = !isWorking && verdict && verdict.kind !== 'idle' ? verdict.tone : null;
  const lead = (
    <span className="relative flex size-4 shrink-0 items-center justify-center">
      <AgentLoader phase={isWorking ? 'edit' : 'idle'} className="size-4" />
      {!!tone && <span aria-label={verdict!.chip} className={cn('absolute -right-0.5 -bottom-0.5 size-2 rounded-full ring-2 ring-sidebar', TONE_BG[tone])} />}
    </span>
  );
  return (
    <RowShell isActive={isActive}>
      <TitleLine thread={thread} ago={ago} isActive={isActive} lead={lead} />
      <span className="flex min-w-0 items-center gap-1.5 pl-6 type-caption text-subtle-foreground">
        <span className="flex size-3 shrink-0 items-center justify-center [&>*]:scale-75">
          <ProjectMark thread={thread} />
        </span>
        {!!tone && <span className={cn('shrink-0 font-medium', TONE_TEXT[tone])}>{verdict!.chip}</span>}
        {!!tone && <span aria-hidden>·</span>}
        <Reason row={row} verdict={verdict} />
      </span>
    </RowShell>
  );
}

// D · One line
function OneLineRow({ row, isActive }: RowProps) {
  const { thread } = row;
  const verdict = useIdleVerdict(thread);
  const isWorking = !!thread.live?.isWorking;
  const hasChip = !isWorking && !!verdict && verdict.kind !== 'idle';
  return (
    <RowShell isActive={isActive} className="flex-row items-center gap-2 py-1.5">
      <ProjectMark thread={thread} />
      <span className={cn('min-w-0 flex-1 truncate', isActive ? 'text-foreground' : 'text-foreground/75')} title={hasChip ? verdict.reason : row.action}>
        {thread.title}
      </span>
      {isWorking ? <Spinner thread={thread} /> : hasChip && <VerdictChip verdict={verdict} className="type-caption" />}
    </RowShell>
  );
}

/** The working mark everywhere: the ring's spinning arc in the thread's line colour. */
function Spinner({ thread }: { thread: Thread }) {
  return (
    <svg viewBox="0 0 12 12" aria-label="Working" className="size-3 shrink-0 animate-spin motion-reduce:animate-none">
      <circle cx="6" cy="6" r="4.5" fill="none" stroke="var(--muted-foreground)" strokeOpacity={0.3} strokeWidth="1.75" />
      <circle cx="6" cy="6" r="4.5" fill="none" stroke={lineColor(thread.line)} strokeWidth="1.75" strokeDasharray="7 30" strokeLinecap="round" />
    </svg>
  );
}

function ToneIcon({ verdict }: { verdict: Verdict }) {
  return (
    <span className={cn('flex size-3 shrink-0 items-center justify-center', TONE_TEXT[verdict.tone])}>
      <VerdictIcon kind={verdict.kind} className="size-3" />
    </span>
  );
}

const TONE_TEXT = { success: 'text-success', warning: 'text-warning', destructive: 'text-destructive', muted: 'text-muted-foreground' } satisfies Record<Verdict['tone'], string>;
const TONE_BG = { success: 'bg-success', warning: 'bg-warning', destructive: 'bg-destructive', muted: 'bg-muted-foreground' } satisfies Record<Verdict['tone'], string>;

/** The nine states, on the verdict fixtures' threads. */
function rowFixtures(rl: Thread): RowFixture[] {
  const byLabel = new Map(verdictFixtures(rl).map((f) => [f.label, f.thread]));
  const thread = (label: string) => byLabel.get(label)!;
  const done = thread('Done · no PR yet');
  return [
    { thread: { ...done, title: 'Public API rate limiting', live: { isWorking: true } }, ago: 'now', action: 'Editing ratelimit.ts' },
    { thread: thread('Needs you · asked in prose'), ago: '4m' },
    { thread: thread('Your call · a lookup with no folder'), ago: '12m' },
    { thread: thread('Gaps · 1 critical, 2 unverified'), ago: '25m' },
    { thread: done, ago: '40m' },
    { thread: thread('Done · in review'), ago: '1h' },
    { thread: thread('Stalled · usage limit'), ago: '2h' },
    // Its own open plan item: the demo's ticking would otherwise finish the borrowed plan and turn it into Your call.
    { thread: { ...thread('Stalled · stopped mid-plan'), steps: [{ id: 'dv1', title: 'Offline devices show their age', status: 'ready', addedAt: 0, addedBy: 'claude' }] }, ago: '3h' },
    { thread: { ...done, title: 'How does the drift guard decide?', repo: null, goal: '', criteria: [], idle: undefined }, ago: '1d' },
  ];
}
