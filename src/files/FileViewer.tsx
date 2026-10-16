import { lazy, Suspense, useEffect, useState, type KeyboardEvent } from 'react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { FileIcon } from '@react-symbols/icons/utils';
import { ChevronLeft, ChevronRight, Code, Copy, Document, Download, Eye, SidebarRight, X } from 'reicon-react';
import { Button } from '@/components/ui/button';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import type { FileContent } from '@/host/types/fs';
import { cn } from '@/lib/utils';
import { copyText } from '../clipboard';
import { Shortcut } from '../Shortcut';
import { useHarness } from '../store';
import { TooltipIconButton } from '../ui';
import { download } from '../viz/exportVisual';
import { FilePath, OpenInMenu } from './FileView';
import { fileKind, hasTextSource, viewerBody, type ViewerBody } from './kinds';
import { FilePreview } from './previews';
import { loadViewerFile, openFiles, useFileRequest, viewerName, viewerPath, type ViewerFile } from './viewer';

const CodeEditor = lazy(() => import('./CodeEditor'));

/** Full-window viewer for files in chat and non-image composer attachments. Mounted once; `openFiles` drives it. */
export function FileViewer() {
  const request = useFileRequest();
  const [index, setIndex] = useState(0);
  useEffect(() => setIndex(request?.index ?? 0), [request]);
  const files = request?.files ?? [];
  const file = files[index];
  const step = files.length > 1 ? (by: number) => setIndex((i) => (i + by + files.length) % files.length) : undefined;
  const onKeyDown = (e: KeyboardEvent) => {
    if (!step || isTextEntry(e.target)) return;
    if (e.key === 'ArrowLeft') step(-1);
    if (e.key === 'ArrowRight') step(1);
  };

  return (
    <DialogPrimitive.Root open={!!file} onOpenChange={(open) => !open && openFiles(null)}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-background data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 motion-reduce:animate-none" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          onKeyDown={onKeyDown}
          // Focusing the first header button would pop its tooltip on open; the dialog itself still takes Esc and the arrows.
          onOpenAutoFocus={(e) => (e.preventDefault(), (e.currentTarget as HTMLElement).focus())}
          className="fixed inset-0 z-50 flex flex-col outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-[0.98] data-[state=closed]:animate-out data-[state=closed]:fade-out-0 motion-reduce:animate-none"
        >
          {!!file && <FilePane key={`${index}:${viewerPath(file)}`} file={file} position={step && `${index + 1} of ${files.length}`} onStep={step} />}
          {files.length > 1 && <FileStrip files={files} index={index} onSelect={setIndex} />}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function isTextEntry(target: EventTarget) {
  return target instanceof HTMLElement && (target.isContentEditable || target.matches('input, textarea, select'));
}

/** One file: header with its actions, then the preview, read-only source, or the can't-preview state. Keyed per file. */
function FilePane({ file, position, onStep }: { file: ViewerFile; position?: string; onStep?: (by: number) => void }) {
  const { content, error } = useViewerContent(file);
  const name = viewerName(file);
  const kind = fileKind(name, file.source === 'attachment' ? file.mediaType : undefined);
  const body = content && viewerBody(kind, content);
  const hasSourceToggle = content?.kind === 'text' && !!body && hasTextSource(body);
  const [mode, setMode] = useState<'preview' | 'source'>(file.source === 'workspace' && file.line ? 'source' : 'preview');

  return (
    <>
      <header className="app-drag flex h-11 shrink-0 items-center gap-1 px-3 in-data-traffic-lights:pl-20">
        <FileIcon fileName={name} autoAssign aria-hidden className="size-4 shrink-0" />
        <DialogPrimitive.Title className="flex min-w-0 px-1 font-normal">
          <FilePath path={viewerPath(file)} />
        </DialogPrimitive.Title>
        {!!position && <span className="shrink-0 px-1 type-meta text-subtle-foreground tabular max-sm:hidden">{position}</span>}
        {!!onStep && (
          <>
            <TooltipIconButton label="Previous file" hint={<Shortcut keys={['left']} />} onClick={() => onStep(-1)} className="max-sm:hidden">
              <ChevronLeft />
            </TooltipIconButton>
            <TooltipIconButton label="Next file" hint={<Shortcut keys={['right']} />} onClick={() => onStep(1)} className="max-sm:hidden">
              <ChevronRight />
            </TooltipIconButton>
          </>
        )}
        <span className="flex-1" />
        {hasSourceToggle && (
          <ToggleGroup type="single" size="sm" value={mode} onValueChange={(v) => v && setMode(v as typeof mode)} aria-label="View">
            <ToggleGroupItem value="preview" aria-label="Preview">
              <Eye />
            </ToggleGroupItem>
            <ToggleGroupItem value="source" aria-label="Source">
              <Code />
            </ToggleGroupItem>
          </ToggleGroup>
        )}
        <FileActions file={file} content={content} />
        <DialogPrimitive.Close asChild>
          <Button variant="ghost" size="icon-sm" aria-label="Close">
            <X />
          </Button>
        </DialogPrimitive.Close>
      </header>
      <div className="min-h-0 flex-1">
        {error ? (
          <CantPreviewState file={file} content={null} reason={error} />
        ) : (
          !!body && <FileBody file={file} content={content} body={hasSourceToggle && mode === 'source' ? 'code' : body} />
        )}
      </div>
    </>
  );
}

function FileBody({ file, content, body }: { file: ViewerFile; content: FileContent; body: ViewerBody }) {
  if (body === 'none') return <CantPreviewState file={file} content={content} reason={content.kind === 'binary' ? 'This is a binary file.' : 'This file is too large to preview.'} />;
  const data = content.kind === 'text' ? content.text : content.bytes;
  if (body !== 'code') return <FilePreview kind={body} path={viewerPath(file)} data={data} />;
  return (
    <Suspense>
      <CodeEditor readOnly path={viewerPath(file)} value={String(data)} line={file.source === 'workspace' ? file.line : undefined} />
    </Suspense>
  );
}

function FileActions({ file, content }: { file: ViewerFile; content: FileContent | null }) {
  const openInFilesTab = useOpenInFilesTab();
  return (
    <>
      {file.source === 'workspace' && (
        <>
          <TooltipIconButton label="Open in Files tab" hint="Opens it in the side pane, where you can edit it" onClick={() => openInFilesTab(file)}>
            <SidebarRight />
          </TooltipIconButton>
          <OpenInMenu root={file.root} path={file.path} line={file.line} />
          <TooltipIconButton label="Copy path" hint={file.path} onClick={() => copyText(file.path, 'Path copied')}>
            <Copy />
          </TooltipIconButton>
        </>
      )}
      <TooltipIconButton label="Download" hint={content ? undefined : 'Available once the file loads'} disabled={!content} onClick={() => content && saveFile(file, content)}>
        <Download />
      </TooltipIconButton>
    </>
  );
}

type WorkspaceFile = Extract<ViewerFile, { source: 'workspace' }>;

function useOpenInFilesTab() {
  const { dispatch } = useHarness();
  return (file: WorkspaceFile) => {
    dispatch({ type: 'pane-open-tab', threadId: file.threadId, kind: 'files', file: { path: file.path, line: file.line } });
    openFiles(null);
  };
}

function saveFile(file: ViewerFile, content: FileContent) {
  const data = content.kind === 'text' ? content.text : (content.bytes as BlobPart);
  download(viewerName(file), new Blob([data], { type: file.source === 'attachment' ? file.mediaType : undefined }));
}

function CantPreviewState({ file, content, reason }: { file: ViewerFile; content: FileContent | null; reason: string }) {
  const openInFilesTab = useOpenInFilesTab();
  return (
    <Empty className="h-full">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Document />
        </EmptyMedia>
        <EmptyTitle>Can't preview {viewerName(file)}</EmptyTitle>
        <EmptyDescription>{reason}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent className="flex-row justify-center gap-2">
        {file.source === 'workspace' && (
          <Button size="sm" variant="secondary" onClick={() => openInFilesTab(file)}>
            Open in Files tab
          </Button>
        )}
        {!!content && (
          <Button size="sm" variant="secondary" onClick={() => saveFile(file, content)}>
            Download
          </Button>
        )}
      </EmptyContent>
    </Empty>
  );
}

function useViewerContent(file: ViewerFile) {
  const [state, setState] = useState<{ content: FileContent | null; error: string | null }>({ content: null, error: null });
  useEffect(() => {
    let isCurrent = true;
    loadViewerFile(file).then(
      (content) => isCurrent && setState({ content, error: null }),
      (e: Error) => isCurrent && setState({ content: null, error: e.message }),
    );
    return () => void (isCurrent = false);
  }, [file]);
  return state;
}

function FileStrip({ files, index, onSelect }: { files: ViewerFile[]; index: number; onSelect: (i: number) => void }) {
  return (
    <nav aria-label="Files" className="flex shrink-0 gap-1.5 overflow-x-auto px-4 pt-2 pb-4 sm:justify-center">
      {files.map((f, i) => (
        <button
          key={`${viewerPath(f)}:${i}`}
          type="button"
          aria-current={i === index || undefined}
          onClick={() => onSelect(i)}
          className={cn(
            'flex h-7 max-w-48 shrink-0 items-center gap-1.5 rounded-md border px-2 type-caption transition-colors',
            i === index ? 'border-foreground/40 bg-muted text-foreground dark:bg-input' : 'border-input text-muted-foreground hover:text-foreground',
          )}
        >
          <FileIcon fileName={viewerName(f)} autoAssign aria-hidden className="size-3.5 shrink-0" />
          <span className="truncate">{viewerName(f)}</span>
        </button>
      ))}
    </nav>
  );
}
