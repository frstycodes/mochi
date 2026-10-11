import { ArrowSwapHorizontal, History, Routing, TransferH, Undo } from 'reicon-react';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import type { Thread } from '../model';
import { useHarness } from '../store';
import { forkRelatives } from './fork';
import { PROVIDER_NAME } from './handoff';
import { openRewind } from './requests';
import { useRewindActions } from './useRewindActions';

/** Rewind, fork, compare and handoff entries for a thread's header menu. */
export function RewindMenuItems({ thread }: { thread: Thread }) {
  const { state } = useHarness();
  const { undo } = useRewindActions();
  const relatives = forkRelatives(state, thread.id);
  const other = thread.providers[0] === 'claude' ? 'codex' : 'claude';
  const canUndo = state.rewindUndo?.threadId === thread.id;

  return (
    <>
      <DropdownMenuItem onSelect={() => openRewind({ kind: 'rewind', threadId: thread.id })}>
        <History />
        Rewind to a checkpoint…
      </DropdownMenuItem>
      {canUndo && (
        <DropdownMenuItem onSelect={() => void undo()}>
          <Undo />
          Undo rewind
        </DropdownMenuItem>
      )}
      <DropdownMenuItem onSelect={() => openRewind({ kind: 'fork', threadId: thread.id })}>
        <Routing />
        Fork thread…
      </DropdownMenuItem>
      {relatives.map((r) => (
        <DropdownMenuItem key={r.id} onSelect={() => openRewind({ kind: 'compare', threadId: thread.id, otherId: r.id })}>
          <ArrowSwapHorizontal />
          <span className="min-w-0 truncate">Compare with {r.title}</span>
        </DropdownMenuItem>
      ))}
      <DropdownMenuItem onSelect={() => openRewind({ kind: 'handoff', threadId: thread.id })}>
        <TransferH />
        Hand off to {PROVIDER_NAME[other]}…
      </DropdownMenuItem>
    </>
  );
}
