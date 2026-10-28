import { useEffect, useState } from 'react';
import { hashKey, useQuery } from '@tanstack/react-query';
import { host } from '@/host';
import type { SearchHits, SearchOptions } from '@mochi/domain/host/types/fs';
import { useDebounced } from '../hooks/useDebounced';
import { compileQuery } from '@mochi/domain/files/search';
import { askMachine, remoteQuery, type ThreadIo } from '../remote/threadIo';

type SearchState =
  | { files: SearchHits[]; status: 'idle' | 'searching' | 'done' | 'truncated' }
  | { files: []; status: 'error'; error: string };

/** Hits for `pattern` under the folder: streamed in as this computer finds them, or answered whole by the thread's owner. */
export function useContentSearch(
  io: ThreadIo,
  pattern: string,
  options: SearchOptions,
): SearchState {
  const root = io.kind === 'local' ? io.root : null;
  const settled = useDebounced(pattern, 150);
  const { isCaseSensitive, isRegex, isWholeWord } = options;
  const queryKey = [
    'content-search',
    root,
    settled,
    isCaseSensitive,
    isRegex,
    isWholeWord,
  ];
  const id = hashKey(queryKey);
  const [stream, setStream] = useState<{ id: string; files: SearchHits[] }>({
    id,
    files: [],
  });
  const localQuery = useQuery({
    queryKey,
    enabled: !!settled && !!root,
    gcTime: 0,
    queryFn: async ({ signal }) => {
      checkPattern(settled, options);
      const files: SearchHits[] = [];
      const off = host.fs.onSearchHits((hits) => {
        if (hits.id === id) files.push(hits);
      });
      const cancel = () => {
        void host.fs.cancelSearch(id);
      };
      signal.addEventListener('abort', cancel, { once: true });
      try {
        const { isTruncated } = await host.fs.search(root!, id, settled, {
          isCaseSensitive,
          isRegex,
          isWholeWord,
        });
        return {
          files,
          status: isTruncated ? ('truncated' as const) : ('done' as const),
        };
      } finally {
        off();
        signal.removeEventListener('abort', cancel);
      }
    },
  });
  const remote = remoteQuery(
    io,
    ['search', settled, isCaseSensitive, isRegex, isWholeWord],
    async ({ machine, threadId }) => {
      checkPattern(settled, options);
      const { hits, isTruncated } = await askMachine(machine.id, {
        type: 'search',
        threadId,
        pattern: settled,
        isCaseSensitive,
        isRegex,
        isWholeWord,
      });
      return {
        files: hits.map((h) => ({ ...h, id })),
        status: isTruncated ? ('truncated' as const) : ('done' as const),
      };
    },
  );
  const remoteSearchQuery = useQuery({
    ...remote,
    enabled: remote.enabled && !!settled,
    gcTime: 0,
  });
  const searchQuery = root ? localQuery : remoteSearchQuery;
  useEffect(() => {
    let pending: SearchHits[] = [];
    let frame = 0;
    const off = host.fs.onSearchHits((hits) => {
      if (hits.id !== id) return;
      pending.push(hits);
      frame ||= requestAnimationFrame(() => {
        frame = 0;
        const batch = pending;
        pending = [];
        setStream((current) => ({
          id,
          files: [...(current.id === id ? current.files : []), ...batch],
        }));
      });
    });
    return () => {
      off();
      cancelAnimationFrame(frame);
    };
  }, [id]);
  if (!pattern) return { files: [], status: 'idle' };
  if (settled !== pattern) return { files: [], status: 'searching' };
  if (searchQuery.error)
    return { files: [], status: 'error', error: searchQuery.error.message };
  if (io.kind === 'remote' && !remote.enabled && !searchQuery.data)
    return {
      files: [],
      status: 'error',
      error: `${io.machine.name} is offline`,
    };
  return (
    searchQuery.data ?? {
      files: stream.id === id ? stream.files : [],
      status: 'searching',
    }
  );
}

function checkPattern(pattern: string, options: SearchOptions) {
  try {
    compileQuery(pattern, options);
  } catch {
    throw new Error('Invalid regular expression');
  }
}
