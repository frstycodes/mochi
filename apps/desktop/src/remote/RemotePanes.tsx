import { useQuery } from '@tanstack/react-query';
import { lazy, Suspense, useState, type ReactNode } from 'react';
import { ArrowUp } from '@/icons';
import {
  ConversationContent,
  Conversation,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation';
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from '@/components/ai-elements/prompt-input';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty';
import { ScrollArea } from '@/components/ui/scroll-area';
import { SkeletonRows } from '@/components/SkeletonRows';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { ComposerCard } from '../Composer';
import { FileTree } from '../files/FileTree';
import { FilePath } from '../files/FileView';
import { ancestors, buildTree, visibleRows } from '@mochi/domain/files/tree';
import type { FileTarget } from '../files/FileFinder';
import {
  ChangeList,
  type ChangeActions,
  type DiffStyle,
  type LineNote,
} from '../git/ChangeList';
import { changeSections, fileKey } from '../git/files';
import { useConfirm } from '../git/useConfirm';
import { gitError } from '../git/useGit';
import type { DiffScope } from '../host/types/git';
import type { FollowedMachine, RemoteCommand } from '../host/types/remote';
import type { PaneTabKind, Thread } from '../model';
import {
  DiffError,
  DIFF_STYLES,
  NoChanges,
  revertRequest,
} from '../pane/ChangesTab';
import { PaneActions, PaneTitle } from '../pane/PaneHeader';
import { Answer, EmptySideChat, Question } from '../pane/SideChatTab';
import { PANE_TABS } from '../pane/tabs';
import { setPrefs, usePrefs } from '../settings/prefs';
import { chatFor } from '../store/sidechat';
import { useHarness } from '../store';
import { DiffStat } from '../WorkLog';
import { ModeToggle } from '../ui';
import { REMOTE_SIDE_CHAT_TAB } from './commands';
import { useMachines } from './useMachines';
import { elsewhereReason, useRemoteMachine } from './origin';
import { RemoteShipBar } from './RemoteShip';
import type { PaneTabProps } from '../pane/tabs';
import { queryKeys } from '../queryKeys';

// Lazy so CodeMirror parses only when a file is first opened.
const RemoteTerminal = lazy(() => import('./RemoteTerminal'));
const CodeEditor = lazy(() => import('../files/CodeEditor'));

/** Panes another computer's thread can open here, each reading from and acting on that computer, and the scope each needs. */
const REMOTE_PANES = {
  changes: { scope: 'code', needsFolder: true },
  files: { scope: 'code', needsFolder: true },
  terminal: { scope: 'terminal', needsFolder: true },
  sidechat: { scope: 'read', needsFolder: false },
} as const;

type RemotePaneKind = keyof typeof REMOTE_PANES;

/**
 * A pane tab of another computer's thread in the app's own side pane (`usePaneTabComponent`): the panes that read from that
 * computer through commands, and for the rest why they can't open here yet. None reads this computer's disk.
 */
export function RemotePaneTab({ thread, tab }: PaneTabProps) {
  const machine = useRemoteMachine();
  if (!machine) return null;
  const reason = remotePaneReason(tab.kind, machine, thread);
  if (reason)
    return (
      <PaneState
        title={`${PANE_TABS[tab.kind].title} isn’t here yet`}
        description={reason}
      />
    );
  const kind = tab.kind as RemotePaneKind;
  return (
    <div className="flex h-full min-h-0 flex-col">
      {kind === 'changes' && (
        <RemoteChanges machine={machine} thread={thread} />
      )}
      {kind === 'files' && (
        <RemoteFiles machine={machine} thread={thread} file={tab.file} />
      )}
      {kind === 'terminal' && (
        <Suspense>
          <RemoteTerminal machine={machine} thread={thread} />
        </Suspense>
      )}
      {kind === 'sidechat' && (
        <RemoteSideChat machine={machine} thread={thread} />
      )}
    </div>
  );
}

/** Why a pane can't open on another computer's thread: not built for it yet, a scope it wasn't given, no folder. */
export function remotePaneReason(
  kind: PaneTabKind,
  machine: FollowedMachine,
  thread: Pick<Thread, 'repo' | 'live'>,
) {
  if (!(kind in REMOTE_PANES)) return elsewhereReason(machine);
  const { scope, needsFolder } = REMOTE_PANES[kind as RemotePaneKind];
  if (!machine.scopes.includes(scope))
    return `${machine.name} hasn’t given this computer the ${scope} scope`;
  if (needsFolder && !thread.repo && !thread.live?.cwd)
    return 'This thread has no folder yet';
  return undefined;
}

const DIFF_POLL_MS = 4000;

/** A read from the machine, again every `pollMs` while it's online; the last data stays on screen across a failed read. */
function useMachineRead<T>(
  machine: FollowedMachine,
  key: readonly unknown[],
  load: () => Promise<T>,
  pollMs?: number,
) {
  const isOnline = machine.status === 'online';
  const machineQuery = useQuery({
    queryKey: queryKeys.remote.read(machine.id, key),
    queryFn: load,
    enabled: isOnline,
    refetchInterval: pollMs ?? false,
  });
  return {
    data: machineQuery.data,
    error: machineQuery.error ? gitError(machineQuery.error) : undefined,
    isLoading: isOnline && machineQuery.isPending,
    refresh: async () => {
      await machineQuery.refetch();
    },
  };
}

/** The Changes tab on the machine's worktree: staging, reverting and line notes run there. */
function RemoteChanges({
  machine,
  thread,
}: {
  machine: FollowedMachine;
  thread: Thread;
}) {
  const { ask, run } = useMachines();
  const { state } = useHarness();
  // A checkpoint's diff is what the thread had changed then, so it's read once, not polled.
  const [scope, setScope] = useState<DiffScope | `checkpoint:${number}`>(
    'branch',
  );
  const checkpoint = scope.startsWith('checkpoint:')
    ? Number(scope.slice('checkpoint:'.length))
    : undefined;
  const saved = (state.checkpoints[thread.id] ?? []).filter((c) => !!c.ref);
  const { diffStyle } = usePrefs();
  const diffQuery = useMachineRead(
    machine,
    ['diff', thread.id, scope],
    () =>
      checkpoint === undefined
        ? ask(machine.id, {
            type: 'diff',
            threadId: thread.id,
            scope: scope as DiffScope,
          })
        : ask(machine.id, {
            type: 'checkpoint-diff',
            threadId: thread.id,
            n: checkpoint,
          }),
    checkpoint === undefined ? DIFF_POLL_MS : undefined,
  );
  const { confirm, dialog } = useConfirm();
  const actions = useRemoteChangeActions({
    machine,
    thread,
    canStage: scope === 'uncommitted',
    diffStyle,
    confirm,
    refresh: diffQuery.refresh,
    run,
  });
  const files = diffQuery.data?.files ?? [];
  const isEmpty = !!diffQuery.data && files.length === 0;
  return (
    <>
      <PaneTitle>
        <Select
          value={scope}
          onValueChange={(v) => setScope(v as typeof scope)}
        >
          <SelectTrigger
            size="sm"
            aria-label="Compare"
            className="-ml-1.5 shrink-0"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="branch">Branch</SelectItem>
              <SelectItem value="uncommitted">Uncommitted</SelectItem>
            </SelectGroup>
            {saved.length > 0 && (
              <SelectGroup>
                <SelectLabel>At a checkpoint</SelectLabel>
                {saved.map((c) => (
                  <SelectItem key={c.n} value={`checkpoint:${c.n}`}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            )}
          </SelectContent>
        </Select>
      </PaneTitle>
      <PaneActions>
        {files.length > 0 && (
          <span className="hidden @lg:flex">
            <DiffStat
              added={files.reduce((n, f) => n + f.added, 0)}
              removed={files.reduce((n, f) => n + f.removed, 0)}
            />
          </span>
        )}
        <ModeToggle
          value={diffStyle}
          modes={DIFF_STYLES}
          onSelect={(v) => setPrefs({ diffStyle: v })}
          className="text-muted-foreground"
        />
      </PaneActions>
      {machine.status !== 'online' && <OfflineState machine={machine} />}
      {!!diffQuery.error && !diffQuery.data && (
        <DiffError
          message={diffQuery.error}
          onRetry={() => void diffQuery.refresh()}
        />
      )}
      {diffQuery.isLoading && (
        <SkeletonRows
          shape="change"
          count={4}
          label="Loading changes"
          className="px-2"
        />
      )}
      {isEmpty && (
        <NoChanges
          scope={checkpoint === undefined ? (scope as DiffScope) : 'branch'}
        />
      )}
      {files.length > 0 && (
        <ScrollArea
          type="scroll"
          className="min-h-0 flex-1 [&_[data-slot=scroll-area-viewport]>div]:block!"
        >
          <ChangeList
            key={scope}
            sections={changeSections(files, actions.canStage)}
            actions={actions}
          />
        </ScrollArea>
      )}
      {!!thread.repo && <RemoteShipBar machine={machine} thread={thread} />}
      {dialog}
    </>
  );
}

interface RemoteChangeActionsInput {
  machine: FollowedMachine;
  thread: Thread;
  canStage: boolean;
  diffStyle: DiffStyle;
  confirm: ReturnType<typeof useConfirm>['confirm'];
  refresh: () => Promise<void>;
  run: ReturnType<typeof useMachines>['run'];
}

/** `ChangesTab`'s actions, each a command to the machine; the diff is read again once it answers. */
function useRemoteChangeActions({
  machine,
  thread,
  canStage,
  diffStyle,
  confirm,
  refresh,
  run,
}: RemoteChangeActionsInput): ChangeActions {
  const [notes, setNotes] = useState<LineNote[]>([]);
  const send = async (command: RemoteCommand) => {
    const result = await run(machine.id, command);
    await refresh();
    return result.isOk;
  };
  const change =
    (action: 'stage' | 'unstage' | 'revert') =>
    (target: Parameters<ChangeActions['stage']>[0]) =>
      void send({ type: 'change', threadId: thread.id, action, target });
  return {
    canStage,
    diffStyle,
    agentName: thread.providers[0] === 'codex' ? 'Codex' : 'Claude',
    notes,
    stage: change('stage'),
    unstage: change('unstage'),
    revert: (target) =>
      void confirm(revertRequest(target)).then(
        (ok) =>
          ok &&
          send({
            type: 'change',
            threadId: thread.id,
            action: 'revert',
            target,
          }),
      ),
    comment: (file, side, line) => {
      const key = fileKey(file);
      const id = `${key}:${side}:${line}`;
      setNotes((all) =>
        all.some((n) => n.id === id && !n.isSent)
          ? all
          : [
              ...all,
              {
                id,
                fileKey: key,
                path: file.path,
                side,
                line,
                text: '',
                isSent: false,
              },
            ],
      );
    },
    sendNote: (note, text) =>
      void send({
        type: 'comment',
        threadId: thread.id,
        path: note.path,
        side: note.side,
        line: note.line,
        text,
      }).then(
        (isSent) =>
          isSent &&
          setNotes((all) =>
            all.map((n) =>
              n.id === note.id
                ? { ...n, id: `${n.id}:${Date.now()}`, text, isSent: true }
                : n,
            ),
          ),
      ),
    dropNote: (note) => setNotes((all) => all.filter((n) => n.id !== note.id)),
  };
}

/** The machine's file tree and a read-only view of one file; editing stays on the machine. */
function RemoteFiles({
  machine,
  thread,
  file,
}: {
  machine: FollowedMachine;
  thread: Thread;
  file?: FileTarget;
}) {
  const { ask } = useMachines();
  const list = useMachineRead(machine, ['files', thread.id], () =>
    ask(machine.id, { type: 'files', threadId: thread.id }),
  );
  const [expanded, setExpanded] = useState(() => new Set<string>());
  const [selected, setSelected] = useState<string | null>(null);
  const [shownFile, setShownFile] = useState<FileTarget>();
  if (file !== shownFile) {
    setShownFile(file);
    if (file) {
      setSelected(file.path);
      setExpanded((all) => new Set([...all, ...ancestors(file.path)]));
    }
  }
  const rows = visibleRows(buildTree(list.data?.paths ?? []), expanded);
  const toggle = (path: string) =>
    setExpanded((all) => {
      const next = new Set(all);
      if (!next.delete(path)) next.add(path);
      return next;
    });
  if (machine.status !== 'online' && !list.data)
    return <OfflineState machine={machine} />;
  return (
    <div className="flex min-h-0 flex-1">
      <aside className="flex w-56 shrink-0 flex-col">
        <ScrollArea type="scroll" className="min-h-0 flex-1">
          {list.isLoading && <Spinner className="m-3" />}
          {!!list.error && (
            <p className="px-3 type-meta text-destructive">{list.error}</p>
          )}
          <FileTree
            rows={rows}
            isExpanded={(path) => expanded.has(path)}
            selected={selected}
            active={null}
            onToggle={toggle}
            onSelect={setSelected}
          />
          {!!list.data?.isTruncated && (
            <p className="px-3 pb-3 type-caption text-subtle-foreground">
              Showing the first {list.data.paths.length.toLocaleString()} files
            </p>
          )}
        </ScrollArea>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col bg-background">
        {selected ? (
          <RemoteFile
            key={selected}
            machine={machine}
            thread={thread}
            path={selected}
            line={file?.path === selected ? file.line : undefined}
          />
        ) : (
          <PickFileState />
        )}
      </div>
    </div>
  );
}

function RemoteFile({
  machine,
  thread,
  path,
  line,
}: {
  machine: FollowedMachine;
  thread: Thread;
  path: string;
  line?: number;
}) {
  const { ask } = useMachines();
  const file = useMachineRead(machine, ['file', thread.id, path], () =>
    ask(machine.id, { type: 'read-file', threadId: thread.id, path }),
  );
  return (
    <>
      <header className="flex h-9 shrink-0 items-center gap-1.5 px-3">
        <FilePath path={path} />
      </header>
      <div className="min-h-0 flex-1">
        {file.isLoading && <Spinner className="m-3" />}
        {!!file.error && (
          <p className="p-4 type-meta text-destructive">{file.error}</p>
        )}
        {!!file.data && (
          <Suspense>
            <CodeEditor
              path={path}
              value={file.data.text}
              line={line}
              readOnly
            />
          </Suspense>
        )}
      </div>
    </>
  );
}

/** The thread's side chat asked from here: answered on the machine, streamed back with its store. */
function RemoteSideChat({
  machine,
  thread,
}: {
  machine: FollowedMachine;
  thread: Thread;
}) {
  const { run, machines } = useMachines();
  // The side chat runs on that computer: its answers are in its store, not this window's.
  const mirror = machines.find((m) => m.machine.id === machine.id)?.state;
  const chat = mirror
    ? chatFor(mirror, thread.id, REMOTE_SIDE_CHAT_TAB)
    : { messages: [] };
  const isStreaming = chat.messages.some((m) => m.isStreaming);
  const canAsk =
    machine.status === 'online' && machine.scopes.includes('operate');
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {chat.messages.length === 0 ? (
        <EmptySideChat />
      ) : (
        <Conversation className="min-h-0 flex-1">
          <ConversationContent className="gap-5 px-4 pt-2 pb-4">
            {chat.messages.map((m) =>
              m.role === 'user' ? (
                <Question key={m.id} message={m} />
              ) : (
                <Answer key={m.id} message={m} />
              ),
            )}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>
      )}
      <div className="shrink-0 px-3 pb-3">
        <ComposerCard>
          <PromptInput
            onSubmit={({ text }) =>
              void (
                text.trim() &&
                run(machine.id, {
                  type: 'side-chat',
                  threadId: thread.id,
                  text: text.trim(),
                })
              )
            }
          >
            <PromptInputBody>
              <PromptInputTextarea
                disabled={!canAsk}
                placeholder={
                  canAsk
                    ? `Ask about this thread; ${machine.name} answers`
                    : `${machine.name} can’t be asked right now`
                }
                className="min-h-10 px-4 pt-3 type-prose max-md:text-base"
              />
            </PromptInputBody>
            <PromptInputFooter className="px-2 pb-2">
              <PromptInputTools />
              <PromptInputTools>
                <PromptInputSubmit
                  aria-label="Ask"
                  disabled={!canAsk || isStreaming}
                  className="rounded-full"
                >
                  <ArrowUp className="size-4" />
                </PromptInputSubmit>
              </PromptInputTools>
            </PromptInputFooter>
          </PromptInput>
        </ComposerCard>
      </div>
    </div>
  );
}

function OfflineState({ machine }: { machine: FollowedMachine }) {
  return (
    <PaneState
      title={`${machine.name} is offline`}
      description="This reads from that computer once it’s back."
    />
  );
}

function PickFileState() {
  return (
    <PaneState
      title="Pick a file"
      description="Files open read-only here; edit them on that computer."
    />
  );
}

function PaneState({
  title,
  description,
}: {
  title: string;
  description: ReactNode;
}) {
  return (
    <Empty className="flex-1">
      <EmptyHeader>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
