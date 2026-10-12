import { useState } from 'react';
import { History, Routing } from 'reicon-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useWorktreePath } from '../git/worktrees';
import type { Thread } from '../model';
import { clock } from '../progress';
import { useHarness } from '../store';
import { checkpointPhrase, type Checkpoint } from './checkpoints';
import { CompareForks } from './CompareForks';
import type { ForkPoint } from './fork';
import { HandoffDialog } from './HandoffDialog';
import { PROVIDER_NAME } from './handoff';
import { openRewind, useRewindRequest } from './requests';
import { useRewindActions } from './useRewindActions';

/** Hosts the rewind, fork, handoff and compare dialogs a thread's menus, step rows and timeline open. */
export function RewindLayer({ thread }: { thread: Thread }) {
  const request = useRewindRequest(thread.id);
  const close = () => openRewind(null);
  if (!request) return null;
  if (request.kind === 'rewind' && request.n !== undefined) return <RewindConfirm thread={thread} n={request.n} onClose={close} />;
  if (request.kind === 'rewind') return <PointDialog thread={thread} mode="rewind" onClose={close} />;
  if (request.kind === 'fork') return <PointDialog thread={thread} mode="fork" initial={request.point} onClose={close} />;
  if (request.kind === 'handoff') return <HandoffDialog thread={thread} stepId={request.stepId} onClose={close} />;
  return <CompareForks thread={thread} otherId={request.otherId} onClose={close} />;
}

function RewindConfirm({ thread, n, onClose }: { thread: Thread; n: number; onClose: () => void }) {
  const { state } = useHarness();
  const { rewind } = useRewindActions();
  const cwd = useWorktreePath(thread.id);
  const checkpoint = state.checkpoints[thread.id]?.find((c) => c.n === n);
  if (!checkpoint) return null;
  const later = thread.activity.filter((a) => a.at > checkpoint.at && a.kind === 'message').length;
  const reopened = thread.steps.filter((s) => s.status === 'done' && checkpoint.thread.steps.find((c) => c.id === s.id)?.status !== 'done').length;
  const hasFiles = !!checkpoint.ref && !!cwd;

  return (
    <AlertDialog open onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Rewind to {checkpointPhrase(checkpoint)}?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="flex flex-col gap-2">
              <p>
                Steps, messages and the goal go back to <span className="tabular">{clock(checkpoint.at)}</span>. {countLabel(later, 'message')} after it leave the transcript and{' '}
                {countLabel(reopened, 'finished step')} reopen.
              </p>
              <p>{hasFiles ? 'Files in the worktree go back to that moment too. Your current files are saved first, so Undo brings them back.' : filesNote(cwd, checkpoint)}</p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep going</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={() => void rewind(thread, n)}>
            <History data-icon="inline-start" />
            Rewind
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

const PLURAL = new Intl.PluralRules('en');

function countLabel(count: number, noun: string) {
  return `${count} ${noun}${PLURAL.select(count) === 'one' ? '' : 's'}`;
}

function filesNote(cwd: string | undefined, checkpoint: Checkpoint) {
  if (!cwd) return 'Files stay as they are: this thread works in the project folder, not a worktree of its own, so only the transcript rewinds.';
  if (checkpoint.wantsFiles) return 'Files stay as they are: this checkpoint’s files are still being saved.';
  return 'Files stay as they are: this checkpoint is from before the thread had a worktree.';
}

/** Picks a checkpoint to rewind to, or a checkpoint or message to fork from. */
function PointDialog({ thread, mode, initial, onClose }: { thread: Thread; mode: 'rewind' | 'fork'; initial?: ForkPoint; onClose: () => void }) {
  const { state, dispatch } = useHarness();
  const checkpoints = [...(state.checkpoints[thread.id] ?? [])].reverse();
  const messages = mode === 'fork' ? thread.activity.flatMap((a, index) => (a.kind === 'message' ? [{ entry: a, index }] : [])).reverse() : [];
  const [value, setValue] = useState(pointValue(initial ?? { kind: 'checkpoint', n: checkpoints[0]?.n ?? 0 }));
  const isFork = mode === 'fork';

  const submit = () => {
    const point = parsePoint(value);
    onClose();
    if (point.kind === 'checkpoint' && !isFork) return openRewind({ kind: 'rewind', threadId: thread.id, n: point.n });
    dispatch({ type: 'fork', threadId: thread.id, point });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isFork ? 'Fork thread' : 'Rewind thread'}</DialogTitle>
          <DialogDescription>
            {isFork
              ? 'The fork gets its own worktree and branch, carrying the goal, steps and messages up to the point you pick. Compare both later and keep one.'
              : 'Pick a step boundary. You confirm before anything changes, and one undo is kept.'}
          </DialogDescription>
        </DialogHeader>
        <div className="-mx-4 max-h-80 overflow-y-auto overscroll-contain">
          <RadioGroup value={value} onValueChange={setValue} className="flex flex-col gap-3 px-4">
            <PointGroup title="Checkpoints">
              {checkpoints.map((c) => (
                <PointOption key={c.n} value={pointValue({ kind: 'checkpoint', n: c.n })} at={c.at}>
                  <span className="min-w-0 truncate">{c.label}</span>
                  {!!c.ref && <Badge variant="outline">Files saved</Badge>}
                </PointOption>
              ))}
            </PointGroup>
            {messages.length > 0 && (
              <PointGroup title="Messages">
                {messages.map(({ entry, index }) => (
                  <PointOption key={index} value={pointValue({ kind: 'message', index })} at={entry.at}>
                    <span className="shrink-0 text-subtle-foreground">{entry.who === 'you' ? 'You' : entry.who === 'harness' ? 'Mochi' : PROVIDER_NAME[entry.who]}</span>
                    <span className="min-w-0 truncate">{entry.text.split('\n')[0]}</span>
                  </PointOption>
                ))}
              </PointGroup>
            )}
          </RadioGroup>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit}>
            {isFork ? <Routing data-icon="inline-start" /> : <History data-icon="inline-start" />}
            {isFork ? 'Fork thread' : 'Review rewind'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PointGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-0.5">
      <h3 className="px-1 pb-0.5 type-meta text-subtle-foreground">{title}</h3>
      {children}
    </section>
  );
}

function PointOption({ value, at, children }: { value: string; at: number; children: React.ReactNode }) {
  return (
    <Label className="flex min-w-0 cursor-pointer items-center gap-2 rounded-md px-1 py-1 font-normal hover:bg-accent/60 has-data-checked:bg-accent">
      <RadioGroupItem value={value} />
      <span className="flex min-w-0 flex-1 items-center gap-1.5">{children}</span>
      <span className="tabular shrink-0 type-caption text-subtle-foreground">{clock(at)}</span>
    </Label>
  );
}

function pointValue(point: ForkPoint) {
  return point.kind === 'checkpoint' ? `c:${point.n}` : `m:${point.index}`;
}

function parsePoint(value: string): ForkPoint {
  const n = Number(value.slice(2));
  return value.startsWith('c:') ? { kind: 'checkpoint', n } : { kind: 'message', index: n };
}
