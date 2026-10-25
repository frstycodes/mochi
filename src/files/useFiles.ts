import { useQuery } from '@tanstack/react-query';
import { queryClient } from '../query.ts';
import { queryKeys } from '../queryKeys.ts';
import { useWatchQuery, watchKey } from '../watch/useWatchQuery.ts';
import { useEffect, useState } from 'react';
import { host } from '@/host';
import type { FileContent } from '@/host/types/fs';
import { useLatest } from '@/useLatest';

/** The root's file list, re-listed by Core when a file under it is created or deleted. */
export function useFileList(root: string | null) {
  const [filesQuery] = useWatchQuery(
    queryKeys.files.list(root),
    root ? { _tag: 'files', root } : null,
    (value) => value.files as string[],
    () => host.fs.list(root!),
  );
  return {
    files: filesQuery.data ?? null,
    error: filesQuery.error?.message ?? null,
  };
}

export type OpenFile = ReturnType<typeof useOpenFile>;

/**
 * One file's saved content plus the user's draft. A change on disk reloads a clean file silently; a dirty one keeps the
 * draft and raises `conflict` with the disk version until the user picks one.
 */
export function useOpenFile(root: string, path: string) {
  const [content, setContent] = useState<FileContent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{
    text: string;
    mtimeMs: number;
  } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const latest = useLatest({ content, draft });
  const [opened, setOpened] = useState({ root, path });
  if (opened.root !== root || opened.path !== path) {
    setOpened({ root, path });
    setContent(null);
    setDraft(null);
    setConflict(null);
    setError(null);
  }

  const contentQuery = useQuery({
    queryKey: queryKeys.files.content(root, path),
    queryFn: () => host.fs.read(root, path),
    staleTime: 0,
  });
  const [read, setRead] = useState<FileContent>();
  const next = contentQuery.data;
  if (next && next !== read) {
    setRead(next);
    const outcome = readOutcome(content, draft, next);
    if (outcome === 'conflict' && next.kind === 'text')
      setConflict({ text: next.text, mtimeMs: next.mtimeMs });
    if (outcome === 'take') {
      setContent(next);
      setDraft(null);
    }
  }
  useEffect(
    () =>
      watchKey({ _tag: 'changes', root }, (value) => {
        if (value._tag === 'changes' && value.paths.includes(path))
          void queryClient.invalidateQueries({
            queryKey: queryKeys.files.content(root, path),
          });
      }),
    [root, path],
  );

  const saved = content?.kind === 'text' ? content.text : null;
  const isDirty = draft !== null && saved !== null && draft !== saved;

  const write = async (force: boolean) => {
    const { content: base, draft: text } = latest.current;
    if (base?.kind !== 'text' || text === null) return;
    setIsSaving(true);
    try {
      const result = await host.fs.write(root, path, text, {
        baseMtimeMs: base.mtimeMs,
        force,
      });
      if (result.status === 'conflict')
        return setConflict({ text: result.text, mtimeMs: result.mtimeMs });
      setContent({ kind: 'text', text, mtimeMs: result.mtimeMs });
      setConflict(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  const save = () => (isDirty ? write(false) : undefined);
  const keepMine = () => write(true);
  const takeTheirs = () => {
    if (!conflict) return;
    setContent({ kind: 'text', ...conflict });
    setDraft(null);
    setConflict(null);
  };

  return {
    content,
    error: error ?? contentQuery.error?.message ?? null,
    draft: draft ?? saved,
    isDirty,
    isSaving,
    conflict,
    setDraft,
    save,
    keepMine,
    takeTheirs,
  };
}

/** What a fresh read from disk does to the open file: nothing when it matches, a conflict when it would replace unsaved edits, else it's taken. */
function readOutcome(
  content: FileContent | null,
  draft: string | null,
  next: FileContent,
) {
  if (
    content?.kind === 'text' &&
    next.kind === 'text' &&
    next.text === content.text
  )
    return 'same';
  const isDirty =
    draft !== null &&
    content?.kind === 'text' &&
    draft !== content.text &&
    !(next.kind === 'text' && next.text === draft);
  return isDirty && next.kind === 'text' ? 'conflict' : 'take';
}
