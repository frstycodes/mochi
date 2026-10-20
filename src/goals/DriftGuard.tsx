import { useId, type KeyboardEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Compass } from '@/icons';
import { toast } from '@/toast/store';
import { Button } from '@/components/ui/button';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { sendMessage, setDriftPending, useDriftPending } from '../chat/outbox';
import { hasGoal, type DriftKind } from '../drift';
import type { QueuedMessage, Thread } from '../model';
import { isMod, isNav } from '../keys';
import { goalProgress } from '../progress';
import { setPrefs, usePrefs } from '../settings/prefs';
import { Shortcut } from '../Shortcut';
import { snapshot, useHarness } from '../store';
import { openGoalEditor } from './GoalEditor';

type BranchFrom = 'current' | 'base';

/** Every message goes out at once; a confident off-goal verdict, usually arriving late from the model, then suggests moving it to a new thread. `onSent` runs once a message goes. */
export function useDriftGuard(thread: Thread, onSent?: () => void) {
  const { state, dispatch } = useHarness();
  const pending = useDriftPending(thread.id);
  const setPending = (next: null) => setDriftPending(thread.id, next);
  const [branchFrom, setBranchFrom] = useRememberedBranchFrom();

  const tag = (text: string, drift: DriftKind, reason: string) => dispatch({ type: 'drift-verdict', threadId: thread.id, text, drift, reason });

  /** Always sends: the suggestion never holds a message back. */
  const submit = (message: QueuedMessage, extra?: Parameters<typeof sendMessage>[4]) => {
    sendMessage(dispatch, state, thread, message, extra);
    onSent?.();
  };

  const resolve = (drift: DriftKind, reason: string) => {
    if (!pending) return;
    tag(pending.text, drift, reason);
    setPending(null);
  };

  const keepHere = () => {
    if (!pending) return;
    resolve('off-goal', `${pending.verdict.reason}. You chose Keep here`);
    // The agent stopped to ask, so it needs the answer; your own keeps instead teach the guard to go quiet.
    if (pending.isFromAgent) dispatch({ type: 'send', threadId: thread.id, text: 'Do it here.', reason: 'Do it here from the new-thread suggestion' });
    else dispatch({ type: 'drift-keep', threadId: thread.id });
  };

  // The message already went to the agent; what's left is saying what done now means, in the goal's own editor.
  const addToGoal = () => {
    resolve('scope-add', 'You chose Add to goal');
    openGoalEditor(thread.id);
  };

  const newThread = () => {
    if (!pending) return;
    const before = snapshot(state);
    const isGoalDone = isDone(thread);
    // GAP: undo restores the store, but the interrupted turn stays interrupted.
    if (thread.live?.isWorking) dispatch({ type: 'interrupt', threadId: thread.id });
    dispatch({ type: 'drift-new-thread', threadId: thread.id, prompt: pending.text, branchFrom });
    setPending(null);
    toast(isGoalDone ? `Settled "${thread.title}" and started a new thread` : 'Started a new thread', {
      duration: UNDO_MS,
      description: isGoalDone ? 'Its goal was done.' : undefined,
      action: {
        label: 'Undo',
        onClick: () => {
          dispatch({ type: 'restore', snapshot: before });
          dispatch({ type: 'go', view: { kind: 'thread', id: thread.id } });
        },
      },
    });
  };

  return { pending, branchFrom, setBranchFrom, submit, keepHere, addToGoal, newThread };
}

export type DriftGuard = ReturnType<typeof useDriftGuard>;

function isDone(thread: Thread) {
  return hasGoal(thread) && goalProgress(thread).phase === 'ready';
}

// Undo covers two changes at once, so it stays up longer than a plain toast.
const UNDO_MS = 8000;

/** The card's choice is Settings › Goals and checks's "Off-goal work branches from", so it sticks across threads. */
function useRememberedBranchFrom() {
  const { branchFrom } = usePrefs();
  return [branchFrom, (next: BranchFrom) => setPrefs({ branchFrom: next })] as const;
}

/**
 * A quiet suggestion above the composer for a message that already went out. It never takes focus or keys from the
 * composer; once you Tab into it, 1 2 3 pick the buttons in order and Esc keeps the message here (not for the agent's own suggestion).
 */
export function DriftCard({ guard, thread }: { guard: DriftGuard; thread: Thread }) {
  const { pending } = guard;
  const titleId = useId();

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (isMod(e) || isNav(e) || e.altKey) return;
    const run = ({ 1: guard.newThread, 2: guard.keepHere, ...(hasGoal(thread) && { 3: guard.addToGoal }), ...(!pending?.isFromAgent && { Escape: guard.keepHere }) } as Record<string, () => void>)[e.key];
    if (!run) return;
    e.preventDefault();
    run();
  };

  return (
    <AnimatePresence initial={false}>
      {pending && (
        <motion.section
          aria-labelledby={titleId}
          onKeyDown={onKeyDown}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, transition: { duration: 0.12 } }}
          transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
          className="group mb-2 flex flex-col gap-2 rounded-xl bg-popover p-3 shadow-popover"
        >
          <div className="flex items-start gap-2" role="status">
            <Compass aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <div className="flex min-w-0 flex-col gap-0.5">
              <p id={titleId} className="type-body">
                “{pending.text}” sounds like a separate task from <em className="font-medium not-italic">{thread.title}</em>.
              </p>
              <p className="type-caption text-subtle-foreground">
                {pending.verdict.reason}
                {isDone(thread) && '. The goal is done, so a new thread settles this one first.'}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Button variant="outline" size="sm" onClick={guard.newThread} aria-keyshortcuts="1">
              Move to new thread
              <CardShortcut keys={['1']} />
            </Button>
            {/* Esc sends nothing: Do it here messages the agent, too much for a dismiss key. */}
            <Button variant="ghost" size="sm" onClick={guard.keepHere} aria-keyshortcuts={pending.isFromAgent ? '2' : '2 Escape'}>
              {pending.isFromAgent ? 'Do it here' : 'Keep here'}
              <CardShortcut keys={['2']} />
            </Button>
            {hasGoal(thread) && (
              <Button variant="ghost" size="sm" onClick={guard.addToGoal} aria-keyshortcuts="3">
                Add to goal…
                <CardShortcut keys={['3']} />
              </Button>
            )}
            {!!thread.repo && (
              <ToggleGroup type="single" size="sm" variant="outline" value={guard.branchFrom} onValueChange={(v) => v && guard.setBranchFrom(v as BranchFrom)} aria-label="New thread branches from" className="ml-auto">
                <ToggleGroupItem value="current" className="max-w-40 type-caption">
                  <span className="truncate">from {thread.repo.branch}</span>
                </ToggleGroupItem>
                <ToggleGroupItem value="base" className="type-caption">
                  from base
                </ToggleGroupItem>
              </ToggleGroup>
            )}
          </div>
        </motion.section>
      )}
    </AnimatePresence>
  );
}

/** Key caps only while focus is in the card, the only time the keys work. */
function CardShortcut({ keys }: { keys: string[] }) {
  return <Shortcut keys={keys} className="-mr-1 hidden group-focus-within:inline-flex" />;
}
