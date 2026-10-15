import { useMemo } from 'react';
import { useHarness } from '../store';
import { fileLink } from './links';
import { portUrl } from './devServer';
import type { TerminalLinks } from './sessions';

export function usePaneOpeners(threadId: string) {
  const { dispatch } = useHarness();
  return useMemo(
    () =>
      ({
        openUrl: (url: string) => dispatch({ type: 'pane-open-tab', threadId, kind: 'browser', url }),
        openFile: (link: string) => dispatch({ type: 'pane-open-tab', threadId, kind: 'files', file: fileLink(link) }),
        openPort: (port: number) => dispatch({ type: 'pane-open-tab', threadId, kind: 'browser', url: portUrl(port) }),
      }) satisfies TerminalLinks & Record<string, unknown>,
    [dispatch, threadId],
  );
}
