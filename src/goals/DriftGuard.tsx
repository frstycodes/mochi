import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Compass } from 'reicon-react';
import { toast } from 'sonner';
import { usePromptInputController } from '@/components/ai-elements/prompt-input';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { driftThreshold, judgeDrift, type DriftKind, type DriftVerdict } from '../drift';
import type { AgentImage } from '../host/types/agent';
import type { Thread } from '../model';
import { progressAt } from '../progress';
import { setPrefs, usePrefs } from '../settings/prefs';
import { snapshot, useHarness } from '../store';

interface Pending {
  prompt: string;
  prefix: string;
  verdict: DriftVerdict;
  references?: References;
  /** A late model verdict on a message that already went out: the card offers to move it, not to hold it. */
  isSent?: boolean;
}

/** What the agent gets in place of the shown message, when the composer added referenced threads or windows. */
type References = { prompt: string; images: AgentImage[] };

type BranchFrom = 'current' | 'base';

/** Scores each message against the thread's goal. A clear local off-goal is held for the card; one that needs the model is sent first and judged after. `onSent` runs once a message actually goes. */
export function useDriftGuard(thread: Thread, onSent?: () => void) {
  const { state, dispatch } = useHarness();
  const { textInput, attachments } = usePromptInputController();
  const [pending, setPending] = useState<Pending | null>(null);
  const [branchFrom, setBranchFrom] = useRememberedBranchFrom();

  const send = (text: string, drift: DriftKind | undefined, reason: string, references?: References) => {
    dispatch({ type: 'send', threadId: thread.id, text, drift, reason, ...references });
    onSent?.();
  };
  const tag = (text: string, drift: DriftKind, reason: string) => dispatch({ type: 'drift-verdict', threadId: thread.id, text, drift, reason });
  const logEvent = (text: string, detail?: string) => dispatch({ type: 'say', threadId: thread.id, entry: { who: 'harness', kind: 'event', text, detail } });
  const close = () => {
    setPending(null);
    // A sent message already left the input, which may hold the next one by now.
    if (pending?.isSent) return;
    textInput.clear();
    attachments.clear();
  };

  const act = (prompt: string, prefix: string, verdict: DriftVerdict, references?: References) => {
    if (verdict.kind !== 'off-goal') {
      send(`${prefix}${prompt}`, verdict.kind, verdict.reason, references);
      return true;
    }
    setPending({ prompt, prefix, verdict, references });
    return false;
  };

  /** `false` keeps the text in the input. */
  const submit = (prompt: string, prefix = '', references?: References) => {
    if (pending?.prompt === prompt) {
      continueHere();
      return true;
    }
    if (thread.drift?.isMuted) return act(prompt, prefix, { kind: 'on-goal', reason: 'Drift guard off for this thread' }, references);
    const verdict = judgeDrift(prompt, thread);
    if (!(verdict instanceof Promise)) return act(prompt, prefix, verdict, references);
    const text = `${prefix}${prompt}`;
    send(text, undefined, 'Checking against the goal', references);
    verdict.then((v) => (v.kind === 'off-goal' ? setPending({ prompt, prefix, verdict: v, references, isSent: true }) : tag(text, v.kind, v.reason)));
    return true;
  };

  /** Sends a held message, or tags one already sent. */
  const resolve = (drift: DriftKind, reason: string) => {
    if (!pending) return;
    const text = `${pending.prefix}${pending.prompt}`;
    if (pending.isSent) tag(text, drift, reason);
    else send(text, drift, reason, pending.references);
    close();
  };

  const continueHere = () => pending && resolve('off-goal', `${pending.verdict.reason}. You chose ${pending.isSent ? 'Keep here' : 'Continue here'}`);

  const addToGoal = () => resolve('scope-add', 'You chose Add to goal');

  const newThread = () => {
    if (!pending) return;
    const before = snapshot(state);
    const isGoalDone = isDone(thread, state.now);
    // GAP: undo restores the store, but the interrupted turn stays interrupted.
    if (pending.isSent && thread.live?.isWorking) dispatch({ type: 'interrupt', threadId: thread.id });
    dispatch({ type: 'drift-new-thread', threadId: thread.id, prompt: pending.prompt, branchFrom });
    close();
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

  const dismiss = () => {
    if (!pending) return;
    if (pending.isSent) return continueHere();
    logEvent('Off-goal warning dismissed', `"${pending.prompt.slice(0, 40)}"`);
    setPending(null);
  };

  const mute = () => {
    dispatch({ type: 'drift-settings', threadId: thread.id, threshold: driftThreshold(thread), isMuted: true });
    logEvent('Drift guard off for this thread');
    continueHere();
  };

  return { pending, branchFrom, setBranchFrom, submit, continueHere, addToGoal, newThread, dismiss, mute };
}

export type DriftGuard = ReturnType<typeof useDriftGuard>;

function isDone(thread: Thread, now: number) {
  return thread.status === 'review' || progressAt(thread, now, true).pct >= 1;
}

// Undo covers two changes at once, so it stays up longer than a plain toast.
const UNDO_MS = 8000;

/** The card's choice is Settings › Goals and drift's "Off-goal work branches from", so it sticks across threads. */
function useRememberedBranchFrom() {
  const { branchFrom } = usePrefs();
  return [branchFrom, (next: BranchFrom) => setPrefs({ branchFrom: next })] as const;
}

/** Inline card above the composer. Enter in the composer again continues here; Esc dismisses. */
export function DriftCard({ guard, thread }: { guard: DriftGuard; thread: Thread }) {
  const { state } = useHarness();
  const { pending, dismiss } = guard;

  useEffect(() => {
    if (!pending) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && dismiss();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pending, dismiss]);

  return (
    <AnimatePresence initial={false}>
      {pending && (
        <motion.section
          aria-label="Off-goal message"
          role="status"
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, transition: { duration: 0.12 } }}
          transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
          className="mb-2 flex flex-col gap-2.5 rounded-xl bg-popover p-3 shadow-popover"
        >
          <div className="flex items-start gap-2">
            <Compass aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
            <div className="flex min-w-0 flex-col gap-0.5">
              <p className="type-body">
                {pending.isSent ? (
                  <>
                    Sent, but “{pending.prompt}” looks unrelated to <em className="font-medium not-italic">{thread.title}</em>.
                  </>
                ) : (
                  <>
                    This looks unrelated to <em className="font-medium not-italic">{thread.title}</em>.
                  </>
                )}
              </p>
              <p className="type-caption text-subtle-foreground">
                {pending.verdict.reason}
                {isDone(thread, state.now) && '. The goal is done, so New thread settles this one first.'}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={guard.newThread}>{pending.isSent ? 'Move to new thread' : 'New thread'}</Button>
            <Button variant="outline" onClick={guard.continueHere}>
              {pending.isSent ? 'Keep here' : 'Continue here'}
              {!pending.isSent && <Kbd className="-mr-1">Enter</Kbd>}
            </Button>
            <Button variant="ghost" onClick={guard.addToGoal}>
              Add to goal
            </Button>
            {!!thread.repo && (
              <ToggleGroup type="single" size="sm" variant="outline" value={guard.branchFrom} onValueChange={(v) => v && guard.setBranchFrom(v as BranchFrom)} aria-label="New thread branches from" className="ml-auto">
                <ToggleGroupItem value="current" className="max-w-40 font-mono type-caption">
                  <span className="truncate">from {thread.repo.branch}</span>
                </ToggleGroupItem>
                <ToggleGroupItem value="base" className="type-caption">
                  from base
                </ToggleGroupItem>
              </ToggleGroup>
            )}
          </div>
          <div className="flex items-center gap-2 type-caption text-subtle-foreground">
            <Button variant="ghost" size="xs" className="-ml-2 text-subtle-foreground" onClick={guard.mute}>
              Don't ask again for this thread
            </Button>
            <span className="ml-auto flex items-center gap-1">
              <Kbd>Esc</Kbd> to dismiss
            </span>
          </div>
        </motion.section>
      )}
    </AnimatePresence>
  );
}
