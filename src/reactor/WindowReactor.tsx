import { useEffect } from 'react';
import { pruneDrafts } from '../chat/drafts.ts';
import { usePrSync } from '../git/usePrSync.ts';
import { useRemoteBridge } from '../remote/useRemoteBridge.ts';
import {
  useDispatch,
  useGetState,
  useHarnessSelector,
} from '../store/index.tsx';

/**
 * What only a window does beside Core's reactor (packages/core/src/reactor/execute.ts): PR records for the worktrees it
 * shows, device commands that read what only a window holds, and its own storage's drafts of threads that are gone.
 */
export function WindowReactor() {
  const getState = useGetState();
  const dispatch = useDispatch();
  const threadIds = useHarnessSelector((s) =>
    s.threads.map((t) => t.id).join('\n'),
  );
  useEffect(() => pruneDrafts(new Set(threadIds.split('\n'))), [threadIds]);
  usePrSync();
  useRemoteBridge(getState, dispatch);
  return null;
}
