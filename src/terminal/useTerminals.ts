import { useEffect, useMemo } from 'react';
import type { Thread } from '../model';
import { useHarness } from '../store';
import { usePorts } from './ports';
import { clearFailure, ensureGroup, feedAgent, useTerminalGroup, type TerminalSession } from './sessions';
import { usePaneOpeners } from './usePaneOpeners';

export function useTerminals(thread: Thread, tabId: string, cwd: string) {
  const { dispatch } = useHarness();
  const key = `${thread.id}/${tabId}`;
  const openers = usePaneOpeners(thread.id);
  const context = useMemo(() => ({ cwd, threadId: thread.id, links: openers }), [cwd, thread.id, openers]);
  const group = useTerminalGroup(key);
  usePorts(thread.id, cwd, openers.openPort);
  useEffect(() => ensureGroup(key, context), [key, context]);

  const runs = useMemo(() => agentRuns(thread), [thread]);
  const agent = group?.sessions.find((s) => s.kind === 'agent');
  useEffect(() => {
    if (agent) feedAgent(agent, runs);
  }, [agent, runs]);

  const say = (text: string) => dispatch({ type: 'say', threadId: thread.id, entry: { who: 'you', kind: 'message', text } });
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
      say(`This command failed with exit ${session.failure.exitCode}. Please fix it:\n\`\`\`\n${session.failure.output}\n\`\`\``);
      clearFailure(key, session.id);
    },
  };
}

function agentRuns(thread: Thread) {
  return thread.activity.filter((a) => a.kind === 'tool' && a.text.startsWith('Run ')).map((a) => ({ who: a.who, command: a.text.slice(4) }));
}
