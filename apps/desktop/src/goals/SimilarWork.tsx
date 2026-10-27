import { XSquare, Copy } from '@/icons';
import { Button } from '@/components/ui/button';
import type { Similar, Thread } from '../model';
import { nestBlocker } from '../reorder';
import { useHarness } from '../store';
import { nestWithUndo } from '../subThreadActions';
import { TooltipIconButton } from '../ui';
import { isGoalMet } from './verdict';

/** Threads the drafter found doing the same or overlapping work, so you don't do it twice. */
export function SimilarWork({ thread }: { thread: Thread }) {
  const { state } = useHarness();
  const rows = (thread.similar ?? []).flatMap((s) => {
    const other = state.threads.find((t) => t.id === s.threadId);
    return other ? [{ similar: s, other }] : [];
  });
  if (!rows.length) return null;
  return (
    <ul aria-label="Similar work" className="flex flex-col gap-1">
      {rows.map(({ similar, other }) => (
        <SimilarRow
          key={other.id}
          thread={thread}
          similar={similar}
          other={other}
        />
      ))}
    </ul>
  );
}

function SimilarRow({
  thread,
  similar,
  other,
}: {
  thread: Thread;
  similar: Similar;
  other: Thread;
}) {
  const { state, dispatch } = useHarness();
  // Related live work can take this thread as its sub-thread; the same work is a duplicate, never a part.
  const canNest =
    similar.relation === 'related' &&
    other.status !== 'settled' &&
    !thread.parent &&
    !nestBlocker(state.threads, thread.id, other.id);
  return (
    <li className="flex items-center gap-2 rounded-lg bg-muted/40 py-1 pr-1 pl-2.5">
      <Copy aria-hidden className="size-3.5 shrink-0 text-warning" />
      <span className="min-w-0 flex-1 truncate type-meta">
        <span className="text-muted-foreground">
          {similar.relation === 'same' ? 'Already in ' : 'Related: '}
        </span>
        <span className="text-foreground">{other.title}</span>
        <span className="text-subtle-foreground"> · {statusLine(other)}</span>
      </span>
      {canNest && (
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            nestWithUndo(dispatch, state.threads, thread, other.id)
          }
        >
          Nest under it
        </Button>
      )}
      <Button
        variant="ghost"
        size="sm"
        onClick={() =>
          dispatch({ type: 'go', view: { kind: 'thread', id: other.id } })
        }
      >
        Open
      </Button>
      <TooltipIconButton
        label="Dismiss"
        hint="Not the same work; stop showing it here"
        onClick={() =>
          dispatch({
            type: 'similar-dismiss',
            threadId: thread.id,
            otherId: other.id,
          })
        }
      >
        <XSquare />
      </TooltipIconButton>
    </li>
  );
}

function statusLine(other: Thread) {
  const pr = other.prs.at(-1);
  const state =
    other.status === 'settled'
      ? 'Settled'
      : other.status === 'review' || isGoalMet(other)
        ? 'Ready for review'
        : 'In progress';
  return pr ? `${state}, PR #${pr.number} ${pr.state}` : state;
}
