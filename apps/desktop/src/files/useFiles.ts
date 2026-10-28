import { useQuery } from '@tanstack/react-query';
import { queryClient } from '../query.ts';
import { queryKeys } from '../queryKeys.ts';
import { useWatchQuery, watchKey } from '../watch/useWatchQuery.ts';
import { useEffect, useState } from 'react';
import { host } from '@/host';
import type { FileContent, WriteResult } from '@mochi/domain/host/types/fs';
import { useLatest } from '@/useLatest';
import { askMachine, remoteQuery, type ThreadIo } from '../remote/threadIo.ts';

// Another computer's folder has no Core watch here: its list and open file are read again on these intervals instead.
const REMOTE_LIST_POLL_MS = 15_000;
const REMOTE_FILE_POLL_MS = 5000;

/** The folder's file list: re-listed by Core when a file under it is created or deleted, or polled from the owner. */
export function useFileList(io: ThreadIo | null) {
  const root = io?.kind === 'local' ? io.root : null;
  const [filesQuery] = useWatchQuery(
    queryKeys.files.list(root),
    root ? { _tag: 'files', root } : null,
    (value) => value.files as string[],
    () => host.fs.list(root!),
  );
  const remoteListQuery = useQuery(
    remoteQuery(
      io,
      ['files'],
      ({ machine, threadId }) =>
        askMachine(machine.id, { type: 'files', threadId }),
      REMOTE_LIST_POLL_MS,
    ),
  );
  if (io?.kind === 'remote')
    return {
      files: remoteListQuery.data?.paths ?? null,
      error: remoteListQuery.error?.message ?? null,
      isTruncated: !!remoteListQuery.data?.isTruncated,
    };
  return {
    files: filesQuery.data ?? null,
    error: filesQuery.error?.message ?? null,
    isTruncated: false,
  };
}

/** A path on this computer's disk as the file hooks take it. */
export const localIo = (root: string | null): ThreadIo | null =>
  root ? { kind: 'local', root } : null;

export type OpenFile = ReturnType<typeof useOpenFile>;

/**
 * One file's saved content plus the user's draft. A change on disk reloads a clean file silently; a dirty one keeps the
 * draft and raises `conflict` with the disk version until the user picks one.
 */
export function useOpenFile(io: ThreadIo, path: string) {
  const root = io.kind === 'local' ? io.root : null;
  const ioKey =
    io.kind === 'local' ? io.root : `${io.machine.id}:${io.threadId}`;
  const [content, setContent] = useState<FileContent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{
    text: string;
    mtimeMs: number;
  } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const latest = useLatest({ content, draft });
  const [opened, setOpened] = useState({ ioKey, path });
  if (opened.ioKey !== ioKey || opened.path !== path) {
    setOpened({ ioKey, path });
    setContent(null);
    setDraft(null);
    setConflict(null);
    setError(null);
  }

  const localQuery = useQuery({
    queryKey: queryKeys.files.content(root ?? '', path),
    queryFn: () => host.fs.read(root!, path),
    enabled: !!root,
    staleTime: 0,
  });
  const remoteFileQuery = useQuery({
    ...remoteQuery(
      io,
      ['file', path],
      async ({ machine, threadId }): Promise<FileContent> => ({
        kind: 'text',
        ...(await askMachine(machine.id, {
          type: 'read-file',
          threadId,
          path,
        })),
      }),
      REMOTE_FILE_POLL_MS,
    ),
    staleTime: 0,
  });
  const contentQuery = root ? localQuery : remoteFileQuery;
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
  useEffect(() => {
    if (!root) return;
    return watchKey({ _tag: 'changes', root }, (value) => {
      if (value._tag === 'changes' && value.paths.includes(path))
        void queryClient.invalidateQueries({
          queryKey: queryKeys.files.content(root, path),
        });
    });
  }, [root, path]);

  const saved = content?.kind === 'text' ? content.text : null;
  const isDirty = draft !== null && saved !== null && draft !== saved;

  const write = async (force: boolean) => {
    const { content: base, draft: text } = latest.current;
    if (base?.kind !== 'text' || text === null) return;
    setIsSaving(true);
    try {
      const result: WriteResult =
        io.kind === 'local'
          ? await host.fs.write(io.root, path, text, {
              baseMtimeMs: base.mtimeMs,
              force,
            })
          : await askMachine(io.machine.id, {
              type: 'write-file',
              threadId: io.threadId,
              path,
              text,
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
