import { useEffect, useState, type KeyboardEvent } from 'react';
import { Folder, Search, SidebarLeft } from '@/icons';
import { Button } from '@/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { FileFinder, type FileTarget } from '@/files/FileFinder';
import { FileView } from '@/files/FileView';
import { useFileList } from '@/files/useFiles';
import { threadCwd } from '@/host/cwd';
import { cn } from '@/lib/utils';
import { AskAboutFileRange } from '@/sidechat/AskInSideChat';
import { noteOpened } from './recentFiles';
import type { PaneTabProps } from './tabs';
import { BoundShortcut } from '../Shortcut';
import { commandOf } from '../keymap';

export function FilesTab({ thread, tab }: PaneTabProps) {
  const root = threadCwd(thread);
  if (!root) return <NoFolderState />;
  return <FilesBrowser key={`${tab.id}:${root}`} threadId={thread.id} root={root} initial={tab.file} />;
}

function FilesBrowser({ threadId, root, initial }: { threadId: string; root: string; initial?: FileTarget }) {
  const { files, error } = useFileList(root);
  const [selected, setSelected] = useState<FileTarget | null>(initial ?? null);
  const [isTreeOpen, setIsTreeOpen] = useState(!initial);
  const [query, setQuery] = useState('');
  const [focusKey, setFocusKey] = useState(0);
  useEffect(() => {
    if (selected) noteOpened(threadId, selected.path);
  }, [threadId, selected]);
  const open = (target: FileTarget) => setSelected(target);
  // The one Files pane switches to a file opened from the chat or a terminal without remounting, so a search in progress survives.
  const initialKey = initial && `${initial.path}:${initial.line}`;
  const [openedKey, setOpenedKey] = useState(initialKey);
  if (initialKey !== openedKey) {
    setOpenedKey(initialKey);
    if (initial) setSelected(initial);
  }
  const focusFinder = (mode: 'name' | 'contents') => {
    setIsTreeOpen(true);
    if (mode === 'contents' && !query.startsWith('?')) setQuery('?');
    if (mode === 'name' && query.startsWith('?')) setQuery('');
    setFocusKey((k) => k + 1);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    const command = commandOf(e, ['files-go-to', 'files-search']);
    if (!command) return;
    e.preventDefault();
    focusFinder(command === 'files-search' ? 'contents' : 'name');
  };
  const toolbar = (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button size="icon-sm" variant="ghost" aria-label="Toggle file tree" aria-pressed={isTreeOpen} onClick={() => setIsTreeOpen(!isTreeOpen)}>
            <SidebarLeft />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Toggle file tree</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button size="icon-sm" variant="ghost" aria-label="Go to file" onClick={() => focusFinder('name')}>
            <Search />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          Go to file <BoundShortcut command="files-go-to" />
        </TooltipContent>
      </Tooltip>
      {!!selected && <AskAboutFileRange threadId={threadId} path={selected.path} />}
    </>
  );
  return (
    <div className="flex h-full min-h-0" onKeyDown={onKeyDown}>
      {isTreeOpen && (
        <aside className={cn('flex shrink-0 flex-col', query.startsWith('?') ? 'w-72' : 'w-60')}>
          {error ? (
            <p className="px-3 pt-11 type-meta text-destructive">{error}</p>
          ) : (
            <FileFinder root={root} files={files ?? []} selected={selected?.path ?? null} query={query} onQueryChange={setQuery} focusKey={focusKey} onOpen={open} />
          )}
        </aside>
      )}
      <div className={cn('min-w-0 flex-1', isTreeOpen && 'bg-background')}>
        {selected ? (
          <FileView key={`${selected.path}:${selected.line ?? ''}:${selected.column?.join('-') ?? ''}`} root={root} path={selected.path} line={selected.line} column={selected.column} toolbar={toolbar} />
        ) : (
          <NoFileState toolbar={toolbar} />
        )}
      </div>
    </div>
  );
}

function NoFileState({ toolbar }: { toolbar: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col">
      <header className="flex h-11 shrink-0 items-center gap-1.5 px-2">{toolbar}</header>
      <Empty className="flex-1">
        <EmptyHeader>
          <EmptyTitle>Pick a file</EmptyTitle>
          <EmptyDescription>
            Choose one from the tree, press <BoundShortcut command="files-go-to" /> to go to a file or <BoundShortcut command="files-search" /> to search inside files.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  );
}

function NoFolderState() {
  return (
    <Empty className="h-full">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Folder />
        </EmptyMedia>
        <EmptyTitle>No folder for this thread</EmptyTitle>
        <EmptyDescription>Threads without a repository have no files to browse.</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
