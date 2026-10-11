import { useMemo } from 'react';
import { useHarness } from '../store';
import type { TerminalLinks } from './sessions';

/** Terminal links and port actions open pane tabs: URLs in a browser tab, paths (with `:line:col`) in the Files tab via `tab.url`. */
export function usePaneOpeners(threadId: string) {
  const { dispatch } = useHarness();
  return useMemo(
    () =>
      ({
        openUrl: (url: string) => dispatch({ type: 'pane-open-tab', threadId, kind: 'browser', url }),
        openFile: (path: string) => dispatch({ type: 'pane-open-tab', threadId, kind: 'files', url: path }),
        openPort: (port: number) => dispatch({ type: 'pane-open-tab', threadId, kind: 'browser', url: portUrl(port) }),
      }) satisfies TerminalLinks & Record<string, unknown>,
    [dispatch, threadId],
  );
}

export const portUrl = (port: number) => `http://localhost:${port}`;
