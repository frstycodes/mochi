import { useEffect, useState, type KeyboardEvent } from 'react';
import { Folder, Search, SidebarLeft } from '@/icons';
import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { FileFinder, type FileTarget } from '@/files/FileFinder';
import { FileView } from '@/files/FileView';
import { useFileList } from '@/files/useFiles';
import { IoDenied, OfflineNote } from '@/remote/IoStates';
import { useThreadIo, type ThreadIo } from '@/remote/threadIo';
import { cn } from '@/lib/utils';
import { AskAboutFileRange } from '@/sidechat/AskInSideChat';
import { noteOpened } from './recentFiles';
import type { PaneTabProps } from './tabs';
import { BoundShortcut } from '../Shortcut';
import { commandOf } from '../keymap';

export function FilesTab({ thread, tab }: PaneTabProps) {
  const io = useThreadIo(thread);
  if (!io) return <NoFolderState />;
  if (io.kind === 'denied')
    return <IoDenied title="Files aren’t shared" reason={io.reason} />;
  return (
    <FilesBrowser
      key={`${tab.id}:${io.kind === 'local' ? io.root : io.machine.id}`}
      threadId={thread.id}
      io={io}
      initial={tab.file}
    />
  );
}

function FilesBrowser({
  threadId,
  io,
  initial,
}: {
  threadId: string;
  io: ThreadIo;
  initial?: FileTarget;
}) {
  const { files, error, isTruncated } = useFileList(io);
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
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Toggle file tree"
            aria-pressed={isTreeOpen}
            onClick={() => setIsTreeOpen(!isTreeOpen)}
          >
            <SidebarLeft />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Toggle file tree</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Go to file"
            onClick={() => focusFinder('name')}
          >
            <Search />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          Go to file <BoundShortcut command="files-go-to" />
        </TooltipContent>
      </Tooltip>
      {!!selected && (
        <AskAboutFileRange threadId={threadId} path={selected.path} />
      )}
    </>
  );
  return (
    <div className="flex h-full min-h-0" onKeyDown={onKeyDown}>
      {isTreeOpen && (
        <aside
          className={cn(
            'flex shrink-0 flex-col',
            query.startsWith('?') ? 'w-72' : 'w-60',
          )}
        >
          {error ? (
            <p className="px-3 pt-11 type-meta text-destructive">{error}</p>
          ) : (
            <FileFinder
              io={io}
              files={files ?? []}
              selected={selected?.path ?? null}
              query={query}
              onQueryChange={setQuery}
              focusKey={focusKey}
              onOpen={open}
            />
          )}
          {isTruncated && (
            <p className="px-3 pb-3 type-caption text-subtle-foreground">
              Showing the first {files?.length.toLocaleString()} files
            </p>
          )}
        </aside>
      )}
      <div
        className={cn(
          'flex min-w-0 flex-1 flex-col',
          isTreeOpen && 'bg-background',
        )}
      >
        <OfflineNote io={io} />
        <div className="min-h-0 flex-1">
          {selected ? (
            <FileView
              key={`${selected.path}:${selected.line ?? ''}:${selected.column?.join('-') ?? ''}`}
              io={io}
              path={selected.path}
              line={selected.line}
              column={selected.column}
              toolbar={toolbar}
            />
          ) : (
            <NoFileState toolbar={toolbar} />
          )}
        </div>
      </div>
    </div>
  );
}

function NoFileState({ toolbar }: { toolbar: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col">
      <header className="flex h-11 shrink-0 items-center gap-1.5 px-2">
        {toolbar}
      </header>
      <Empty className="flex-1">
        <EmptyHeader>
          <EmptyTitle>Pick a file</EmptyTitle>
          <EmptyDescription>
            Choose one from the tree, press{' '}
            <BoundShortcut command="files-go-to" /> to go to a file or{' '}
            <BoundShortcut command="files-search" /> to search inside files.
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
        <EmptyDescription>
          Threads without a repository have no files to browse.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
