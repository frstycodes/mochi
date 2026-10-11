import { useMemo, useState } from 'react';
import { FileIcon } from '@react-symbols/icons/utils';
import { Command, CommandDialog, CommandEmpty, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { fuzzyFiles } from './fuzzy';

export function QuickOpen({ files, open, onOpenChange, onPick }: { files: string[]; open: boolean; onOpenChange: (open: boolean) => void; onPick: (path: string) => void }) {
  const [query, setQuery] = useState('');
  const matches = useMemo(() => fuzzyFiles(files, query), [files, query]);
  const pick = (path: string) => {
    onPick(path);
    onOpenChange(false);
    setQuery('');
  };
  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Go to file" description="Search the files in this thread's folder">
      <Command shouldFilter={false}>
        <CommandInput value={query} onValueChange={setQuery} placeholder="Go to file" />
        <CommandList>
          <CommandEmpty>No file matches.</CommandEmpty>
          {matches.map((path) => (
            <QuickOpenItem key={path} path={path} onPick={pick} />
          ))}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}

function QuickOpenItem({ path, onPick }: { path: string; onPick: (path: string) => void }) {
  const slash = path.lastIndexOf('/');
  const name = path.slice(slash + 1);
  return (
    <CommandItem value={path} onSelect={() => onPick(path)} className="gap-2">
      <FileIcon fileName={name} autoAssign aria-hidden className="size-4 shrink-0" />
      <span className="shrink-0">{name}</span>
      <span className="truncate font-mono text-xs text-subtle-foreground">{path.slice(0, slash + 1)}</span>
    </CommandItem>
  );
}
