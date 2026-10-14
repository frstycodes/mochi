import { useEffect, useState } from 'react';
import { host } from '@/host';
import type { SearchHits, SearchOptions } from '@/host/types/fs';
import { compileQuery } from './search';

const DEBOUNCE_MS = 150;

type SearchState = { files: SearchHits[]; status: 'idle' | 'searching' | 'done' | 'truncated' } | { files: []; status: 'error'; error: string };

const IDLE: SearchState = { files: [], status: 'idle' };

/** Content hits for `pattern` under `root`, appended as the main process streams them; a new pattern or option cancels the last search. */
export function useContentSearch(root: string, pattern: string, options: SearchOptions) {
  const [state, setState] = useState<SearchState>(IDLE);
  const { isCaseSensitive, isRegex, isWholeWord } = options;
  useEffect(() => {
    if (!pattern) return setState(IDLE);
    try {
      compileQuery(pattern, { isCaseSensitive, isRegex, isWholeWord });
    } catch {
      return setState({ files: [], status: 'error', error: 'Invalid regular expression' });
    }
    const id = crypto.randomUUID();
    let isCurrent = true;
    let pending: SearchHits[] = [];
    let frame = 0;
    // One render per frame, not per file: a broad query streams hundreds of files in a burst.
    const flush = () => {
      frame = 0;
      const batch = pending;
      pending = [];
      setState((prev) => (prev.status === 'error' ? prev : { ...prev, files: [...prev.files, ...batch] }));
    };
    const off = host.fs.onSearchHits((hits) => {
      if (hits.id !== id) return;
      pending.push(hits);
      frame ||= requestAnimationFrame(flush);
    });
    setState({ files: [], status: 'searching' });
    const timer = setTimeout(() => {
      host.fs.search(root, id, pattern, { isCaseSensitive, isRegex, isWholeWord }).then(
        ({ isTruncated }) => {
          if (!isCurrent) return;
          flush();
          setState((prev) => (prev.status === 'error' ? prev : { ...prev, status: isTruncated ? 'truncated' : 'done' }));
        },
        (e: Error) => isCurrent && setState({ files: [], status: 'error', error: e.message }),
      );
    }, DEBOUNCE_MS);
    return () => {
      isCurrent = false;
      clearTimeout(timer);
      cancelAnimationFrame(frame);
      off();
      void host.fs.cancelSearch(id);
    };
  }, [root, pattern, isCaseSensitive, isRegex, isWholeWord]);
  return state;
}
