import type { AgentAskContext, AgentAskMessage } from '../host/types/agent.ts';

// GAP: canned answer for the web build, which has no Claude Code to drive; desktop asks Claude in electron/ipc/agent.ts.
export function mockAnswer(
  context: AgentAskContext,
  messages: AgentAskMessage[],
) {
  const question = messages.findLast((m) => m.role === 'user')?.text ?? '';
  const quoted = question.match(/^> \*\*(.+?)\*\*/m)?.[1];
  const running = context.steps.find((s) => s.status === 'running');
  const done = context.steps.filter((s) => s.status === 'done').length;
  const lines = [
    quoted
      ? `Looking at the ${quoted.toLowerCase()} you quoted, in the context of **${context.title}**.`
      : `Answering from the context of **${context.title}**.`,
    '',
    `${done} of ${context.steps.length} steps are done${running ? `, and it is working on "${running.title}" now` : ''}.`,
  ];
  if (context.diff?.length) {
    lines.push(
      '',
      '| File | + | − |',
      '| --- | --: | --: |',
      ...context.diff
        .slice(0, 6)
        .map((f) => `| \`${f.path}\` | ${f.added} | ${f.removed} |`),
    );
  }
  lines.push(
    '',
    '_Preview reply: no model is connected yet, so this restates the thread instead of reasoning about it._',
  );
  return lines.join('\n');
}

/** Word-sized chunks, so the preview streams like a model would. */
export function chunks(text: string) {
  return text.match(/\S+\s*/g) ?? [];
}
