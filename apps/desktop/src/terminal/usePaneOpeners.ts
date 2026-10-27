import { useDispatch, type Action } from '../store';
import { fileLink } from './links';
import { portUrl } from '@mochi/domain/terminal/devServer';
import type { TerminalLinks } from './sessions';

export function usePaneOpeners(threadId: string) {
  return paneOpeners(useDispatch(), threadId);
}

/** `usePaneOpeners` outside React, for a tool call that has the store's `dispatch`. */
export function paneOpeners(
  dispatch: (action: Action) => void,
  threadId: string,
) {
  return {
    openUrl: (url: string) =>
      dispatch({ type: 'pane-open-tab', threadId, kind: 'browser', url }),
    openFile: (link: string) =>
      dispatch({
        type: 'pane-open-tab',
        threadId,
        kind: 'files',
        file: fileLink(link),
      }),
    openPort: (port: number) =>
      dispatch({
        type: 'pane-open-tab',
        threadId,
        kind: 'browser',
        url: portUrl(port),
      }),
  } satisfies TerminalLinks & Record<string, unknown>;
}
