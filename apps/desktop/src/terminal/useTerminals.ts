import { useEffect } from 'react';
import type { Thread } from '../model';
import { useThreadOrigin } from '../remote/origin';
import { ptyTransportFor } from '../remote/remotePty';
import { useDispatch } from '../store';
import { usePorts } from './ports';
import {
  clearFailure,
  ensureGroup,
  feedAgent,
  useTerminalGroup,
  type TerminalSession,
} from './sessions';
import { usePaneOpeners } from './usePaneOpeners';

export function useTerminals(thread: Thread, tabId: string, cwd: string) {
  const dispatch = useDispatch();
  const key = `${thread.id}/${tabId}`;
  const openers = usePaneOpeners(thread.id);
  const origin = useThreadOrigin();
  const context = {
    cwd,
    threadId: thread.id,
    links: openers,
    transport: ptyTransportFor(origin),
  };
  const group = useTerminalGroup(key);
  // Another computer's processes aren't this one's to list.
  usePorts(thread.id, origin.kind === 'local' ? cwd : null);
  useEffect(() => ensureGroup(key, context), [key, context]);

  const runs = agentRuns(thread);
  const agent = group?.sessions.find((s) => s.kind === 'agent');
  useEffect(() => {
    if (agent) feedAgent(agent, runs);
  }, [agent, runs]);

  const say = (text: string) =>
    dispatch({
      type: 'say',
      threadId: thread.id,
      entry: { who: 'you', kind: 'message', text },
    });
  return {
    key,
    context,
    group,
    sendSelection(session: TerminalSession) {
      say(`From the terminal:\n\`\`\`\n${session.selection.trim()}\n\`\`\``);
      session.term.clearSelection();
    },
    askToFix(session: TerminalSession) {
      if (!session.failure) return;
      say(
        `This command failed with exit ${session.failure.exitCode}. Please fix it:\n\`\`\`\n${session.failure.output}\n\`\`\``,
      );
      clearFailure(key, session.id);
    },
  };
}

function agentRuns(thread: Thread) {
  return thread.activity
    .filter((a) => a.kind === 'tool' && a.text.startsWith('Run '))
    .map((a) => ({ who: a.who, command: a.text.slice(4) }));
}
