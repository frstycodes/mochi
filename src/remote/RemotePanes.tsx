import { useQuery } from '@tanstack/react-query';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowUp, Columns, Rows, X } from '@/icons';
import { ConversationContent, Conversation, ConversationScrollButton } from '@/components/ai-elements/conversation';
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from '@/components/ai-elements/prompt-input';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { ComposerCard } from '../Composer';
import { FileTree } from '../files/FileTree';
import { FilePath } from '../files/FileView';
import { ancestors, buildTree, visibleRows } from '../files/tree';
import type { FileTarget } from '../files/FileFinder';
import { ChangeList, type ChangeActions, type DiffStyle, type LineNote } from '../git/ChangeList';
import { changeSections, fileKey } from '../git/files';
import { useConfirm } from '../git/useConfirm';
import { gitError } from '../git/useGit';
import type { DiffScope } from '../host/types/git';
import type { FollowedMachine, RemoteCommand } from '../host/types/remote';
import type { Thread } from '../model';
import { ChangesSkeleton, DiffError, NoChanges, revertRequest } from '../pane/ChangesTab';
import { PaneActions, PaneActionsSlot, PaneSlots, PaneTitle, PaneTitleSlot } from '../pane/PaneHeader';
import { Answer, EmptySideChat, Question } from '../pane/SideChatTab';
import { PANE_TABS } from '../pane/tabs';
import { setPrefs, usePrefs } from '../settings/prefs';
import { chatFor } from '../store/sidechat';
import { useHarness } from '../store';
import { DiffStat } from '../WorkLog';
import { TooltipIconButton } from '../ui';
import { REMOTE_SIDE_CHAT_TAB } from './commands';
import { useMachines } from './useMachines';
import { queryKeys } from '../queryKeys';

// Lazy so CodeMirror parses only when a file is first opened.
const RemoteTerminal = lazy(() => import('./RemoteTerminal'));
const CodeEditor = lazy(() => import('../files/CodeEditor'));

/** Panes another computer's thread can open here, each reading from and acting on that computer, and the scope each needs. */
export const REMOTE_PANES = {
  changes: { scope: 'code', needsFolder: true },
  files: { scope: 'code', needsFolder: true },
  terminal: { scope: 'terminal', needsFolder: true },
  sidechat: { scope: 'read', needsFolder: false },
} as const;

export type RemotePaneKind = keyof typeof REMOTE_PANES;

/** One pane card beside the chat, its header like the machine's own panes. */
/** `file`: what a link in the transcript last opened, shown in Files. */
export function RemotePane({
  kind,
  machine,
  thread,
  file,
  onClose,
}: {
  kind: RemotePaneKind;
  machine: FollowedMachine;
  thread: Thread;
  file?: FileTarget;
  onClose: () => void;
}) {
  const { title, icon: Icon } = PANE_TABS[kind];
  return (
    <section aria-label={title} className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border bg-card">
      <PaneSlots>
        <header data-pane-header className="flex h-9 shrink-0 items-center gap-0.5 pr-1.5 pl-3 select-none">
          <PaneTitleSlot>
            <Icon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
            <h2 className="truncate type-meta font-medium">{title}</h2>
          </PaneTitleSlot>
          <PaneActionsSlot />
          <TooltipIconButton
            label={`Close ${title}`}
            hint={`Reads from ${machine.name} again when you open it`}
            onClick={onClose}
            className="text-muted-foreground"
          >
            <X />
          </TooltipIconButton>
        </header>
        <div className="flex min-h-0 flex-1 flex-col">
          {kind === 'changes' && <RemoteChanges machine={machine} thread={thread} />}
          {kind === 'files' && <RemoteFiles machine={machine} thread={thread} file={file} />}
          {kind === 'terminal' && <Suspense><RemoteTerminal machine={machine} thread={thread} /></Suspense>}
          {kind === 'sidechat' && <RemoteSideChat machine={machine} thread={thread} />}
        </div>
      </PaneSlots>
    </section>
  );
}

const DIFF_POLL_MS = 4000;

/** A read from the machine, again every `pollMs` while it's online; the last data stays on screen across a failed read. */
function useMachineRead<T>(machine: FollowedMachine, key: readonly unknown[], load: () => Promise<T>, pollMs?: number) {
  const isOnline = machine.status === 'online';
  const machineQuery = useQuery({ queryKey: queryKeys.remote.read(machine.id, key), queryFn: load, enabled: isOnline, refetchInterval: pollMs ?? false });
  return { data: machineQuery.data, error: machineQuery.error ? gitError(machineQuery.error) : undefined, isLoading: isOnline && machineQuery.isPending, refresh: async () => { await machineQuery.refetch(); } };
}

/** The Changes tab on the machine's worktree: staging, reverting and line notes run there. */
function RemoteChanges({ machine, thread }: { machine: FollowedMachine; thread: Thread }) {
  const { ask, run } = useMachines();
  const { state } = useHarness();
  // A checkpoint's diff is what the thread had changed then, so it's read once, not polled.
  const [scope, setScope] = useState<DiffScope | `checkpoint:${number}`>('branch');
  const checkpoint = scope.startsWith('checkpoint:') ? Number(scope.slice('checkpoint:'.length)) : undefined;
  const saved = (state.checkpoints[thread.id] ?? []).filter((c) => !!c.ref);
  const { diffStyle } = usePrefs();
  const diffQuery = useMachineRead(
    machine, ['diff', thread.id, scope],
    useCallback(
      () => (checkpoint === undefined ? ask(machine.id, { type: 'diff', threadId: thread.id, scope: scope as DiffScope }) : ask(machine.id, { type: 'checkpoint-diff', threadId: thread.id, n: checkpoint })),
      [ask, machine.id, thread.id, scope, checkpoint],
    ),
    checkpoint === undefined ? DIFF_POLL_MS : undefined,
  );
  const { confirm, dialog } = useConfirm();
  const actions = useRemoteChangeActions({ machine, thread, canStage: scope === 'uncommitted', diffStyle, confirm, refresh: diffQuery.refresh, run });
  const files = diffQuery.data?.files ?? [];
  const isEmpty = !!diffQuery.data && files.length === 0;
  return (
    <>
      <PaneTitle>
        <Select value={scope} onValueChange={(v) => setScope(v as typeof scope)}>
          <SelectTrigger size="sm" aria-label="Compare" className="-ml-1.5 shrink-0">
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
            <DiffStat added={files.reduce((n, f) => n + f.added, 0)} removed={files.reduce((n, f) => n + f.removed, 0)} />
          </span>
        )}
        <ToggleGroup
          type="single"
          size="sm"
          variant="outline"
          spacing={0}
          value={diffStyle}
          onValueChange={(v) => v && setPrefs({ diffStyle: v as DiffStyle })}
          aria-label="Diff layout"
        >
          <ToggleGroupItem value="unified" aria-label="Unified diff">
            <Rows />
          </ToggleGroupItem>
          <ToggleGroupItem value="split" aria-label="Split diff">
            <Columns />
          </ToggleGroupItem>
        </ToggleGroup>
      </PaneActions>
      {machine.status !== 'online' && <OfflineState machine={machine} />}
      {!!diffQuery.error && !diffQuery.data && <DiffError message={diffQuery.error} onRetry={() => void diffQuery.refresh()} />}
      {diffQuery.isLoading && <ChangesSkeleton />}
      {isEmpty && <NoChanges scope={checkpoint === undefined ? (scope as DiffScope) : 'branch'} />}
      {files.length > 0 && (
        <ScrollArea type="scroll" className="min-h-0 flex-1 [&_[data-slot=scroll-area-viewport]>div]:block!">
          <ChangeList key={scope} sections={changeSections(files, actions.canStage)} actions={actions} />
        </ScrollArea>
      )}
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
function useRemoteChangeActions({ machine, thread, canStage, diffStyle, confirm, refresh, run }: RemoteChangeActionsInput): ChangeActions {
  const [notes, setNotes] = useState<LineNote[]>([]);
  const send = async (command: RemoteCommand) => {
    const result = await run(machine.id, command);
    await refresh();
    return result.isOk;
  };
  const change = (action: 'stage' | 'unstage' | 'revert') => (target: Parameters<ChangeActions['stage']>[0]) =>
    void send({ type: 'change', threadId: thread.id, action, target });
  return {
    canStage,
    diffStyle,
    agentName: thread.providers[0] === 'codex' ? 'Codex' : 'Claude',
    notes,
    stage: change('stage'),
    unstage: change('unstage'),
    revert: (target) => void confirm(revertRequest(target)).then((ok) => ok && send({ type: 'change', threadId: thread.id, action: 'revert', target })),
    comment: (file, side, line) => {
      const key = fileKey(file);
      const id = `${key}:${side}:${line}`;
      setNotes((all) =>
        all.some((n) => n.id === id && !n.isSent) ? all : [...all, { id, fileKey: key, path: file.path, side, line, text: '', isSent: false }],
      );
    },
    sendNote: (note, text) =>
      void send({ type: 'comment', threadId: thread.id, path: note.path, side: note.side, line: note.line, text }).then(
        (isSent) => isSent && setNotes((all) => all.map((n) => (n.id === note.id ? { ...n, id: `${n.id}:${Date.now()}`, text, isSent: true } : n))),
      ),
    dropNote: (note) => setNotes((all) => all.filter((n) => n.id !== note.id)),
  };
}

/** The machine's file tree and a read-only view of one file; editing stays on the machine. */
function RemoteFiles({ machine, thread, file }: { machine: FollowedMachine; thread: Thread; file?: FileTarget }) {
  const { ask } = useMachines();
  const list = useMachineRead(
    machine, ['files', thread.id],
    useCallback(() => ask(machine.id, { type: 'files', threadId: thread.id }), [ask, machine.id, thread.id]),
  );
  const [expanded, setExpanded] = useState(() => new Set<string>());
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    if (!file) return;
    setSelected(file.path);
    setExpanded((all) => new Set([...all, ...ancestors(file.path)]));
  }, [file]);
  const rows = useMemo(() => visibleRows(buildTree(list.data?.paths ?? []), expanded), [list.data, expanded]);
  const toggle = (path: string) =>
    setExpanded((all) => {
      const next = new Set(all);
      if (!next.delete(path)) next.add(path);
      return next;
    });
  if (machine.status !== 'online' && !list.data) return <OfflineState machine={machine} />;
  return (
    <div className="flex min-h-0 flex-1">
      <aside className="flex w-56 shrink-0 flex-col">
        <ScrollArea type="scroll" className="min-h-0 flex-1">
          {list.isLoading && <Spinner className="m-3" />}
          {!!list.error && <p className="px-3 type-meta text-destructive">{list.error}</p>}
          <FileTree rows={rows} isExpanded={(path) => expanded.has(path)} selected={selected} active={null} onToggle={toggle} onSelect={setSelected} />
          {!!list.data?.isTruncated && (
            <p className="px-3 pb-3 type-caption text-subtle-foreground">Showing the first {list.data.paths.length.toLocaleString()} files</p>
          )}
        </ScrollArea>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col bg-background">
        {selected ? (
          <RemoteFile key={selected} machine={machine} thread={thread} path={selected} line={file?.path === selected ? file.line : undefined} />
        ) : (
          <PickFileState />
        )}
      </div>
    </div>
  );
}

function RemoteFile({ machine, thread, path, line }: { machine: FollowedMachine; thread: Thread; path: string; line?: number }) {
  const { ask } = useMachines();
  const file = useMachineRead(
    machine, ['file', thread.id, path],
    useCallback(() => ask(machine.id, { type: 'read-file', threadId: thread.id, path }), [ask, machine.id, thread.id, path]),
  );
  return (
    <>
      <header className="flex h-9 shrink-0 items-center gap-1.5 px-3">
        <FilePath path={path} />
      </header>
      <div className="min-h-0 flex-1">
        {file.isLoading && <Spinner className="m-3" />}
        {!!file.error && <p className="p-4 type-meta text-destructive">{file.error}</p>}
        {!!file.data && (
          <Suspense>
            <CodeEditor path={path} value={file.data.text} line={line} readOnly />
          </Suspense>
        )}
      </div>
    </>
  );
}

/** The thread's side chat asked from here: answered on the machine, streamed back with its store. */
function RemoteSideChat({ machine, thread }: { machine: FollowedMachine; thread: Thread }) {
  const { state } = useHarness();
  const { run } = useMachines();
  const chat = chatFor(state, thread.id, REMOTE_SIDE_CHAT_TAB);
  const isStreaming = chat.messages.some((m) => m.isStreaming);
  const canAsk = machine.status === 'online' && machine.scopes.includes('operate');
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {chat.messages.length === 0 ? (
        <EmptySideChat />
      ) : (
        <Conversation className="min-h-0 flex-1">
          <ConversationContent className="gap-5 px-4 pt-2 pb-4">
            {chat.messages.map((m) => (m.role === 'user' ? <Question key={m.id} message={m} /> : <Answer key={m.id} message={m} />))}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>
      )}
      <div className="shrink-0 px-3 pb-3">
        <ComposerCard>
          <PromptInput onSubmit={({ text }) => void (text.trim() && run(machine.id, { type: 'side-chat', threadId: thread.id, text: text.trim() }))}>
            <PromptInputBody>
              <PromptInputTextarea
                disabled={!canAsk}
                placeholder={canAsk ? `Ask about this thread; ${machine.name} answers` : `${machine.name} can’t be asked right now`}
                className="min-h-10 px-4 pt-3 type-prose max-md:text-base"
              />
            </PromptInputBody>
            <PromptInputFooter className="px-2 pb-2">
              <PromptInputTools />
              <PromptInputTools>
                <PromptInputSubmit aria-label="Ask" disabled={!canAsk || isStreaming} className="rounded-full">
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
  return <PaneState title={`${machine.name} is offline`} description="This reads from that computer once it’s back." />;
}

function PickFileState() {
  return <PaneState title="Pick a file" description="Files open read-only here; edit them on that computer." />;
}

function PaneState({ title, description }: { title: string; description: ReactNode }) {
  return (
    <Empty className="flex-1">
      <EmptyHeader>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
