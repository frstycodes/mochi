import { useState, type ReactNode } from 'react';
import { FileIcon } from '@react-symbols/icons/utils';
import { ArrowLeft, Chart, Code, FolderOpen, Gallery, Pip, Route, SidebarRight } from 'reicon-react';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import { ItemContent, ItemMedia, ItemTitle } from '@/components/ui/item';
import { ScrollArea } from '@/components/ui/scroll-area';
import { FileView } from '@/files/FileView';
import { REVEAL_IN, revealPath } from '@/files/editors';
import { splitPath } from '../chat/imageSrc';
import { threadCwd } from '../host/cwd';
import { DiffIcon } from '../icons/panes';
import { timeAgo } from '../progress';
import { useHarness } from '../store';
import { TooltipIconButton } from '../ui';
import type { VizLanguage } from '../viz/fence';
import { useArtifacts, type FileArtifact, type VisualArtifact } from './artifacts';
import { PaneList, PaneListItem, PaneListItemTrail, PaneSection, PaneSectionHeader, PaneSectionTitle } from './PaneList';
import type { PaneTabProps } from './tabs';

export function ArtifactsTab({ thread }: PaneTabProps) {
  const { files, visuals } = useArtifacts(thread, thread.repo ? null : threadCwd(thread));
  const { state, dispatch } = useHarness();
  const [openPath, setOpenPath] = useState<string | null>(null);
  const openVisual = (visual: VisualArtifact, isPopped: boolean) => () =>
    dispatch({ type: 'pane-open-tab', threadId: thread.id, kind: 'visual', title: visual.title, visual: { language: visual.language, code: visual.code }, isPopped });
  const isEmpty = !files.length && !visuals.length;

  if (openPath) return <ArtifactFile path={openPath} onBack={() => setOpenPath(null)} />;
  return (
    <ScrollArea type="scroll" className="h-full">
      <div className="flex flex-col gap-5 p-3">
        {isEmpty && <NoArtifacts />}
        {!!files.length && (
          <PaneSection>
            <PaneSectionHeader>
              <PaneSectionTitle count={files.length}>Files</PaneSectionTitle>
            </PaneSectionHeader>
            <PaneList>
              {files.map((f) => (
                <FileItem key={f.path} file={f} age={timeAgo(state.now - f.at)} onOpen={() => setOpenPath(f.path)} />
              ))}
            </PaneList>
          </PaneSection>
        )}
        {!!visuals.length && (
          <PaneSection>
            <PaneSectionHeader>
              <PaneSectionTitle count={visuals.length}>Rendered in chat</PaneSectionTitle>
            </PaneSectionHeader>
            <PaneList>
              {visuals.map((v, i) => (
                <VisualItem key={`${v.at}:${i}`} visual={v} age={timeAgo(state.now - v.at)} onOpen={openVisual(v, false)} onPop={openVisual(v, true)} />
              ))}
            </PaneList>
          </PaneSection>
        )}
      </div>
    </ScrollArea>
  );
}

function ArtifactFile({ path, onBack }: { path: string; onBack: () => void }) {
  const { dir, name } = splitPath(path);
  const back = (
    <TooltipIconButton label="Back to artifacts" onClick={onBack}>
      <ArrowLeft />
    </TooltipIconButton>
  );
  return <FileView key={path} root={dir} path={name} toolbar={back} />;
}

function FileItem({ file, age, onOpen }: { file: FileArtifact; age: string; onOpen: () => void }) {
  const { dir, name } = splitPath(file.path);
  return (
    <PaneListItem className="relative">
      <ItemMedia className="translate-y-0 self-center">
        <FileIcon fileName={name} autoAssign aria-hidden className="size-4" />
      </ItemMedia>
      <ItemContent className="min-w-0 gap-0">
        <ItemTitle className="w-full min-w-0 font-normal">
          <RowButton label={name} onClick={onOpen} />
        </ItemTitle>
      </ItemContent>
      <PaneListItemTrail
        meta={age}
        actions={
          <RowActions>
            <TooltipIconButton label={`Show in ${REVEAL_IN}`} onClick={() => revealPath(dir, name)}>
              <FolderOpen />
            </TooltipIconButton>
          </RowActions>
        }
      />
    </PaneListItem>
  );
}

const VISUAL_ICONS = { chart: Chart, svg: Gallery, html: Code, 'harness-metro': Route, 'harness-diff': DiffIcon } satisfies Record<VizLanguage, unknown>;

function VisualItem({ visual, age, onOpen, onPop }: { visual: VisualArtifact; age: string; onOpen: () => void; onPop: () => void }) {
  const Icon = VISUAL_ICONS[visual.language];
  return (
    <PaneListItem className="relative">
      <ItemMedia className="translate-y-0 self-center">
        <Icon aria-hidden className="size-4 text-muted-foreground" />
      </ItemMedia>
      <ItemContent className="min-w-0 gap-0">
        <ItemTitle className="w-full min-w-0 font-normal">
          <RowButton label={visual.title} onClick={onOpen} />
        </ItemTitle>
      </ItemContent>
      <PaneListItemTrail
        meta={age}
        actions={
          <RowActions>
            <TooltipIconButton label="Open in side pane" hint="As a tab next to the preview and changes" onClick={onOpen}>
              <SidebarRight />
            </TooltipIconButton>
            <TooltipIconButton label="Pop out" hint="Into a floating window that follows this thread" onClick={onPop}>
              <Pip />
            </TooltipIconButton>
          </RowActions>
        }
      />
    </PaneListItem>
  );
}

// Stretched over the row (the item is `relative`) so a click anywhere opens it; `RowActions` sit above it.
function RowButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="truncate text-left after:absolute after:inset-0 focus-visible:outline-none" onClick={onClick} title={label}>
      {label}
    </button>
  );
}

function RowActions({ children }: { children: ReactNode }) {
  return <span className="relative z-10 flex items-center gap-0.5">{children}</span>;
}

function NoArtifacts() {
  return (
    <Empty className="rounded-lg bg-muted/40 p-5">
      <EmptyHeader>
        <EmptyTitle>No artifacts yet</EmptyTitle>
        <EmptyDescription>Files the agent creates outside the repo, and the charts and widgets it renders in chat, collect here.</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
