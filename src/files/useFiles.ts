import { useCallback, useEffect, useRef, useState } from 'react';
import { host } from '@/host';
import type { FileContent } from '@/host/types/fs';

const RELIST_DELAY_MS = 300;

/** The root's file list, re-listed shortly after anything under it changes. */
export function useFileList(root: string | null) {
  const [files, setFiles] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!root) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const relist = () =>
      host.fs.list(root).then(
        (list) => (setFiles(list), setError(null)),
        (e: Error) => setError(e.message),
      );
    void relist();
    void host.fs.watch(root);
    const off = host.fs.onChange((change) => {
      if (change.root !== root) return;
      clearTimeout(timer);
      timer = setTimeout(relist, RELIST_DELAY_MS);
    });
    return () => {
      off();
      clearTimeout(timer);
      void host.fs.unwatch(root);
    };
  }, [root]);
  return { files, error };
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
  const [conflict, setConflict] = useState<{ text: string; mtimeMs: number } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const latest = useRef({ content, draft });
  latest.current = { content, draft };

  useEffect(() => {
    let isCurrent = true;
    setContent(null);
    setDraft(null);
    setConflict(null);
    setError(null);
    const load = () =>
      host.fs.read(root, path).then(
        (next) => {
          if (!isCurrent) return;
          const { content: prev, draft: mine } = latest.current;
          if (prev?.kind === 'text' && next.kind === 'text' && next.text === prev.text) return;
          // Our own save can echo back through the watcher before `write` resolves: disk equal to the draft is not a conflict.
          const isDirty = mine !== null && prev?.kind === 'text' && mine !== prev.text && !(next.kind === 'text' && next.text === mine);
          if (isDirty && next.kind === 'text') return setConflict({ text: next.text, mtimeMs: next.mtimeMs });
          setContent(next);
          setDraft(null);
        },
        (e: Error) => isCurrent && setError(e.message),
      );
    void load();
    const off = host.fs.onChange((change) => change.root === root && change.path === path && void load());
    return () => {
      isCurrent = false;
      off();
    };
  }, [root, path]);

  const saved = content?.kind === 'text' ? content.text : null;
  const isDirty = draft !== null && saved !== null && draft !== saved;

  const write = useCallback(
    async (force: boolean) => {
      const { content: base, draft: text } = latest.current;
      if (base?.kind !== 'text' || text === null) return;
      setIsSaving(true);
      try {
        const result = await host.fs.write(root, path, text, { baseMtimeMs: base.mtimeMs, force });
        if (result.status === 'conflict') return setConflict({ text: result.text, mtimeMs: result.mtimeMs });
        setContent({ kind: 'text', text, mtimeMs: result.mtimeMs });
        setConflict(null);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setIsSaving(false);
      }
    },
    [root, path],
  );

  const save = useCallback(() => (isDirty ? write(false) : undefined), [isDirty, write]);
  const keepMine = useCallback(() => write(true), [write]);
  const takeTheirs = useCallback(() => {
    if (!conflict) return;
    setContent({ kind: 'text', ...conflict });
    setDraft(null);
    setConflict(null);
  }, [conflict]);

  return { content, error, draft: draft ?? saved, isDirty, isSaving, conflict, setDraft, save, keepMine, takeTheirs };
}
