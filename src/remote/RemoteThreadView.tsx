import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowUp, Stop, X } from 'reicon-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { ChatView } from '../ChatView';
import { ComposerCard } from '../Composer';
import type { FollowedMachine, Scope } from '../host/types/remote';
import { isTyping } from '../keys';
import { PreviewContext, SplitContext, type SplitInfo } from '../layout/SplitContext';
import type { Thread } from '../model';
import { QueueDecision } from '../QueueView';
import { useHarness, useView } from '../store';
import { TitleBar } from '../TitleBar';
import { DeviceIndicator } from '../ThreadView';
import { OverflowIcon, TooltipIconButton } from '../ui';
import { closeRemoteThread, useRemoteThreadRoute } from './open';
import { remoteDecisions } from './mirror';
import { MachinePresence } from './MachinePresence';
import { machineStatus } from './status';
import { RemoteScope, useMachines } from './useMachines';

/** Another computer's thread over the app: its transcript as that computer streams it, steered by commands sent there. */
export function RemoteThreadView() {
  const route = useRemoteThreadRoute()!;
  const followed = useMachines().machines.find((m) => m.machine.id === route.machineId);
  const thread = followed?.state?.threads.find((t) => t.id === route.threadId);
  useCloseOnLeave();
  if (!followed) return <Missing title="Not paired anymore" description="This computer no longer follows the one this thread runs on." />;
  if (!followed.state) return <Missing machine={followed.machine} title={followed.machine.status === 'connecting' ? `Connecting to ${followed.machine.name}…` : `${followed.machine.name} is offline`} description={machineStatus(followed.machine) ?? 'Its threads show here once it sends them.'} isLoading={followed.machine.status === 'connecting'} />;
  if (!thread) return <Missing machine={followed.machine} title="This thread is gone" description={`It isn’t on ${followed.machine.name} anymore.`} />;
  return (
    <RemoteScope machine={followed.machine} state={followed.state}>
      <div className="flex h-full min-h-0 flex-col">
        <RemoteHeader machine={followed.machine} thread={thread} />
        <SplitContext.Provider value={SPLIT}>
          {/* Read-only: rewinds, forks and the files behind links are that computer's, not this one's. */}
          <PreviewContext.Provider value>
            <ChatView thread={thread} isReadOnly />
          </PreviewContext.Provider>
        </SplitContext.Provider>
        <RemoteComposer machine={followed.machine} thread={thread} />
      </div>
    </RemoteScope>
  );
}

const SPLIT: SplitInfo = { leafId: 'remote', isFocused: true, isMulti: false, isZoomed: false, isFirst: true, isWide: true };

/** Esc, or going anywhere in this computer's own layout, closes it. */
function useCloseOnLeave() {
  const view = useView();
  const opened = useRef(view);
  useEffect(() => {
    if (view !== opened.current) closeRemoteThread();
  }, [view]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || isTyping(e.target)) return;
      closeRemoteThread();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

const can = (machine: FollowedMachine, scope: Scope) => machine.status === 'online' && machine.scopes.includes(scope);

function RemoteHeader({ machine, thread }: { machine: FollowedMachine; thread: Thread }) {
  const { run } = useMachines();
  const [shipping, setShipping] = useState<'commit' | 'open-pr' | null>(null);
  const isSettled = thread.status === 'settled';
  const canManage = can(machine, 'manage');
  return (
    <TitleBar>
      <DeviceIndicator machine={machine} />
      <span className="min-w-0 truncate type-title">{thread.title}</span>
      <MachinePresence machine={machine} />
      <span className="flex-1" />
      {!!thread.live?.isWorking && (
        <Button variant="outline" size="sm" className="rounded-full" disabled={!can(machine, 'operate')} onClick={() => void run(machine.id, { type: 'interrupt', threadId: thread.id })}>
          <Stop data-icon="inline-start" />
          Stop
        </Button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="Thread actions">
            <OverflowIcon vertical />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem disabled={!canManage} onSelect={() => void run(machine.id, { type: 'settle', threadId: thread.id, isSettled: !isSettled })}>
            {isSettled ? 'Reactivate' : 'Settle'}
          </DropdownMenuItem>
          {!!thread.repo && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled={!canManage} onSelect={() => setShipping('commit')}>
                Commit…
              </DropdownMenuItem>
              <DropdownMenuItem disabled={!canManage} onSelect={() => void run(machine.id, { type: 'push', threadId: thread.id })}>
                Push
              </DropdownMenuItem>
              <DropdownMenuItem disabled={!canManage} onSelect={() => setShipping('open-pr')}>
                Open pull request…
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <TooltipIconButton label="Close" hint="Back to this computer’s threads (Esc)" onClick={closeRemoteThread}>
        <X />
      </TooltipIconButton>
      <ShipDialog kind={shipping} machine={machine} thread={thread} onClose={() => setShipping(null)} />
    </TitleBar>
  );
}

/** A commit message, or a pull request's title and body, written here and sent to the machine that owns the worktree. */
function ShipDialog({ kind, machine, thread, onClose }: { kind: 'commit' | 'open-pr' | null; machine: FollowedMachine; thread: Thread; onClose: () => void }) {
  const { run } = useMachines();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [isSending, setIsSending] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setIsSending(true);
    const result = await run(machine.id, kind === 'commit' ? { type: 'commit', threadId: thread.id, message: title } : { type: 'open-pr', threadId: thread.id, title, body });
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
            <DialogTitle>{kind === 'commit' ? 'Commit' : 'Open a pull request'}</DialogTitle>
            <DialogDescription>
              {kind === 'commit' ? `Commits everything changed in this thread’s folder on ${machine.name}.` : `Pushes the branch and opens the pull request from ${machine.name}.`}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="remote-ship-title">{kind === 'commit' ? 'Message' : 'Title'}</Label>
            <Input id="remote-ship-title" value={title} onChange={(e) => setTitle(e.target.value)} required autoFocus />
          </div>
          {kind === 'open-pr' && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="remote-ship-body">Description</Label>
              <Textarea id="remote-ship-body" value={body} onChange={(e) => setBody(e.target.value)} rows={5} />
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
function RemoteComposer({ machine, thread }: { machine: FollowedMachine; thread: Thread }) {
  const { state } = useHarness();
  const { run } = useMachines();
  const [text, setText] = useState('');
  const decisions = remoteDecisions(state).filter((q) => q.threadId === thread.id);
  const canSend = can(machine, 'operate');
  const send = async () => {
    const message = text.trim();
    if (!message || !canSend) return;
    setText('');
    const result = await run(machine.id, { type: 'send', threadId: thread.id, text: message });
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
              if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;
              e.preventDefault();
              void send();
            }}
            placeholder={placeholder(machine)}
            rows={1}
            className="max-h-60 min-h-10 resize-none border-0 bg-transparent! px-2 type-prose shadow-none focus-visible:ring-0 max-md:text-base"
          />
          <TooltipIconButton label="Send" hint={`Runs on ${machine.name}`} type="submit" variant="default" className="shrink-0 rounded-full" disabled={!canSend || !text.trim()}>
            <ArrowUp />
          </TooltipIconButton>
        </form>
      </ComposerCard>
    </div>
  );
}

function placeholder(machine: FollowedMachine) {
  if (machine.status !== 'online') return `${machine.name} is offline; your message stays here`;
  if (!machine.scopes.includes('operate')) return `${machine.name} lets this computer read only`;
  return `Message, runs on ${machine.name}`;
}

function Missing({ machine, title, description, isLoading }: { machine?: FollowedMachine; title: string; description: string; isLoading?: boolean }) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <TitleBar>
        {!!machine && <DeviceIndicator machine={machine} />}
        <span className="flex-1" />
        <TooltipIconButton label="Close" hint="Back to this computer’s threads (Esc)" onClick={closeRemoteThread}>
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
