import { useCallback, useEffect, useId, useState } from 'react';
import { BranchUp, ChevronDown, Folder, Layers, Warning } from 'reicon-react';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from '@/components/ui/command';
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import { host } from '../host';
import type { Branch, BranchList } from '../host/types/git';
import type { Thread } from '../model';
import { timeAgo } from '../progress';
import { projectName, projectRef } from '../projects';
import { getPrefs } from '../settings/prefs';
import { useHarness } from '../store';
import { branchName, isUnstarted, uniqueBranch, type WorkspaceDraft, type WorkspaceMode } from './workspace';

const NAME_CHECK_MS = 250;

export interface Workspace {
  /** The project ref (an absolute path on desktop). */
  root: string;
  draft: WorkspaceDraft;
  onChange: (draft: WorkspaceDraft) => void;
  /** Undefined while loading; `error` when the folder isn't a git repo. */
  branches: { list?: BranchList; error?: string; refresh: () => void };
  /** The branch the thread will be on: the new branch's name, the checked-out one, or the folder's current branch. */
  branch: string | undefined;
  /** Why the thread can't start with this choice. */
  error: string | null;
  /** Unsettled project folder threads already working in this checkout. */
  sharers: Thread[];
}

/** The pickers' state for a new thread in `root` (empty: none, nothing is read); `prompt` names the new branch until you type a name. */
export function useWorkspace(root: string, draft: WorkspaceDraft, onChange: (draft: WorkspaceDraft) => void, prompt: string, threadId?: string): Workspace {
  const branches = useBranches(root);
  const { list } = branches;
  const taken = new Set(list?.branches.filter((b) => !b.isRemote).map((b) => b.name));
  const isNew = draft.mode === 'worktree' && !draft.isExisting;
  const branch = isNew ? (draft.branch ?? uniqueBranch(branchName(getPrefs().branchPrefix, prompt, 'thread'), taken)) : draft.isExisting ? draft.branch : (list?.current ?? undefined);
  const nameError = useBranchNameError(root, isNew && !!list ? branch : undefined);
  const sharers = useHarness().state.threads.filter((t) => t.id !== threadId && t.status !== 'settled' && t.repo?.mode === 'folder' && projectRef(t.repo) === root);
  return { root, draft, onChange, branches, branch, error: isNew ? nameError : draft.isExisting && !draft.branch ? 'Pick the branch to check out' : null, sharers };
}

/** A thread whose folder isn't set up yet (`isUnstarted`) can still change where it works, kept in the store; null once it started. */
export function useThreadWorkspace(thread: Thread): Workspace | null {
  const { dispatch } = useHarness();
  const repo = thread.repo;
  const isOpen = !!repo && isUnstarted(thread);
  const draft: WorkspaceDraft = { mode: repo?.mode ?? 'worktree', base: repo?.base, isExisting: repo?.isExisting, branch: repo?.branch };
  const change = (next: WorkspaceDraft) => dispatch({ type: 'workspace', threadId: thread.id, workspace: { ...next, branch: next.branch ?? (next.mode === 'folder' ? (workspace.branches.list?.current ?? undefined) : undefined) } });
  const workspace = useWorkspace(isOpen ? projectRef(repo)! : '', draft, change, thread.goal, thread.id);
  return isOpen ? workspace : null;
}

/** The meta row's workspace chips: where the thread works, then its branch. */
export function WorkspaceControls({ workspace }: { workspace: Workspace }) {
  return (
    <>
      <WorkspaceMenu workspace={workspace} />
      {!workspace.branches.error && <BranchPicker workspace={workspace} />}
    </>
  );
}

const MODES = [
  { value: 'worktree', label: 'New worktree', icon: Layers, description: 'An isolated copy on its own branch; your checkout stays as it is' },
  { value: 'folder', label: 'Project folder', icon: Folder, description: 'Right in your checkout, on its current branch' },
] as const satisfies readonly { value: WorkspaceMode; label: string; description: string; icon: unknown }[];

function WorkspaceMenu({ workspace }: { workspace: Workspace }) {
  const { draft, onChange } = workspace;
  const mode = MODES.find((m) => m.value === draft.mode) ?? MODES[0];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="xs" className="text-subtle-foreground hover:text-foreground" aria-label={`Works in: ${mode.label}`}>
          <mode.icon />
          {mode.label}
          <ChevronDown data-icon="inline-end" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel>Works in</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={draft.mode} onValueChange={(v) => onChange({ mode: v as WorkspaceMode })}>
          {MODES.map((m) => (
            <DropdownMenuRadioItem key={m.value} value={m.value} className="items-start">
              <m.icon className="mt-0.5" />
              <span className="flex min-w-0 flex-col">
                {m.label}
                <span className="type-caption text-subtle-foreground">{m.description}</span>
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Worktree: the base a new branch starts from (and its name), or an existing branch to check out. Project folder: a branch to switch to. */
function BranchPicker({ workspace }: { workspace: Workspace }) {
  const { draft, onChange, branches, branch } = workspace;
  const [isOpen, setOpen] = useState(false);
  const { list } = branches;
  const isNew = draft.mode === 'worktree' && !draft.isExisting;
  const label = isNew ? (draft.base ?? list?.defaultBranch) : branch;
  const choose = (name: string) => {
    if (isNew) onChange({ ...draft, base: name === list?.defaultBranch ? undefined : name });
    else onChange({ ...draft, branch: name, isExisting: draft.mode === 'worktree' || name !== list?.current });
    setOpen(false);
  };

  return (
    <Popover
      open={isOpen}
      onOpenChange={(open) => {
        setOpen(open);
        if (open) branches.refresh();
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="ghost" size="xs" className="max-w-48 text-subtle-foreground hover:text-foreground" aria-label={`${isNew ? 'From' : 'Branch'}: ${label ?? 'loading'}`}>
          <BranchUp />
          <span className="truncate">{isNew ? `from ${label ?? '…'}` : (label ?? 'Pick a branch')}</span>
          <ChevronDown data-icon="inline-end" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 max-w-[calc(100vw-2rem)] p-0">
        <BranchList workspace={workspace} onChoose={choose} />
        {draft.mode === 'worktree' && <WorktreeFooter workspace={workspace} />}
      </PopoverContent>
    </Popover>
  );
}

function BranchList({ workspace, onChoose }: { workspace: Workspace; onChoose: (name: string) => void }) {
  const { draft, branches, branch, root } = workspace;
  const { list } = branches;
  const isNew = draft.mode === 'worktree' && !draft.isExisting;
  const selected = isNew ? (draft.base ?? list?.defaultBranch) : branch;
  const isSwitchRefused = draft.mode === 'folder' && !!list?.isDirty;
  const local = list?.branches.filter((b) => !b.isRemote) ?? [];
  const remote = list?.branches.filter((b) => b.isRemote) ?? [];
  // Another checkout holding the branch blocks checking it out; the folder's own current branch is fine to stay on.
  const blockedBy = (b: Branch) => (!isNew && b.worktree && !(draft.mode === 'folder' && b.name === list?.current) ? b.worktree : undefined);
  const heading = isNew ? 'Start from' : draft.mode === 'worktree' ? 'Check out' : 'Switch to';
  const rows = { list, selected, onChoose, blockedBy, isLocked: (b: Branch) => isSwitchRefused && b.name !== list?.current };

  return (
    <Command>
      <CommandInput placeholder="Search branches" />
      {isSwitchRefused && (
        <p className="flex gap-1.5 px-3 pt-2 type-caption text-subtle-foreground">
          <Warning className="mt-0.5 size-3.5 shrink-0 text-warning" />
          {projectName(root)} has uncommitted changes. Commit or stash them to switch branches; until then the thread stays on {list?.current ?? 'the current branch'}.
        </p>
      )}
      <CommandList className="max-h-64">
        <CommandEmpty>{list ? 'No branch matches' : 'Reading branches…'}</CommandEmpty>
        {local.length > 0 && <BranchGroup heading={heading} branches={local} {...rows} />}
        {local.length > 0 && remote.length > 0 && <CommandSeparator />}
        {remote.length > 0 && <BranchGroup heading="Remote" branches={remote} {...rows} />}
      </CommandList>
    </Command>
  );
}

interface BranchRowsProps {
  list: BranchList | undefined;
  selected: string | undefined;
  onChoose: (name: string) => void;
  blockedBy: (b: Branch) => string | undefined;
  isLocked: (b: Branch) => boolean;
}

function BranchGroup({ heading, branches, list, selected, onChoose, blockedBy, isLocked }: BranchRowsProps & { heading: string; branches: Branch[] }) {
  return (
    <CommandGroup heading={heading}>
      {branches.map((b) => {
        const at = blockedBy(b);
        return (
          <CommandItem key={b.name} value={b.name} disabled={!!at || isLocked(b)} data-checked={b.name === selected} onSelect={() => onChoose(b.name)}>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate">{b.name}</span>
              <span className="truncate type-caption text-subtle-foreground">{at ? `In use at ${at}` : list && branchMeta(b, list)}</span>
            </span>
          </CommandItem>
        );
      })}
    </CommandGroup>
  );
}

function branchMeta(b: Branch, list: BranchList) {
  const tags = [b.name === list.current && 'current', b.name === list.defaultBranch && 'default'].filter(Boolean);
  return [...tags, timeAgo((Date.now() - b.committedAt) / 60_000)].join(' · ');
}

/** The new branch's name, and the switch to check out an existing branch instead. */
function WorktreeFooter({ workspace }: { workspace: Workspace }) {
  const { draft, onChange, branch, error } = workspace;
  const id = useId();
  const isNew = !draft.isExisting;
  return (
    <div className="flex flex-col gap-2 border-t p-3">
      {isNew && (
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${id}-name`} className="type-caption text-subtle-foreground">
            New branch
          </Label>
          <BranchNameInput id={`${id}-name`} value={branch ?? ''} isInvalid={!!error} describedBy={`${id}-error`} onCommit={(name) => onChange({ ...draft, branch: name })} />
          {!!error && (
            <p id={`${id}-error`} className="type-caption text-destructive">
              {error}
            </p>
          )}
        </div>
      )}
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={`${id}-existing`} className="font-normal">
          Check out an existing branch
        </Label>
        <Switch id={`${id}-existing`} size="sm" checked={!!draft.isExisting} onCheckedChange={(on) => onChange(on ? { mode: 'worktree', isExisting: true } : { mode: 'worktree' })} />
      </div>
    </div>
  );
}

/** Commits on blur or Enter, so a half-typed name is never checked or used. */
function BranchNameInput({ id, value, isInvalid, describedBy, onCommit }: { id: string; value: string; isInvalid: boolean; describedBy: string; onCommit: (name: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const commit = () => text.trim() !== value && onCommit(text.trim());
  return (
    <Input
      id={id}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), commit())}
      aria-invalid={isInvalid || undefined}
      aria-describedby={isInvalid ? describedBy : undefined}
      spellCheck={false}
      autoCapitalize="off"
      autoCorrect="off"
    />
  );
}

/** One line under the meta row for what the choice will do that you'd want to know first. */
export function WorkspaceNotes({ workspace }: { workspace: Workspace }) {
  const { draft, branches, sharers, error, root } = workspace;
  const notes = [
    draft.mode === 'folder' && sharers.length > 0 && `${sharers.length === 1 ? `"${sharers[0].title}" is` : `${sharers.length} threads are`} already working in ${projectName(root)}; both edit the same files.`,
    draft.mode === 'folder' && branches.list?.isDirty && `${projectName(root)} has uncommitted changes; the agent works on top of them.`,
    !!branches.error && `${projectName(root)} isn't a git repository, so the agent works in the folder itself.`,
    error,
  ].filter((n): n is string => !!n);
  if (!notes.length) return null;
  return (
    <ul role="status" className="flex flex-col gap-0.5 px-2 pb-1 type-caption text-subtle-foreground">
      {notes.map((note) => (
        <li key={note} className="flex gap-1.5">
          <Warning className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden />
          {note}
        </li>
      ))}
    </ul>
  );
}

function useBranches(root: string) {
  const [state, setState] = useState<{ root: string; list?: BranchList; error?: string }>({ root });
  const refresh = useCallback(() => {
    if (!root) return;
    host.git.branches(root).then(
      (list) => setState({ root, list }),
      (error: Error) => setState({ root, error: error.message }),
    );
  }, [root]);
  useEffect(refresh, [refresh]);
  return state.root === root ? { list: state.list, error: state.error, refresh } : { refresh };
}

function useBranchNameError(root: string, name: string | undefined) {
  const [result, setResult] = useState<{ key: string; error: string | null }>({ key: '', error: null });
  const key = `${root}\n${name}`;
  useEffect(() => {
    if (name === undefined) return;
    let isCurrent = true;
    const timer = setTimeout(() => {
      host.git.branchNameError(root, name).then(
        (error) => isCurrent && setResult({ key, error }),
        () => isCurrent && setResult({ key, error: null }),
      );
    }, NAME_CHECK_MS);
    return () => {
      isCurrent = false;
      clearTimeout(timer);
    };
  }, [root, name, key]);
  return name !== undefined && result.key === key ? result.error : null;
}
