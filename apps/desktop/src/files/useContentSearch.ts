import { useEffect, useState } from 'react';
import { hashKey, useQuery } from '@tanstack/react-query';
import { host } from '@/host';
import type { SearchHits, SearchOptions } from '@/host/types/fs';
import { useDebounced } from '../hooks/useDebounced';
import { compileQuery } from './search';

type SearchState =
  | { files: SearchHits[]; status: 'idle' | 'searching' | 'done' | 'truncated' }
  | { files: []; status: 'error'; error: string };

export function useContentSearch(
  root: string,
  pattern: string,
  options: SearchOptions,
): SearchState {
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
  const searchQuery = useQuery({
    queryKey,
    enabled: !!settled,
    gcTime: 0,
    queryFn: async ({ signal }) => {
      try {
        compileQuery(settled, { isCaseSensitive, isRegex, isWholeWord });
      } catch {
        throw new Error('Invalid regular expression');
      }
      const files: SearchHits[] = [];
      const off = host.fs.onSearchHits((hits) => {
        if (hits.id === id) files.push(hits);
      });
      const cancel = () => {
        void host.fs.cancelSearch(id);
      };
      signal.addEventListener('abort', cancel, { once: true });
      try {
        const { isTruncated } = await host.fs.search(root, id, settled, {
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
  return (
    searchQuery.data ?? {
      files: stream.id === id ? stream.files : [],
      status: 'searching',
    }
  );
}
