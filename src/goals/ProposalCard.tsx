import { Eye, Undo } from 'reicon-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card';
import { REF_CHIP_CLASS } from '@/icons/github';
import { TerminalIcon } from '@/icons/panes';
import { cn } from '@/lib/utils';
import { authorName, type GoalProposal, type Thread } from '../model';
import { useHarness } from '../store';
import { ProviderMark } from '../ui';
import { openGoalEditor } from './GoalEditor';

/**
 * The goal the agent wrote after its first look. Waiting: the draft it replaces struck through, the new outcome, its criteria
 * (a command Mochi runs, or you check), and Accept. Applied with undo: one line with Undo, until you write again.
 */
export function ProposalCard({ thread }: { thread: Thread }) {
  const { proposal } = thread;
  if (proposal?.state === 'waiting') return <WaitingProposal thread={thread} proposal={proposal} />;
  if (proposal?.state === 'applied' && !hasWrittenSince(thread, proposal.at)) return <AppliedProposal thread={thread} proposal={proposal} />;
  return null;
}

function WaitingProposal({ thread, proposal }: { thread: Thread; proposal: GoalProposal }) {
  const { dispatch } = useHarness();
  const decide = (decision: 'accept' | 'keep') => dispatch({ type: 'goal-proposal', threadId: thread.id, decision });
  const acceptAndEdit = () => {
    decide('accept');
    openGoalEditor(thread.id);
  };
  const agent = authorName(proposal.by);
  return (
    <Card size="sm" role="group" aria-label="Proposed goal">
      <CardHeader className="flex items-center gap-2">
        <ProviderMark provider={proposal.by} size={16} />
        <span className="min-w-0 flex-1 truncate type-meta font-medium">{`${agent} proposes a goal`}</span>
        <span className={cn('pointer-events-none flex h-[1.125rem] shrink-0 items-center gap-1 rounded-sm px-1.5 type-meta font-medium', REF_CHIP_CLASS.warning)}>
          <span aria-hidden className="size-1.5 rounded-full bg-current" />
          Waiting on you
        </span>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          {!!proposal.before.goal && proposal.before.goal !== proposal.goal && <s className="type-meta text-subtle-foreground">{proposal.before.goal}</s>}
          <p className="type-title text-pretty">{proposal.goal}</p>
          {!!proposal.basis && <p className="type-meta text-pretty text-muted-foreground">{proposal.basis}</p>}
        </div>
        <ProposedCriteria criteria={proposal.criteria} />
      </CardContent>
      <CardFooter className="flex-wrap gap-2">
        <span className="mr-auto type-caption text-muted-foreground">{`${agent} keeps working while this waits.`}</span>
        <Button size="sm" variant="ghost" onClick={() => decide('keep')}>
          Keep draft
        </Button>
        <Button size="sm" variant="outline" onClick={acceptAndEdit}>
          Accept and edit
        </Button>
        <Button size="sm" onClick={() => decide('accept')}>
          Accept goal
        </Button>
      </CardFooter>
    </Card>
  );
}

function ProposedCriteria({ criteria }: { criteria: GoalProposal['criteria'] }) {
  return (
    <ul aria-label="Done when" className="flex flex-col gap-1">
      {criteria.map((c) => (
        <li key={c.text} className="flex items-center gap-2.5 rounded-md bg-muted px-2.5 py-1.5 type-body">
          {c.command ? <TerminalIcon aria-label="Mochi runs a command" className="size-3.5 shrink-0 text-muted-foreground" /> : <Eye aria-label="You check" className="size-3.5 shrink-0 text-muted-foreground" />}
          <span className="min-w-0 flex-1 text-pretty">{c.text}</span>
          {c.command ? <code className="max-w-[40%] shrink-0 truncate">{c.command}</code> : <span className="shrink-0 type-caption text-[color-mix(in_oklab,var(--warning)_75%,var(--foreground))]">you check</span>}
        </li>
      ))}
    </ul>
  );
}

function AppliedProposal({ thread, proposal }: { thread: Thread; proposal: GoalProposal }) {
  const { dispatch } = useHarness();
  return (
    <p className="flex items-center gap-2 type-meta text-muted-foreground">
      <ProviderMark provider={proposal.by} size={14} />
      <span className="min-w-0 flex-1 truncate">
        {`${authorName(proposal.by)} set the goal: `}
        <span className="text-foreground">{proposal.goal}</span>
        {` · ${proposal.criteria.length} ${proposal.criteria.length === 1 ? 'criterion' : 'criteria'}`}
      </span>
      <Button size="sm" variant="ghost" onClick={() => dispatch({ type: 'goal-proposal', threadId: thread.id, decision: 'undo' })}>
        <Undo />
        Undo
      </Button>
      <Button size="sm" variant="ghost" onClick={() => openGoalEditor(thread.id)}>
        Edit
      </Button>
    </p>
  );
}

function hasWrittenSince(thread: Thread, at: number) {
  return thread.activity.some((e) => e.who === 'you' && e.kind === 'message' && e.at > at);
}
