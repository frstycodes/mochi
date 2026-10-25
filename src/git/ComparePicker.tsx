import { useState } from 'react';
import { ArrowRight, Check, ChevronDown } from '@/icons';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { BranchList, DiffScope } from '../host/types/git';
import { useBranches } from './useGit';

/** What the Changes pane diffs: everything since `base` (the thread's base when unset), or only what isn't committed. */
export interface Compare {
  scope: DiffScope;
  base?: string;
}

/** The pane title's `main → working tree` switch: All changes, Uncommitted changes, or Compare against another branch. */
export function ComparePicker({
  cwd,
  compare,
  threadBase,
  onChange,
}: {
  cwd: string;
  compare: Compare;
  threadBase?: string;
  onChange: (compare: Compare) => void;
}) {
  const branches = useBranches(cwd);
  const [isOpen, setOpen] = useState(false);
  const defaultBase = threadBase ?? branches.list?.defaultBranch ?? 'base';
  const isAll = compare.scope === 'branch' && !compare.base;
  const from =
    compare.scope === 'uncommitted' ? 'HEAD' : (compare.base ?? defaultBase);

  return (
    <DropdownMenu open={isOpen} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Comparing ${from} to the working tree`}
          className="-ml-1 min-w-0 gap-1 px-1.5 font-normal text-muted-foreground"
        >
          <span className="truncate text-foreground">{from}</span>
          <ArrowRight aria-hidden className="size-3 text-subtle-foreground" />
          <span className="shrink-0">working tree</span>
          <ChevronDown
            data-icon="inline-end"
            className="text-subtle-foreground"
          />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        <DropdownMenuItem onSelect={() => onChange({ scope: 'branch' })}>
          All changes
          <MenuMeta isChecked={isAll}>{`vs ${defaultBase}`}</MenuMeta>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onChange({ scope: 'uncommitted' })}>
          Uncommitted changes
          <MenuMeta isChecked={compare.scope === 'uncommitted'} />
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            Compare against
            <span className="ml-auto truncate pl-3 text-subtle-foreground">
              {compare.base ?? defaultBase}
            </span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent collisionPadding={8} className="w-72 p-0">
            <BranchSearch
              list={branches.list}
              error={branches.error}
              chosen={compare.base}
              onChoose={(base) => {
                onChange({ scope: 'branch', base });
                setOpen(false);
              }}
            />
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function MenuMeta({
  isChecked,
  children,
}: {
  isChecked: boolean;
  children?: string;
}) {
  return (
    <span className="ml-auto flex items-center gap-1.5 pl-3 text-subtle-foreground">
      {isChecked && <Check aria-label="Selected" className="text-foreground" />}
      {children}
    </span>
  );
}

function BranchSearch({
  list,
  error,
  chosen,
  onChoose,
}: {
  list?: BranchList;
  error?: string;
  chosen?: string;
  onChoose: (branch: string) => void;
}) {
  return (
    // The menu's typeahead would eat the typed letters; Escape still reaches it to close the submenu.
    <Command onKeyDown={(e) => e.key !== 'Escape' && e.stopPropagation()}>
      <CommandInput autoFocus placeholder="Search branches" />
      <CommandList className="max-h-72">
        <CommandEmpty>
          {error ?? (list ? 'No branch matches.' : 'Reading branches…')}
        </CommandEmpty>
        {list?.branches.map((b) => (
          <CommandItem
            key={b.name}
            value={b.name}
            data-checked={b.name === chosen}
            onSelect={() => onChoose(b.name)}
          >
            <span className="truncate">{b.name}</span>
            {b.name === list.defaultBranch && (
              <span className="ml-auto shrink-0 type-caption text-subtle-foreground">
                default
              </span>
            )}
          </CommandItem>
        ))}
      </CommandList>
    </Command>
  );
}
