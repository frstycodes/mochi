import { ArrowLeftRight, Undo } from '@/icons';
import { DropdownMenuGroup, DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import type { Thread } from '../model';
import { useHarness } from '../store';
import { SkippedItem } from '../menus/ActionItems';
import { rewindBlockedReason } from './checkpoints';
import { forkRelatives } from './fork';
import { openRewind } from './requests';
import { useRewindActions } from './useRewindActions';

/** The header menu's entries the action registry has no action for: undo the last rewind, compare with a fork. Nothing when neither applies. */
export function RewindMenuItems({ thread }: { thread: Thread }) {
  const { state } = useHarness();
  const { undo } = useRewindActions();
  const relatives = forkRelatives(state, thread.id);
  const canUndo = state.rewindUndo?.threadId === thread.id;
  const blockedReason = rewindBlockedReason(thread);
  if (!canUndo && !relatives.length) return null;

  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuGroup>
        {canUndo && (blockedReason ? (
          <SkippedItem menu="dropdown" icon={<Undo />} title="Undo rewind" reason={blockedReason} />
        ) : (
          <DropdownMenuItem onSelect={() => void undo()}>
            <Undo />
            Undo rewind
          </DropdownMenuItem>
        ))}
        {relatives.map((r) => (
          <DropdownMenuItem key={r.id} onSelect={() => openRewind({ kind: 'compare', threadId: thread.id, otherId: r.id })}>
            <ArrowLeftRight />
            <span className="min-w-0 truncate">Compare with {r.title}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuGroup>
    </>
  );
}
