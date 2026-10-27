import type { RunTarget } from '@mochi/domain/host/types/ports';
import type { Pane } from '../model';
import type { Action } from '../store';
import { nextTabId } from '../store/panes';
import { paneOpeners } from './usePaneOpeners';

/** Runs `target` as a new shell in the thread's terminal tab, opening one if there is none. Returns where its output lands. */
export async function runTarget(
  target: RunTarget,
  { threadId, cwd, pane, dispatch }: RunContext,
) {
  const { addShell } = await import('./sessions');
  const tabs = pane?.tabs ?? [];
  const terminal = tabs.find((t) => t.kind === 'terminal' && !t.isPopped);
  const tabId = terminal?.id ?? nextTabId(tabs);
  const key = `${threadId}/${tabId}`;
  const sessionId = addShell(
    key,
    { cwd, threadId, links: paneOpeners(dispatch, threadId) },
    { title: target.name, command: target.command },
  );
  if (terminal) dispatch({ type: 'pane-select-tab', threadId, tabId });
  else dispatch({ type: 'pane-open-tab', threadId, kind: 'terminal' });
  return { key, sessionId };
}

interface RunContext {
  threadId: string;
  cwd: string;
  pane: Pane | undefined;
  dispatch: (action: Action) => void;
}
