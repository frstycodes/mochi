import {
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type FormEvent,
} from 'react';
import { useConfirm } from '../git/useConfirm';
import { ArrowUp, Copy, Undo, Stop, Trash, X } from '@/icons';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { ChatView, type MessageBar } from '../ChatView';
import { copyText } from '../clipboard';
import { cn } from '@/lib/utils';
import { PANE_TABS } from '../pane/tabs';
import { rewindBlockedReason, type RewindMode } from '../rewind/checkpoints';
import { REWIND_MODE_ORDER, REWIND_MODES } from '../rewind/modes';
import { ComposerCard } from '../Composer';
import type { FollowedMachine, Scope } from '../host/types/remote';
import {
  PreviewContext,
  SplitContext,
  type SplitInfo,
} from '../layout/SplitContext';
import type { Thread } from '../model';
import { QueueDecision } from '../QueueView';
import { useHarness, useView } from '../store';
import { TitleBar } from '../TitleBar';
import { ForkIcon, OverflowIcon, TooltipIconButton } from '../ui';
import { DeviceIcon } from './DeviceIcon';
import {
  goBack,
  goHome,
  useEscapeBack,
  useRemoteThreadRoute,
} from '../routes/nav';
import { remoteDecisions } from './mirror';
import { MachinePresence } from './MachinePresence';
import { REMOTE_PANES, RemotePane, type RemotePaneKind } from './RemotePanes';
import { machineStatus } from './status';
import { RemoteScope, useMachines } from './useMachines';
import { Seen } from '../notify/useSeen';
import { RemoteFilesContext } from '../files/useWorktreeFiles';
import type { FileTarget } from '../files/FileFinder';
import type { Action, State } from '../store';

/** Another computer's thread over the app: its transcript as that computer streams it, steered by commands sent there. */
export function RemoteThreadView() {
  const route = useRemoteThreadRoute()!;
  const followed = useMachines().machines.find(
    (m) => m.machine.id === route.machineId,
  );
  const thread = followed?.state?.threads.find((t) => t.id === route.threadId);
  useCloseOnLeave();
  if (!followed)
    return (
      <Missing
        title="Not paired anymore"
        description="This computer no longer follows the one this thread runs on."
      />
    );
  if (!followed.state)
    return (
      <Missing
        machine={followed.machine}
        title={
          followed.machine.status === 'connecting'
            ? `Connecting to ${followed.machine.name}…`
            : `${followed.machine.name} is offline`
        }
        description={
          machineStatus(followed.machine) ??
          'Its threads show here once it sends them.'
        }
        isLoading={followed.machine.status === 'connecting'}
      />
    );
  if (!thread)
    return (
      <Missing
        machine={followed.machine}
        title="This thread is gone"
        description={`It isn’t on ${followed.machine.name} anymore.`}
      />
    );
  return (
    <RemoteThread
      machine={followed.machine}
      state={followed.state}
      thread={thread}
    />
  );
}

/** The chat column, and beside it the panes you opened, each reading from that computer, stacked like the machine's own. */
function RemoteThread({
  machine,
  state,
  thread,
}: {
  machine: FollowedMachine;
  state: State;
  thread: Thread;
}) {
  const [panes, setPanes] = useState<RemotePaneKind[]>([]);
  const open = (kind: RemotePaneKind) =>
    setPanes((all) => (all.includes(kind) ? all : [...all, kind]));
  const toggle = (kind: RemotePaneKind) =>
    setPanes((all) =>
      all.includes(kind) ? all.filter((k) => k !== kind) : [...all, kind],
    );
  const [file, setFile] = useState<FileTarget>();
  const files = useRemoteFileSet(machine, thread);
  // A link in the transcript: a file opens in the Files pane here, a web page in your browser.
  const openTab = (action: Extract<Action, { type: 'pane-open-tab' }>) => {
    if (action.kind === 'files' && action.file && can(machine, 'code')) {
      setFile(action.file);
      return open('files');
    }
    if (action.url) window.open(action.url, '_blank', 'noreferrer');
  };
  return (
    <RemoteScope machine={machine} state={state} onOpenTab={openTab}>
      <Seen threadId={thread.id} when="open-and-leave" />
      <RemoteFilesContext.Provider value={files}>
        <div className="flex h-full min-h-0">
          <div className="@container flex min-h-0 min-w-[420px] flex-1 flex-col">
            <RemoteHeader
              machine={machine}
              thread={thread}
              panes={panes}
              onPane={toggle}
            />
            <SplitContext.Provider value={SPLIT}>
              {/* Read-only, so nothing in it acts on this computer: links and the message bar act on that one. */}
              <PreviewContext.Provider value>
                <ChatView
                  thread={thread}
                  isReadOnly
                  messageBar={RemoteMessageBar}
                />
              </PreviewContext.Provider>
            </SplitContext.Provider>
            <RemoteComposer machine={machine} thread={thread} />
          </div>
          {panes.length > 0 && (
            <div className="flex w-[45%] max-w-[720px] min-w-[320px] flex-col gap-2 py-2 pr-2">
              {panes.map((kind) => (
                <RemotePane
                  key={kind}
                  kind={kind}
                  machine={machine}
                  thread={thread}
                  file={file}
                  onClose={() => toggle(kind)}
                />
              ))}
            </div>
          )}
        </div>
      </RemoteFilesContext.Provider>
    </RemoteScope>
  );
}

/** The thread's files on that computer, read once when it opens with `code`, so paths in its transcript become links. */
function useRemoteFileSet(machine: FollowedMachine, thread: Thread) {
  const { ask } = useMachines();
  const [files, setFiles] = useState<ReadonlySet<string> | null>(null);
  const canRead = can(machine, 'code') && (!!thread.repo || !!thread.live?.cwd);
  useEffect(() => {
    if (!canRead) return;
    let isCurrent = true;
    ask(machine.id, { type: 'files', threadId: thread.id }).then(
      (list) => isCurrent && setFiles(new Set(list.paths)),
      () => {},
    );
    return () => {
      isCurrent = false;
    };
  }, [ask, machine.id, thread.id, canRead]);
  return files;
}

const SPLIT: SplitInfo = {
  leafId: 'remote',
  isFocused: true,
  isMulti: false,
  isZoomed: false,
  isFirst: true,
  isWide: true,
};

/** Esc, or going anywhere in this computer's own layout, closes it. */
function useCloseOnLeave() {
  const view = useView();
  const opened = useRef(view);
  useEffect(() => {
    if (view !== opened.current) goHome();
  }, [view]);
  useEscapeBack();
}

const can = (machine: FollowedMachine, scope: Scope) =>
  machine.status === 'online' && machine.scopes.includes(scope);

function RemoteHeader({
  machine,
  thread,
  panes,
  onPane,
}: {
  machine: FollowedMachine;
  thread: Thread;
  panes: RemotePaneKind[];
  onPane: (kind: RemotePaneKind) => void;
}) {
  const { run } = useMachines();
  const [shipping, setShipping] = useState<'commit' | 'open-pr' | null>(null);
  const { confirm, dialog } = useConfirm();
  const deleteThread = async () => {
    const isConfirmed = await confirm({
      title: `Delete “${thread.title}”?`,
      description: `Stops its agent on ${machine.name} and removes its history there. Its files stay on disk. This can’t be undone.`,
      confirm: 'Delete thread',
      cancel: 'Keep thread',
      isDestructive: true,
    });
    if (!isConfirmed) return;
    const result = await run(machine.id, {
      type: 'delete',
      threadId: thread.id,
    });
    if (result.isOk) goBack();
  };
  const hasFolder = !!thread.repo || !!thread.live?.cwd;
  const isSettled = thread.status === 'settled';
  const canManage = can(machine, 'manage');
  return (
    <TitleBar>
      <DeviceIndicator machine={machine} />
      <span className="min-w-0 truncate type-title">{thread.title}</span>
      <MachinePresence machine={machine} />
      <span className="flex-1" />
      {!!thread.live?.isWorking && (
        <Button
          variant="outline"
          size="sm"
          className="rounded-full"
          disabled={!can(machine, 'operate')}
          onClick={() =>
            void run(machine.id, { type: 'interrupt', threadId: thread.id })
          }
        >
          <Stop data-icon="inline-start" />
          Stop
        </Button>
      )}
      <span className="hidden items-center gap-0.5 @md:flex">
        {PANE_KINDS.filter(
          (kind) => hasFolder || !REMOTE_PANES[kind].needsFolder,
        ).map((kind) => (
          <PaneToggle
            key={kind}
            kind={kind}
            machine={machine}
            isOpen={panes.includes(kind)}
            onToggle={() => onPane(kind)}
          />
        ))}
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="Thread actions">
            <OverflowIcon vertical />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            disabled={!canManage}
            onSelect={() =>
              void run(machine.id, {
                type: 'settle',
                threadId: thread.id,
                isSettled: !isSettled,
              })
            }
          >
            {isSettled ? 'Reactivate' : 'Settle'}
          </DropdownMenuItem>
          {!isSettled && (
            <DropdownMenuItem
              disabled={!canManage}
              onSelect={() =>
                void run(machine.id, {
                  type: 'pin',
                  threadId: thread.id,
                  isPinned: thread.orbitSlot === undefined,
                })
              }
            >
              {thread.orbitSlot === undefined ? 'Pin' : 'Unpin'}
            </DropdownMenuItem>
          )}
          {!!thread.repo && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={!canManage}
                onSelect={() => setShipping('commit')}
              >
                Commit…
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!canManage}
                onSelect={() =>
                  void run(machine.id, { type: 'push', threadId: thread.id })
                }
              >
                Push
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!canManage}
                onSelect={() => setShipping('open-pr')}
              >
                Open pull request…
              </DropdownMenuItem>
            </>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            disabled={!canManage}
            onSelect={() => void deleteThread()}
          >
            <Trash />
            Delete thread…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <TooltipIconButton
        label="Close"
        hint="Back to this computer’s threads (Esc)"
        onClick={goBack}
      >
        <X />
      </TooltipIconButton>
      <ShipDialog
        kind={shipping}
        machine={machine}
        thread={thread}
        onClose={() => setShipping(null)}
      />
      {dialog}
    </TitleBar>
  );
}

const PANE_KINDS = Object.keys(REMOTE_PANES) as RemotePaneKind[];

function PaneToggle({
  kind,
  machine,
  isOpen,
  onToggle,
}: {
  kind: RemotePaneKind;
  machine: FollowedMachine;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const { title, icon: Icon } = PANE_TABS[kind];
  const { scope } = REMOTE_PANES[kind];
  const canOpen = machine.scopes.includes(scope);
  return (
    <TooltipIconButton
      label={title}
      hint={
        canOpen
          ? `Reads from ${machine.name}`
          : `${machine.name} hasn’t given this computer the ${scope} scope`
      }
      aria-pressed={isOpen}
      disabled={!canOpen && !isOpen}
      onClick={onToggle}
      className="text-muted-foreground aria-pressed:bg-accent aria-pressed:text-foreground"
    >
      <Icon />
    </TooltipIconButton>
  );
}

/** Under each message: copy, and rewind or fork run on that computer. A files rewind asks here, without the file list the machine shows. */
function RemoteMessageBar({
  thread,
  index,
  align,
}: ComponentProps<MessageBar>) {
  const { run, machines } = useMachines();
  const machineId = useRemoteThreadRoute()?.machineId;
  const machine = machines.find((m) => m.machine.id === machineId)?.machine;
  const { confirm, dialog } = useConfirm();
  const entry = thread.activity[index];
  if (!entry || !machine) return null;
  const canOperate = can(machine, 'operate');
  const blocked =
    rewindBlockedReason(thread) ??
    (canOperate
      ? undefined
      : `${machine.name} is offline or lets this computer read only`);
  const rewind = (mode: RewindMode) =>
    void run(machine.id, {
      type: 'rewind',
      threadId: thread.id,
      point: { kind: 'message', index },
      mode,
    });
  const rewindFiles = async () => {
    const isConfirmed = await confirm({
      title: `Rewind chat and files on ${machine.name}?`,
      description: `The worktree goes back to just before this message, including edits made outside the agent since. Undo on ${machine.name} brings it back.`,
      confirm: 'Rewind chat and files',
      cancel: 'Keep files',
    });
    if (isConfirmed) rewind('files');
  };
  return (
    <div
      role="toolbar"
      aria-label="Message actions"
      className={cn(
        'flex items-center gap-0.5 opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-within/row:opacity-100',
        align === 'end' && 'justify-end',
      )}
    >
      <TooltipIconButton
        label="Copy"
        onClick={() => copyText(entry.text, 'Copied')}
        className={BAR_BUTTON}
      >
        <Copy />
      </TooltipIconButton>
      {entry.who === 'you' && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild disabled={!!blocked}>
            <TooltipIconButton
              label="Rewind to here"
              hint={
                blocked ??
                `Back to just before this message, on ${machine.name}`
              }
              disabled={!!blocked}
              className={BAR_BUTTON}
            >
              <Undo />
            </TooltipIconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            {REWIND_MODE_ORDER.map((mode) => {
              const { label, hint, icon: Icon } = REWIND_MODES[mode];
              return (
                <DropdownMenuItem
                  key={mode}
                  className="items-start"
                  onSelect={() =>
                    mode === 'files' ? void rewindFiles() : rewind(mode)
                  }
                >
                  <Icon className="mt-0.5" />
                  <span className="flex min-w-0 flex-col">
                    {label}
                    <span className="type-caption text-pretty text-muted-foreground">
                      {mode === 'files'
                        ? `Files in ${machine.name}’s worktree go back too.`
                        : hint}
                    </span>
                  </span>
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <TooltipIconButton
        label="Fork from here"
        hint={
          canOperate
            ? `A new thread on ${machine.name} with everything up to this message`
            : blocked
        }
        disabled={!canOperate}
        onClick={() =>
          void run(machine.id, {
            type: 'fork',
            threadId: thread.id,
            point: { kind: 'message', index },
          })
        }
        className={BAR_BUTTON}
      >
        <ForkIcon />
      </TooltipIconButton>
      {dialog}
    </div>
  );
}

const BAR_BUTTON =
  'size-6 text-subtle-foreground hover:text-foreground [&_svg]:size-3.5';

/** A commit message, or a pull request's title and body, written here and sent to the machine that owns the worktree. */
function ShipDialog({
  kind,
  machine,
  thread,
  onClose,
}: {
  kind: 'commit' | 'open-pr' | null;
  machine: FollowedMachine;
  thread: Thread;
  onClose: () => void;
}) {
  const { run } = useMachines();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [isSending, setIsSending] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setIsSending(true);
    const result = await run(
      machine.id,
      kind === 'commit'
        ? { type: 'commit', threadId: thread.id, message: title }
        : { type: 'open-pr', threadId: thread.id, title, body },
    );
    setIsSending(false);
    if (!result.isOk) return;
    setTitle('');
    setBody('');
    onClose();
  };
  return (
    <Dialog open={!!kind} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>
              {kind === 'commit' ? 'Commit' : 'Open a pull request'}
            </DialogTitle>
            <DialogDescription>
              {kind === 'commit'
                ? `Commits everything changed in this thread’s folder on ${machine.name}.`
                : `Pushes the branch and opens the pull request from ${machine.name}.`}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="remote-ship-title">
              {kind === 'commit' ? 'Message' : 'Title'}
            </Label>
            <Input
              id="remote-ship-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              autoFocus
            />
          </div>
          {kind === 'open-pr' && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="remote-ship-body">Description</Label>
              <Textarea
                id="remote-ship-body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={5}
              />
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!title.trim() || isSending}>
              {isSending && <Spinner data-icon="inline-start" />}
              {kind === 'commit' ? 'Commit' : 'Open pull request'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** The thread's questions and approvals, then a message box. Nothing waits to send later: offline, it stays in the box. */
function RemoteComposer({
  machine,
  thread,
}: {
  machine: FollowedMachine;
  thread: Thread;
}) {
  const { state } = useHarness();
  const { run } = useMachines();
  const [text, setText] = useState('');
  const decisions = remoteDecisions(state).filter(
    (q) => q.threadId === thread.id,
  );
  const canSend = can(machine, 'operate');
  const send = async () => {
    const message = text.trim();
    if (!message || !canSend) return;
    setText('');
    const result = await run(machine.id, {
      type: 'send',
      threadId: thread.id,
      text: message,
    });
    if (!result.isOk) setText((current) => current || message);
  };
  return (
    <div className="mx-auto flex w-full max-w-[720px] shrink-0 flex-col gap-3 px-4 pb-4 md:px-6">
      {decisions.map((item) => (
        <QueueDecision key={item.id} item={item} />
      ))}
      <ComposerCard>
        <form
          className="flex items-end gap-2 p-2"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <Textarea
            aria-label={`Message ${thread.title}`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing)
                return;
              e.preventDefault();
              void send();
            }}
            placeholder={placeholder(machine)}
            rows={1}
            className="max-h-60 min-h-10 resize-none border-0 bg-transparent! px-2 type-prose shadow-none focus-visible:ring-0 max-md:text-base"
          />
          <TooltipIconButton
            label="Send"
            hint={`Runs on ${machine.name}`}
            type="submit"
            variant="default"
            className="shrink-0 rounded-full"
            disabled={!canSend || !text.trim()}
          >
            <ArrowUp />
          </TooltipIconButton>
        </form>
      </ComposerCard>
    </div>
  );
}

/** Where the agent runs. A thread stays where it started. */
function DeviceIndicator({
  machine,
}: {
  machine: Pick<FollowedMachine, 'name' | 'kind'>;
}) {
  const label = `Runs on ${machine.name}`;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          aria-label={label}
          className="-mr-1 inline-flex size-7 items-center justify-center rounded-md text-muted-foreground"
        >
          <DeviceIcon kind={machine.kind} className="size-4" />
        </span>
      </TooltipTrigger>
      <TooltipContent className="flex-col items-start gap-0.5">
        <span className="block font-medium">{label}</span>
        <span className="block opacity-80">
          The agent works in this thread's folder on {machine.name}; this
          computer steers it
        </span>
      </TooltipContent>
    </Tooltip>
  );
}

function placeholder(machine: FollowedMachine) {
  if (machine.status !== 'online')
    return `${machine.name} is offline; your message stays here`;
  if (!machine.scopes.includes('operate'))
    return `${machine.name} lets this computer read only`;
  return `Message, runs on ${machine.name}`;
}

function Missing({
  machine,
  title,
  description,
  isLoading,
}: {
  machine?: FollowedMachine;
  title: string;
  description: string;
  isLoading?: boolean;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <TitleBar>
        {!!machine && <DeviceIndicator machine={machine} />}
        <span className="flex-1" />
        <TooltipIconButton
          label="Close"
          hint="Back to this computer’s threads (Esc)"
          onClick={goBack}
        >
          <X />
        </TooltipIconButton>
      </TitleBar>
      <Empty className="flex-1">
        <EmptyHeader>
          {isLoading && <Spinner />}
          <EmptyTitle>{title}</EmptyTitle>
          <EmptyDescription>{description}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  );
}
