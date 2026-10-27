import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { FileIcon } from '@react-symbols/icons/utils';
import { Warning, History, Stop } from '@/icons';
import { ForkIcon } from '../ui';
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { plural } from '@mochi/domain/lib/format';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { FilePath } from '../files/FileView';
import { host } from '../host';
import { usePrefs } from '../settings/prefs';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useWorktreePath } from '../git/worktrees';
import type { Thread } from '../model';
import { clock } from '../progress';
import { useHarness } from '../store';
import {
  checkpointForMessage,
  checkpointPhrase,
  excerpt,
  rewindBlockedReason,
  STOP_TO_REWIND,
  threadAt,
  type Checkpoint,
  type RewindMode,
} from './checkpoints';
import { REWIND_MODE_ORDER, REWIND_MODES } from './modes';
import { CompareForks } from './CompareForks';
import type { ForkPoint } from './fork';
import { PROVIDER_NAME } from './handoff';
import { openRewind, useRewindRequest } from './requests';
import { useRewindActions, type RewindTarget } from './useRewindActions';
import { queryKeys } from '../queryKeys';

/** Hosts the rewind, fork and compare dialogs a thread's menus, step rows and timeline open. */
export function RewindLayer({ thread }: { thread: Thread }) {
  const request = useRewindRequest(thread.id);
  const close = () => openRewind(null);
  if (!request) return null;
  if (request.kind === 'rewind' && request.n !== undefined)
    return (
      <RewindConfirm
        thread={thread}
        target={{ kind: 'checkpoint', n: request.n }}
        initialMode={request.mode}
        onClose={close}
      />
    );
  if (request.kind === 'rewind' && request.message !== undefined)
    return (
      <RewindConfirm
        thread={thread}
        target={{ kind: 'message', index: request.message }}
        initialMode={request.mode}
        onClose={close}
      />
    );
  if (request.kind === 'rewind')
    return <PointDialog thread={thread} mode="rewind" onClose={close} />;
  if (request.kind === 'fork')
    return (
      <PointDialog
        thread={thread}
        mode="fork"
        initial={request.point}
        onClose={close}
      />
    );
  return (
    <CompareForks thread={thread} otherId={request.otherId} onClose={close} />
  );
}

function RewindConfirm({
  thread,
  target,
  initialMode,
  onClose,
}: {
  thread: Thread;
  target: RewindTarget;
  initialMode?: RewindMode;
  onClose: () => void;
}) {
  const { state, dispatch } = useHarness();
  const { rewindMode } = usePrefs();
  const { rewind } = useRewindActions();
  const cwd = useWorktreePath(thread.id);
  const checkpoint =
    target.kind === 'message'
      ? checkpointForMessage(state, thread.id, target.index)
      : state.checkpoints[thread.id]?.find((c) => c.n === target.n);
  const canRewindFiles = !!checkpoint?.ref && !!cwd;
  const [mode, setMode] = useState<RewindMode>(
    canRewindFiles ? (initialMode ?? rewindMode) : 'chat',
  );
  const [canOverwrite, setCanOverwrite] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const blockedReason = rewindBlockedReason(thread);
  const preview = useRewindPreview(
    cwd,
    thread.id,
    mode === 'files' && canRewindFiles ? checkpoint.n : undefined,
    !!blockedReason,
  );
  const didSubmit = useRef(false);
  const submit = () => {
    if (didSubmit.current) return;
    didSubmit.current = true;
    onClose();
    void rewind(thread, target, mode);
  };
  const stop = () => {
    setIsStopping(true);
    dispatch({ type: 'interrupt', threadId: thread.id });
  };
  // Stop and rewind: the rewind runs once the interrupted turn has ended.
  useEffect(() => {
    if (isStopping && !blockedReason) submit();
  });
  if (!checkpoint) return null;

  const entry =
    target.kind === 'message' ? thread.activity[target.index] : undefined;
  const kept = entry ? threadAt(thread, entry.at - 0.001) : checkpoint.thread;
  const keptLength =
    target.kind === 'message'
      ? target.index
      : checkpoint.thread.activity.length;
  const later = thread.activity
    .slice(keptLength)
    .filter((a) => a.kind === 'message').length;
  const reopened = thread.steps.filter(
    (s) =>
      s.status === 'done' &&
      kept.steps.find((c) => c.id === s.id)?.status !== 'done',
  ).length;
  const phrase = entry
    ? `before "${excerpt(entry.text)}"`
    : checkpointPhrase(checkpoint);
  const outside = preview.data?.outside ?? [];
  const isFilesReady =
    mode === 'chat' ||
    (!!preview.data && (outside.length === 0 || canOverwrite));
  const disabledReason =
    blockedReason ??
    (mode === 'files' && !isFilesReady
      ? preview.data
        ? 'Confirm overwriting the changes made outside the agent first'
        : 'Reading which files change'
      : undefined);

  return (
    <AlertDialog open onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent className="sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>Rewind to {phrase}?</AlertDialogTitle>
          <AlertDialogDescription>
            Steps, messages and the goal go back to{' '}
            <span className="tabular">
              {clock(kept === checkpoint.thread ? checkpoint.at : entry!.at)}
            </span>
            . {countLabel(later, 'message')} leave the transcript and{' '}
            {countLabel(reopened, 'finished step')} reopen. Undo brings it all
            back.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {!!blockedReason && (
          <WorkingNotice
            canStop={!!thread.live}
            isStopping={isStopping}
            onStop={stop}
          />
        )}
        <RadioGroup
          value={mode}
          onValueChange={(value) => setMode(value as RewindMode)}
          className="gap-0.5"
        >
          {REWIND_MODE_ORDER.map((m) => (
            <ModeOption
              key={m}
              mode={m}
              disabledReason={
                m === 'files' && !canRewindFiles
                  ? filesNote(cwd, checkpoint)
                  : undefined
              }
            />
          ))}
        </RadioGroup>
        {mode === 'files' && (
          <FilesPreview
            preview={preview}
            canOverwrite={canOverwrite}
            onCanOverwrite={setCanOverwrite}
          />
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>Keep going</AlertDialogCancel>
          <DisabledTooltip reason={disabledReason}>
            <Button disabled={!!disabledReason} onClick={submit}>
              <History data-icon="inline-start" />
              {REWIND_MODES[mode].label}
            </Button>
          </DisabledTooltip>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** While the agent works nothing rewinds; this stops its turn and lets the rewind run when it has ended. */
function WorkingNotice({
  canStop,
  isStopping,
  onStop,
}: {
  canStop: boolean;
  isStopping: boolean;
  onStop: () => void;
}) {
  return (
    <Alert>
      <Stop aria-hidden />
      <AlertTitle>
        {isStopping ? 'Stopping the agent…' : STOP_TO_REWIND}
      </AlertTitle>
      <AlertDescription>
        {isStopping
          ? 'The rewind runs as soon as its turn ends.'
          : 'Rewinding while it works would race its edits.'}
      </AlertDescription>
      {canStop && (
        <AlertAction>
          <Button
            size="sm"
            variant="outline"
            disabled={isStopping}
            onClick={onStop}
          >
            {isStopping ? 'Stopping…' : 'Stop and rewind'}
          </Button>
        </AlertAction>
      )}
    </Alert>
  );
}

function ModeOption({
  mode,
  disabledReason,
}: {
  mode: RewindMode;
  disabledReason?: string;
}) {
  const { label, hint, icon: Icon } = REWIND_MODES[mode];
  return (
    <Label className="flex min-w-0 cursor-pointer items-start gap-2 rounded-md px-1.5 py-1.5 font-normal hover:bg-accent/60 has-data-checked:bg-accent has-data-disabled:cursor-default has-data-disabled:opacity-50 has-data-disabled:hover:bg-transparent">
      <RadioGroupItem
        value={mode}
        disabled={!!disabledReason}
        className="mt-0.5"
      />
      <Icon
        aria-hidden
        className="mt-0.5 size-4 shrink-0 text-muted-foreground"
      />
      <span className="flex min-w-0 flex-col">
        {label}
        <span className="type-caption text-pretty text-muted-foreground">
          {disabledReason ?? hint}
        </span>
      </span>
    </Label>
  );
}

function FilesPreview({
  preview,
  canOverwrite,
  onCanOverwrite,
}: {
  preview: ReturnType<typeof useRewindPreview>;
  canOverwrite: boolean;
  onCanOverwrite: (on: boolean) => void;
}) {
  if (preview.error)
    return (
      <p className="type-meta text-destructive">
        Could not read which files change: {preview.error}
      </p>
    );
  if (!preview.data) return <Skeleton className="h-16 rounded-lg" />;
  const { files, outside } = preview.data;
  return (
    <div className="flex flex-col gap-2">
      {files.length === 0 ? (
        <p className="type-meta text-muted-foreground">
          No files change: the worktree already matches that moment.
        </p>
      ) : (
        <FileList
          title={`${countLabel(files.length, 'file')} ${plural(files.length, 'goes', 'go')} back`}
          paths={files}
        />
      )}
      {outside.length > 0 && (
        <Alert>
          <Warning aria-hidden className="text-warning" />
          <AlertTitle>
            {countLabel(outside.length, 'file')} changed outside the agent
          </AlertTitle>
          <AlertDescription className="flex flex-col gap-2">
            <span>
              Changed since its last turn ended, by you or another program.
              Rewinding overwrites them; Undo brings them back.
            </span>
            <FileList paths={outside} />
            <Label className="flex items-center gap-2 font-normal text-foreground">
              <Checkbox
                checked={canOverwrite}
                onCheckedChange={(on) => onCanOverwrite(on === true)}
              />
              Overwrite these changes
            </Label>
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}

export function FileList({
  title,
  paths,
}: {
  title?: string;
  paths: string[];
}) {
  return (
    <section className="flex flex-col gap-1">
      {!!title && <h3 className="type-meta text-muted-foreground">{title}</h3>}
      <ul className="max-h-36 overflow-y-auto overscroll-contain rounded-lg bg-muted/40 py-1">
        {paths.map((path) => (
          <li
            key={path}
            className="flex min-w-0 items-center gap-1.5 px-2 py-0.5"
          >
            <FileIcon
              fileName={path.split('/').pop() ?? path}
              autoAssign
              aria-hidden
              className="size-3.5 shrink-0"
            />
            <FilePath path={path} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** A disabled control can't hold a tooltip itself, so the wrapper carries the reason. */
export function DisabledTooltip({
  reason,
  children,
}: {
  reason?: string;
  children: React.ReactElement;
}) {
  if (!reason) return children;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">{children}</span>
      </TooltipTrigger>
      <TooltipContent>{reason}</TooltipContent>
    </Tooltip>
  );
}

/** The files a files rewind would change, re-read while the agent works (its edits move the answer). */
function useRewindPreview(
  cwd: string | undefined,
  threadId: string,
  n: number | undefined,
  isWorking: boolean,
) {
  const previewQuery = useQuery({
    queryKey: queryKeys.git.rewindPreview(cwd, threadId, n, isWorking),
    queryFn: () => host.git.rewindPreview(cwd!, threadId, n!),
    enabled: !!cwd && n !== undefined,
  });
  return { data: previewQuery.data, error: previewQuery.error?.message };
}

export function countLabel(count: number, noun: string) {
  return `${count} ${noun}${plural(count, '', 's')}`;
}

function filesNote(cwd: string | undefined, checkpoint: Checkpoint) {
  if (!cwd)
    return 'Files stay as they are: this thread works in the project folder, not a worktree of its own, so only the transcript rewinds.';
  if (checkpoint.wantsFiles)
    return 'Files stay as they are: this checkpoint’s files are still being saved.';
  return 'Files stay as they are: this checkpoint is from before the thread had a worktree.';
}

/** Picks a checkpoint to rewind to, or a checkpoint or message to fork from. */
function PointDialog({
  thread,
  mode,
  initial,
  onClose,
}: {
  thread: Thread;
  mode: 'rewind' | 'fork';
  initial?: ForkPoint;
  onClose: () => void;
}) {
  const { state, dispatch } = useHarness();
  const checkpoints = [...(state.checkpoints[thread.id] ?? [])].reverse();
  const messages =
    mode === 'fork'
      ? thread.activity
          .flatMap((a, index) =>
            a.kind === 'message' ? [{ entry: a, index }] : [],
          )
          .reverse()
      : [];
  const [value, setValue] = useState(
    pointValue(initial ?? { kind: 'checkpoint', n: checkpoints[0]?.n ?? 0 }),
  );
  const isFork = mode === 'fork';

  const submit = () => {
    const point = parsePoint(value);
    onClose();
    if (point.kind === 'checkpoint' && !isFork)
      return openRewind({ kind: 'rewind', threadId: thread.id, n: point.n });
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
          <RadioGroup
            value={value}
            onValueChange={setValue}
            className="flex flex-col gap-3 px-4"
          >
            <PointGroup title="Checkpoints">
              {checkpoints.map((c) => (
                <PointOption
                  key={c.n}
                  value={pointValue({ kind: 'checkpoint', n: c.n })}
                  at={c.at}
                >
                  <span className="min-w-0 truncate">{c.label}</span>
                  {!!c.ref && <Badge variant="outline">Files saved</Badge>}
                </PointOption>
              ))}
            </PointGroup>
            {messages.length > 0 && (
              <PointGroup title="Messages">
                {messages.map(({ entry, index }) => (
                  <PointOption
                    key={index}
                    value={pointValue({ kind: 'message', index })}
                    at={entry.at}
                  >
                    <span className="shrink-0 text-subtle-foreground">
                      {entry.who === 'you'
                        ? 'You'
                        : entry.who === 'harness'
                          ? 'Mochi'
                          : PROVIDER_NAME[entry.who]}
                    </span>
                    <span className="min-w-0 truncate">
                      {entry.text.split('\n')[0]}
                    </span>
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
            {isFork ? (
              <ForkIcon data-icon="inline-start" />
            ) : (
              <History data-icon="inline-start" />
            )}
            {isFork ? 'Fork thread' : 'Review rewind'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PointGroup({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-0.5">
      <h3 className="px-1 pb-0.5 type-meta text-subtle-foreground">{title}</h3>
      {children}
    </section>
  );
}

function PointOption({
  value,
  at,
  children,
}: {
  value: string;
  at: number;
  children: React.ReactNode;
}) {
  return (
    <Label className="flex min-w-0 cursor-pointer items-center gap-2 rounded-md px-1 py-1 font-normal hover:bg-accent/60 has-data-checked:bg-accent">
      <RadioGroupItem value={value} />
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        {children}
      </span>
      <span className="tabular shrink-0 type-caption text-subtle-foreground">
        {clock(at)}
      </span>
    </Label>
  );
}

function pointValue(point: ForkPoint) {
  return point.kind === 'checkpoint' ? `c:${point.n}` : `m:${point.index}`;
}

function parsePoint(value: string): ForkPoint {
  const n = Number(value.slice(2));
  return value.startsWith('c:')
    ? { kind: 'checkpoint', n }
    : { kind: 'message', index: n };
}
