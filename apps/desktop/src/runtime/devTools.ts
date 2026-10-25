import type { AgentToolCall, AgentToolResult } from '../host/types/agent.ts';
import { turnReport } from '../goals/report.ts';
import {
  bareStates,
  idleVerdict,
  subThreadVerdicts,
} from '../goals/verdict.ts';
import { moveContext, moveFor, questionFor } from '../goals/moves.ts';
import { authorName } from '../model.ts';
import { summary, type ToolEnv } from './tools.ts';
import { decodeArgs, DEV_TOOL_TABLE, type DevToolName } from './toolTable.ts';
import { initialControls } from './startOptions.ts';

/** Only dispatched by the opt-in dev MCP endpoint; task actions match the composer. */
export async function runDevTool(
  call: AgentToolCall,
  env: ToolEnv,
): Promise<AgentToolResult> {
  try {
    if (call.name === 'start_task') {
      const args = argsOf(call, 'start_task');
      const before = env.getState();
      env.dispatch({
        type: 'create',
        title: args.prompt,
        provider: args.provider,
        project: args.project ?? null,
        controls: initialControls(args.provider, ''),
        isLive: env.isDesktop,
        isBackground: true,
      });
      const thread = env
        .getState()
        .threads.find((t) => !before.threads.some((s) => s.id === t.id))!;
      return { text: JSON.stringify(summary(thread)) };
    }
    if (call.name === 'accept_goal') {
      const { threadId } = argsOf(call, 'accept_goal');
      const thread = env.getState().threads.find((t) => t.id === threadId);
      if (thread?.proposal?.state !== 'waiting')
        throw new Error('No researched goal is waiting for acceptance');
      env.dispatch({ type: 'goal-proposal', threadId, decision: 'accept' });
      return { text: JSON.stringify({ threadId, accepted: true }) };
    }
    if (call.name === 'continue_task') {
      const args = argsOf(call, 'continue_task');
      const thread = env.getState().threads.find((t) => t.id === args.threadId);
      if (!thread) throw new Error(`No thread ${args.threadId}`);
      if (thread.status === 'settled') throw new Error('This task is settled');
      if (thread.live?.isWorking)
        throw new Error(
          'This task is still running; inspect it before continuing',
        );
      env.dispatch({
        type: 'send',
        threadId: thread.id,
        text: args.text,
        reason: 'Continued through dev MCP',
      });
      return { text: JSON.stringify({ threadId: thread.id, sent: args.text }) };
    }
    if (call.name !== 'inspect') throw new Error('Unsupported dev tool');
    const { offset = 0, limit = 50, ...args } = argsOf(call, 'inspect');
    const state = env.getState();
    if (!args.threadId)
      return { text: JSON.stringify({ threads: state.threads.map(summary) }) };
    const thread = state.threads.find((t) => t.id === args.threadId);
    if (!thread) throw new Error(`No thread ${args.threadId}`);
    const prs = bareStates(thread);
    const verdict = idleVerdict(
      thread,
      prs,
      subThreadVerdicts(state.threads, thread.id),
    );
    const context = moveContext(state.threads, thread);
    const report = turnReport(thread);
    const move =
      verdict &&
      moveFor(
        thread,
        verdict,
        prs.map((p) => p.status),
        context,
      );
    return {
      text: JSON.stringify({
        ...summary(thread),
        goal: thread.goal,
        criteria: thread.criteria,
        proposal: thread.proposal,
        plan: thread.steps,
        report,
        idle: thread.idle,
        verdict,
        nextAction: {
          move,
          question:
            verdict &&
            questionFor(
              verdict,
              move,
              report,
              authorName(thread.providers[0]),
              context,
            ),
        },
        pullRequests: thread.prs,
        isWorking: !!thread.live?.isWorking,
        waitingOnUser: state.queue.filter((q) => q.threadId === thread.id),
        transcript: thread.activity.slice(offset, offset + limit),
        totalActivity: thread.activity.length,
        nextOffset:
          offset + limit < thread.activity.length ? offset + limit : null,
      }),
    };
  } catch (error) {
    return {
      text: error instanceof Error ? error.message : String(error),
      isError: true,
    };
  }
}

function argsOf<K extends DevToolName>(call: AgentToolCall, name: K) {
  const decoded = decodeArgs<(typeof DEV_TOOL_TABLE)[K]['shape']>(
    DEV_TOOL_TABLE[name].shape,
    call.args,
  );
  if ('error' in decoded) throw new Error(decoded.error);
  return decoded.args;
}
