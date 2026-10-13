import { useCallback, useEffect, useId, useState } from 'react';
import { ChevronDown, Hierarchy2, Warning } from 'reicon-react';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from '@/components/ui/command';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import { host } from '../host';
import type { Branch, BranchList } from '../host/types/git';
import { firstPrompt, type Thread } from '../model';
import { timeAgo } from '../progress';
import { projectName, projectRef } from '../projects';
import { getPrefs } from '../settings/prefs';
import { useHarness } from '../store';
import { SwitchBranchDialog } from './SwitchBranchDialog';
import { branchName, isUnstarted, uniqueBranch, type WorkspaceDraft } from './workspace';

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
  /** The project checkout has uncommitted changes. */
  isDirty: boolean;
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
  return { root, draft, onChange, branches, branch, error: isNew ? nameError : draft.isExisting && !draft.branch ? 'Pick the branch to check out' : null, sharers, isDirty: !!list?.changes.files };
}

/** A thread whose folder isn't set up yet (`isUnstarted`) can still change where it works, kept in the store; null once it started. */
export function useThreadWorkspace(thread: Thread): Workspace | null {
  const { dispatch } = useHarness();
  const repo = thread.repo;
  const isOpen = !!repo && isUnstarted(thread);
  const draft: WorkspaceDraft = { mode: repo?.mode ?? 'worktree', base: repo?.base, isExisting: repo?.isExisting, branch: repo?.branch };
  const change = (next: WorkspaceDraft) => dispatch({ type: 'workspace', threadId: thread.id, workspace: { ...next, branch: next.branch ?? (next.mode === 'folder' ? (workspace.branches.list?.current ?? undefined) : undefined) } });
  const workspace = useWorkspace(isOpen ? projectRef(repo)! : '', draft, change, firstPrompt(thread), thread.id);
  return isOpen ? workspace : null;
}

/** The meta row's workspace controls: worktree or project folder, then its branch. */
export function WorkspaceControls({ workspace }: { workspace: Workspace }) {
  return (
    <>
      <WorktreeCheckbox workspace={workspace} />
      {!workspace.branches.error && <BranchPicker workspace={workspace} />}
    </>
  );
}

/** Claude Code's worktree checkbox: checked, its own worktree; unchecked, the project folder. One click, no menu. */
function WorktreeCheckbox({ workspace }: { workspace: Workspace }) {
  const { draft, onChange } = workspace;
  const id = useId();
  return (
    <label htmlFor={id} className="flex h-6 cursor-pointer items-center gap-1.5 rounded-full px-2 font-medium text-subtle-foreground transition-colors select-none hover:text-foreground has-data-checked:text-foreground">
      <Checkbox id={id} checked={draft.mode === 'worktree'} onCheckedChange={(on) => onChange({ mode: on ? 'worktree' : 'folder' })} className="size-3.5 border-current [&_svg]:size-3!" />
      Worktree
    </label>
  );
}

/**
 * Worktree: the base a new branch starts from (and its name), or an existing branch to check out. Project folder: a branch to switch
 * to when the thread starts; with uncommitted changes the switch happens now, through the dialog that asks what to do with them.
 */
function BranchPicker({ workspace }: { workspace: Workspace }) {
  const { draft, onChange, branches, branch, isDirty } = workspace;
  const [isOpen, setOpen] = useState(false);
  const [switchTarget, setSwitchTarget] = useState<Branch | null>(null);
  const { list } = branches;
  const isNew = draft.mode === 'worktree' && !draft.isExisting;
  const label = isNew ? (draft.base ?? list?.defaultBranch) : branch;
  const choose = (b: Branch) => {
    setOpen(false);
    if (isNew) return onChange({ ...draft, base: b.name === list?.defaultBranch ? undefined : b.name });
    if (draft.mode === 'folder' && isDirty && b.name !== list?.current) return setSwitchTarget(b);
    onChange({ ...draft, branch: b.name, isExisting: draft.mode === 'worktree' || b.name !== list?.current });
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
          <Hierarchy2 />
          <span className="truncate">{isNew ? `from ${label ?? '…'}` : (label ?? 'Pick a branch')}</span>
          <ChevronDown data-icon="inline-end" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 max-w-[calc(100vw-2rem)] p-0">
        <BranchList workspace={workspace} onChoose={choose} />
        {draft.mode === 'worktree' && <WorktreeFooter workspace={workspace} />}
      </PopoverContent>
      <SwitchBranchDialog workspace={workspace} target={switchTarget} onClose={() => setSwitchTarget(null)} />
    </Popover>
  );
}

function BranchList({ workspace, onChoose }: { workspace: Workspace; onChoose: (b: Branch) => void }) {
  const { draft, branches, branch } = workspace;
  const { list } = branches;
  const isNew = draft.mode === 'worktree' && !draft.isExisting;
  const selected = isNew ? (draft.base ?? list?.defaultBranch) : branch;
  const local = list?.branches.filter((b) => !b.isRemote) ?? [];
  const remote = list?.branches.filter((b) => b.isRemote) ?? [];
  // Another checkout holding the branch blocks checking it out; the folder's own current branch is fine to stay on.
  const blockedBy = (b: Branch) => (!isNew && b.worktree && !(draft.mode === 'folder' && b.name === list?.current) ? b.worktree : undefined);
  const heading = isNew ? 'Start from' : draft.mode === 'worktree' ? 'Check out' : 'Switch to';
  const rows = { list, selected, onChoose, blockedBy };

  return (
    <Command>
      <CommandInput placeholder="Search branches" />
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
  onChoose: (b: Branch) => void;
  blockedBy: (b: Branch) => string | undefined;
}

function BranchGroup({ heading, branches, list, selected, onChoose, blockedBy }: BranchRowsProps & { heading: string; branches: Branch[] }) {
  return (
    <CommandGroup heading={heading}>
      {branches.map((b) => {
        const at = blockedBy(b);
        return (
          <CommandItem key={b.name} value={b.name} disabled={!!at} data-checked={b.name === selected} onSelect={() => onChoose(b)}>
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
  const { draft, branches, sharers, error, root, isDirty } = workspace;
  const notes = [
    draft.mode === 'folder' && sharers.length > 0 && `${sharers.length === 1 ? `"${sharers[0].title}" is` : `${sharers.length} threads are`} already working in ${projectName(root)}; both edit the same files.`,
    draft.mode === 'folder' && isDirty && `${projectName(root)} has uncommitted changes; the agent works on top of them.`,
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
