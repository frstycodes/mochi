import { lazy, Suspense, useState, type KeyboardEvent, type ReactNode } from 'react';
import { MultiFileDiff } from '@pierre/diffs/react';
import { useTheme } from 'next-themes';
import { AlertTriangle, Code, Document, Export, Eye } from 'reicon-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { EDITOR_NAMES, openInEditor, useInstalledEditors } from './editors';
import { previewKind } from './kinds';
import { FilePreview } from './previews';
import { useOpenFile, type OpenFile } from './useFiles';
import { isMod } from '../keys';
import { TooltipIconButton } from '../ui';

// Lazy so CodeMirror parses only when a file is first opened as source.
const CodeEditor = lazy(() => import('./CodeEditor'));

export function FileView({ root, path, line, toolbar }: { root: string; path: string; line?: number; toolbar: ReactNode }) {
  const file = useOpenFile(root, path);
  const kind = previewKind(path);
  const hasSource = file.content?.kind === 'text';
  const [mode, setMode] = useState<'preview' | 'source'>(kind && !line ? 'preview' : 'source');
  const [isComparing, setIsComparing] = useState(false);
  const showsPreview = !!kind && (!hasSource || mode === 'preview');
  const onKeyDown = (e: KeyboardEvent) => {
    if (!isMod(e) || e.key !== 's') return;
    e.preventDefault();
    void file.save();
  };
  return (
    <div className="flex h-full min-h-0 flex-col" onKeyDown={onKeyDown}>
      <header className="flex h-11 shrink-0 items-center gap-1.5 px-2">
        {toolbar}
        <FilePath path={path} />
        {file.isDirty && <span role="status" aria-label="Unsaved changes" className="size-1.5 shrink-0 rounded-full bg-foreground" />}
        <span className="flex-1" />
        {!!kind && hasSource && (
          <ToggleGroup type="single" size="sm" value={mode} onValueChange={(v) => v && setMode(v as typeof mode)} aria-label="View">
            <ToggleGroupItem value="preview" aria-label="Preview">
              <Eye />
            </ToggleGroupItem>
            <ToggleGroupItem value="source" aria-label="Source">
              <Code />
            </ToggleGroupItem>
          </ToggleGroup>
        )}
        {file.isDirty && (
          <Button size="sm" variant="secondary" disabled={file.isSaving} onClick={() => void file.save()}>
            Save
          </Button>
        )}
        <OpenInMenu root={root} path={path} line={line} />
      </header>
      {!!file.conflict && <ConflictBar file={file} isComparing={isComparing} onCompare={() => setIsComparing(!isComparing)} />}
      <div className="min-h-0 flex-1">
        {file.conflict && isComparing ? (
          <ConflictDiff path={path} disk={file.conflict.text} mine={file.draft ?? ''} />
        ) : (
          <FileBody file={file} path={path} line={line} showsPreview={showsPreview} />
        )}
      </div>
    </div>
  );
}

function FileBody({ file, path, line, showsPreview }: { file: OpenFile; path: string; line?: number; showsPreview: boolean }) {
  const kind = previewKind(path);
  if (file.error) return <p className="p-4 type-meta text-destructive">{file.error}</p>;
  if (!file.content) return null;
  if (showsPreview && kind) return <FilePreview kind={kind} path={path} data={file.content.kind === 'text' ? (file.draft ?? '') : file.content.bytes} />;
  if (file.content.kind === 'binary') return <BinaryState />;
  return (
    <Suspense>
      <CodeEditor path={path} value={file.draft ?? ''} line={line} onChange={file.setDraft} />
    </Suspense>
  );
}

function BinaryState() {
  return (
    <Empty className="h-full">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Document />
        </EmptyMedia>
        <EmptyTitle>No preview</EmptyTitle>
        <EmptyDescription>This is a binary file or too large to edit here.</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

export function FilePath({ path }: { path: string }) {
  const slash = path.lastIndexOf('/');
  return (
    <span className="min-w-0 truncate font-mono type-meta" title={path}>
      <span className="text-subtle-foreground">{path.slice(0, slash + 1)}</span>
      <span className="text-foreground">{path.slice(slash + 1)}</span>
    </span>
  );
}

function ConflictBar({ file, isComparing, onCompare }: { file: OpenFile; isComparing: boolean; onCompare: () => void }) {
  return (
    <div role="alert" title="The file changed on disk while you had unsaved edits" className="mx-2 mb-2 flex items-center gap-2 rounded-lg bg-card py-1.5 pr-1.5 pl-2.5 type-meta shadow-[0_0_0_1px_var(--border)]">
      <AlertTriangle aria-hidden className="size-3.5 shrink-0 text-warning" />
      <span className="min-w-0 flex-1 truncate">Changed on disk</span>
      <Button size="sm" variant="ghost" onClick={onCompare}>
        {isComparing ? 'Hide diff' : 'Diff'}
      </Button>
      <Button size="sm" variant="ghost" onClick={file.takeTheirs}>
        Use disk
      </Button>
      <Button size="sm" variant="secondary" onClick={() => void file.keepMine()}>
        Keep mine
      </Button>
    </div>
  );
}

function ConflictDiff({ path, disk, mine }: { path: string; disk: string; mine: string }) {
  const { resolvedTheme } = useTheme();
  return (
    <MultiFileDiff
      oldFile={{ name: path, contents: disk }}
      newFile={{ name: path, contents: mine }}
      disableWorkerPool
      options={{ diffStyle: 'unified', disableFileHeader: true, overflow: 'scroll', themeType: resolvedTheme === 'light' ? 'light' : 'dark' }}
      style={{ '--diffs-font-family': 'var(--font-mono)', '--diffs-font-size': '12px', '--diffs-line-height': '20px' } as React.CSSProperties}
      className="h-full overflow-auto"
    />
  );
}

export function OpenInMenu({ root, path, line }: { root: string; path: string; line?: number }) {
  const editors = useInstalledEditors();
  if (editors.length === 0) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <TooltipIconButton label="Open in editor" hint={editors.map((e) => EDITOR_NAMES[e]).join(', ')}>
          <Export />
        </TooltipIconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {editors.map((editor) => (
          <DropdownMenuItem key={editor} onSelect={() => openInEditor(editor, root, path, line)}>
            Open in {EDITOR_NAMES[editor]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
