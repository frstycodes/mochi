import { useRef, useState, type KeyboardEvent } from 'react';
import { Folder, Search, SidebarLeft } from 'reicon-react';
import { Button } from '@/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Kbd } from '@/components/ui/kbd';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { FileTree } from '@/files/FileTree';
import { FileView } from '@/files/FileView';
import { QuickOpen } from '@/files/QuickOpen';
import { useFileList } from '@/files/useFiles';
import { threadCwd } from '@/host/cwd';
import { cn } from '@/lib/utils';
import { AskAboutFileRange } from '@/sidechat/AskInSideChat';
import type { PaneTabProps } from './tabs';

// Narrower than this, the tree and the file don't both fit, so opening a file folds the tree away.
const SIDE_BY_SIDE_MIN_WIDTH = 640;

export function FilesTab({ thread, tab }: PaneTabProps) {
  const root = threadCwd(thread);
  if (!root) return <NoFolderState />;
  return <FilesBrowser key={root} threadId={thread.id} root={root} initial={tab.file} />;
}

function FilesBrowser({ threadId, root, initial }: { threadId: string; root: string; initial?: { path: string; line?: number } }) {
  const { files, error } = useFileList(root);
  const [selected, setSelected] = useState(initial ?? null);
  const [isTreeOpen, setIsTreeOpen] = useState(!initial);
  const [isQuickOpen, setIsQuickOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const open = (path: string) => {
    setSelected({ path });
    if (container.current!.clientWidth < SIDE_BY_SIDE_MIN_WIDTH) setIsTreeOpen(false);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (!(e.metaKey || e.ctrlKey) || e.key !== 'p') return;
    e.preventDefault();
    setIsQuickOpen(true);
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
          <Button size="icon-sm" variant="ghost" aria-label="Go to file" onClick={() => setIsQuickOpen(true)}>
            <Search />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          Go to file <Kbd>⌘P</Kbd>
        </TooltipContent>
      </Tooltip>
      {!!selected && <AskAboutFileRange threadId={threadId} path={selected.path} />}
    </>
  );
  return (
    <div ref={container} className="flex h-full min-h-0" onKeyDown={onKeyDown}>
      {isTreeOpen && (
        <aside className="flex w-52 shrink-0 flex-col pt-11">
          {error ? <p className="px-3 type-meta text-destructive">{error}</p> : <FileTree files={files ?? []} selected={selected?.path ?? null} onSelect={open} />}
        </aside>
      )}
      <div className={cn('min-w-0 flex-1', isTreeOpen && 'bg-background')}>
        {selected ? (
          <FileView key={`${selected.path}:${selected.line ?? ''}`} root={root} path={selected.path} line={selected.line} toolbar={toolbar} />
        ) : (
          <NoFileState toolbar={toolbar} />
        )}
      </div>
      <QuickOpen files={files ?? []} open={isQuickOpen} onOpenChange={setIsQuickOpen} onPick={open} />
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
            Choose one from the tree or press <Kbd>⌘P</Kbd> to search.
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
