import { useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, DiagramTree, MessagePlus } from '@/icons';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { authorName, type ActivityEntry, type Thread, type ThreadProposal } from '../model';
import { useHarness } from '../store';
import { SubThreadState } from '../goals/SubThreads';
import { useThreadStatus } from '../goals/VerdictChip';
import { isExpired, OFFER_REPLY } from './proposals';
import { ThreadName } from './ThreadMessage';

/** A proposal as a card shows it: expiry is read off the clock, never stored. */
export type ShownProposal = ThreadProposal & { isExpired?: boolean };

/** One turn's thread cards where the agent made them: each offer on its own, the turn's proposals paged on one card. */
export function ProposalEntry({ thread, entry }: { thread: Thread; entry: ActivityEntry }) {
  const { state, dispatch } = useHarness();
  const shown = (entry.proposals ?? []).map((p) => ({ ...p, isExpired: isExpired(p, entry, state.now) }));
  const start = (p: ThreadProposal) => dispatch({ type: 'proposal-start', threadId: thread.id, proposalId: p.id });
  const answer = (p: ThreadProposal, state: 'here' | 'dismissed') => dispatch({ type: 'proposal-answer', threadId: thread.id, proposalId: p.id, state });
  // The agent ended its turn to wait on an offer, so your answer in place is its next message.
  const reply = (p: ThreadProposal, state: keyof typeof OFFER_REPLY) => {
    answer(p, state);
    dispatch({ type: 'send', threadId: thread.id, text: OFFER_REPLY[state], reason: `Answered the offer "${p.title}"` });
  };
  const proposals = shown.filter((p) => p.initiation !== 'offer');
  return (
    <div className="flex flex-col gap-3">
      {shown
        .filter((p) => p.initiation === 'offer')
        .map((p) => (
          <OfferCard key={p.id} proposal={p} agent={authorName(thread.providers[0])} onNew={() => start(p)} onHere={() => reply(p, 'here')} onDismiss={() => reply(p, 'dismissed')} />
        ))}
      {proposals.length > 0 && <ProposalCard proposals={proposals} onStart={start} onDismiss={(p) => answer(p, 'dismissed')} />}
    </div>
  );
}

/** The agent's suggestions, or a sub-thread's asked-for threads: Dismiss and Start; several from one turn page through it (‹ 2 of 3 ›) with Start all. */
export function ProposalCard({ proposals, onStart, onDismiss }: { proposals: ShownProposal[]; onStart: (p: ShownProposal) => void; onDismiss: (p: ShownProposal) => void }) {
  const [at, setAt] = useState(() => Math.max(0, proposals.findIndex(isOpen)));
  const proposal = proposals[Math.min(at, proposals.length - 1)];
  // Starting or dismissing one turns to the next that still waits, so the card shows what's left to decide.
  const settle = (act: (p: ShownProposal) => void) => () => {
    act(proposal);
    const next = proposals.findIndex((p) => p.id !== proposal.id && isOpen(p));
    if (next >= 0) setAt(next);
  };
  const open = proposals.filter(isOpen);
  const startAll = open.length > 1 && (
    <Button size="sm" variant="outline" onClick={() => open.forEach(onStart)}>
      {`Start all ${open.length}`}
    </Button>
  );
  return (
    <section aria-label="Suggested threads" aria-roledescription={proposals.length > 1 ? 'carousel' : undefined} className="flex flex-col rounded-xl border p-1">
      <ProposalRow key={proposal.id} proposal={proposal} onStart={settle(onStart)} onDismiss={settle(onDismiss)} pager={proposals.length > 1 && <Pager at={at} count={proposals.length} onTurn={setAt} />} startAll={startAll} />
    </section>
  );
}

const isOpen = (p: ShownProposal) => p.state === 'pending' && !p.isExpired;

/** ‹ 2 of 3 ›: which suggestion this is, the others one click away. Arrow keys turn it too. */
function Pager({ at, count, onTurn }: { at: number; count: number; onTurn: (i: number) => void }) {
  return (
    <span
      className="flex shrink-0 items-center"
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft' && at > 0) onTurn(at - 1);
        if (e.key === 'ArrowRight' && at < count - 1) onTurn(at + 1);
      }}
    >
      <Button size="icon-xs" variant="ghost" aria-label="Previous suggestion" disabled={at === 0} onClick={() => onTurn(at - 1)}>
        <ChevronLeft />
      </Button>
      <span aria-live="polite" className="min-w-10 text-center type-caption text-subtle-foreground tabular-nums">{`${at + 1} of ${count}`}</span>
      <Button size="icon-xs" variant="ghost" aria-label="Next suggestion" disabled={at === count - 1} onClick={() => onTurn(at + 1)}>
        <ChevronRight />
      </Button>
    </span>
  );
}

function ProposalRow({ proposal, onStart, onDismiss, pager, startAll }: { proposal: ShownProposal; onStart: () => void; onDismiss: () => void; pager?: ReactNode; startAll?: ReactNode }) {
  const [isBriefOpen, setBriefOpen] = useState(false);
  const isPending = isOpen(proposal);
  const isStarted = proposal.state === 'started' && !!proposal.threadId;
  return (
    <div className="flex flex-col rounded-lg px-2 py-1">
      <div className="flex min-h-7 min-w-0 items-center gap-2 type-body">
        {isStarted ? <DiagramTree aria-hidden className="size-4 shrink-0 text-muted-foreground" /> : <MessagePlus aria-hidden className="size-4 shrink-0 text-muted-foreground" />}
        {isStarted ? <ThreadName peer={{ threadId: proposal.threadId, title: proposal.title }} /> : <span className={cn('min-w-0 truncate', isPending ? 'text-foreground' : 'text-muted-foreground')}>{proposal.title}</span>}
        {isPending && <Disclosure isOpen={isBriefOpen} onToggle={() => setBriefOpen((o) => !o)} />}
        <span className="ml-auto flex shrink-0 items-center gap-1">
          {pager}
          {isStarted && <StartedState threadId={proposal.threadId!} />}
          {!isPending && !isStarted && <span className="type-meta text-subtle-foreground">{closedNote(proposal)}</span>}
        </span>
      </div>
      {isPending && isBriefOpen && <Brief text={proposal.brief} className="pl-6" />}
      {isPending && (
        <div className="flex items-center justify-end gap-1.5 pt-1.5">
          <Button size="sm" variant="ghost" onClick={onDismiss}>
            Dismiss
          </Button>
          {startAll}
          <Button size="sm" onClick={onStart}>
            Start
          </Button>
        </div>
      )}
    </div>
  );
}

/** What the started thread is doing now, like its sidebar row. */
function StartedState({ threadId }: { threadId: string }) {
  const sub = useHarness().state.threads.find((t) => t.id === threadId);
  if (!sub) return <span className="type-meta text-subtle-foreground">Started</span>;
  return <LiveState sub={sub} />;
}

function LiveState({ sub }: { sub: Thread }) {
  return <SubThreadState sub={sub} status={useThreadStatus(sub)} className="type-meta" />;
}

function closedNote(p: ShownProposal) {
  if (p.isExpired) return 'Expired after 7 days';
  if (p.state === 'dismissed') return p.reason ? `Withdrawn: ${p.reason}` : 'Dismissed';
  if (p.state === 'here') return 'Done in this thread';
  return 'Started';
}

/** A task you named that may not belong here: the agent waits for New thread, Do it here or Dismiss. */
export function OfferCard({ proposal, agent, onNew, onHere, onDismiss }: { proposal: ShownProposal; agent: string; onNew: () => void; onHere: () => void; onDismiss: () => void }) {
  const [isBriefOpen, setBriefOpen] = useState(false);
  if (!isOpen(proposal)) return <OfferRecord proposal={proposal} />;
  return (
    <section aria-label="Where should this run?" className="flex flex-col gap-2 rounded-xl border px-3 py-2.5">
      <div className="flex items-start gap-2">
        <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-warning" />
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="type-body">
            Run <span className="font-medium">{proposal.title}</span> in a new thread?
          </p>
          <p className="flex items-center gap-1 type-caption text-subtle-foreground">
            {`${agent} waits for your answer.`}
            <Disclosure isOpen={isBriefOpen} onToggle={() => setBriefOpen((o) => !o)} />
          </p>
          {isBriefOpen && <Brief text={proposal.brief} />}
        </div>
      </div>
      <div className="flex items-center justify-end gap-1.5">
        <Button size="sm" variant="ghost" onClick={onDismiss}>
          Dismiss
        </Button>
        <Button size="sm" variant="outline" onClick={onHere}>
          Do it here
        </Button>
        <Button size="sm" onClick={onNew}>
          New thread
        </Button>
      </div>
    </section>
  );
}

function OfferRecord({ proposal }: { proposal: ShownProposal }) {
  const isStarted = proposal.state === 'started' && !!proposal.threadId;
  return (
    <p className="flex min-h-7 min-w-0 items-center gap-2 type-meta text-muted-foreground">
      {isStarted ? <DiagramTree aria-hidden className="size-4 shrink-0" /> : <MessagePlus aria-hidden className="size-4 shrink-0" />}
      {isStarted ? (
        <span className="flex min-w-0 items-center gap-1">
          Started <ThreadName peer={{ threadId: proposal.threadId, title: proposal.title }} /> in a new thread
        </span>
      ) : (
        <span className="min-w-0 truncate">{`${proposal.title} · ${proposal.state === 'here' ? 'you chose to do it here' : proposal.state === 'dismissed' && !proposal.reason ? 'you dismissed it' : closedNote(proposal)}`}</span>
      )}
    </p>
  );
}

function Disclosure({ isOpen, onToggle }: { isOpen: boolean; onToggle: () => void }) {
  return (
    <button type="button" aria-expanded={isOpen} onClick={onToggle} className="flex shrink-0 cursor-pointer items-center gap-0.5 rounded-md px-1 type-caption text-subtle-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
      Brief
      <ChevronRight aria-hidden className={cn('size-3 transition-transform duration-150', isOpen && 'rotate-90')} />
    </button>
  );
}

function Brief({ text, className }: { text: string; className?: string }) {
  return <p className={cn('pt-1 type-meta whitespace-pre-wrap text-muted-foreground', className)}>{text}</p>;
}
