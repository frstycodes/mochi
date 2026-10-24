import type { LoggedEvent } from '@mochi/domain';
import type { QueueItem, Thread } from '../../../../src/model.ts';
import { dueQueued, dueReports, dueWakes } from '../../../../src/runtime/due.ts';
import { titleRequest } from '../../../../src/utility/titles.ts';
import type { ReactorCommand } from './commands.ts';

/**
 * What Core knows of the threads: the renderer's last save of each (`thread.saved`) and the index's queue. `boot` is this
 * Core run's id, for commands whose effect lives in Core's memory and must be redone after a restart.
 */
export interface ReactorState {
  readonly threads: ReadonlyArray<Thread>;
  readonly queue: ReadonlyArray<QueueItem>;
  readonly boot: string;
}

export type Rule = (event: LoggedEvent, before: ReactorState, after: ReactorState) => ReactorCommand[];

const PUSHES_OR_OPENS = /\b(git\s+push|gh\s+pr)\b/;

/** The head of each idle thread's queue (`dueQueued`). */
export const queueRunner: Rule = (_event, _before, after) =>
  dueQueued(after).map(({ thread, message }) => ({ type: 'queue.send', key: `queue:${message.id}`, threadId: thread.id, messageId: message.id }));

/** Each finished delegated task's report, steering the parent's turn (`dueReports`). */
export const delegatedReports: Rule = (_event, _before, after) =>
  dueReports(after.threads).map(({ thread, subagent }) => ({ type: 'delegate.report', key: `report:${thread.id}:${subagent.id}`, threadId: thread.id, subagentId: subagent.id }));

/** Each idle parent whose sub-threads are all idle, once per set of notes (`dueWakes`). */
export const subThreadWakes: Rule = (_event, _before, after) =>
  dueWakes(after).map((t) => ({ type: 'subthread.wake', key: `wake:${t.id}:${hash((t.live?.notes ?? []).join('\n'))}`, threadId: t.id }));

/** Each thread set to resume at its reset, due then; armed again for every new reset. */
export const limitResumes: Rule = (_event, _before, after) =>
  after.threads.flatMap((t): ReactorCommand[] => {
    const limit = t.live?.limit;
    if (!limit?.autoResume) return [];
    return [{ type: 'limit.resume', key: `resume:${t.id}:${limit.resetsAt ?? ''}`, threadId: t.id, ...(limit.resetsAt && { resetsAt: limit.resetsAt }) }];
  });

/** A title for each live thread main couldn't name before its start, once its first exchange is over (`titleRequest`). */
export const autoTitles: Rule = (_event, _before, after) =>
  after.threads.flatMap((t): ReactorCommand[] => {
    const prompt = titleRequest(t);
    return prompt ? [{ type: 'title.generate', key: `title:${t.id}`, threadId: t.id, spaceId: t.spaceId, prompt }] : [];
  });

/**
 * Each live Claude thread's compaction instructions, again when its goal changes and after every Core start (Claude's
 * PreCompact hook reads them from Core's memory). The window adds the pins, which only it holds, and resends on a pin change.
 */
export const compactInstructions: Rule = (_event, _before, after) =>
  after.threads.flatMap((t): ReactorCommand[] => {
    if (!t.live || t.session?.provider !== 'claude') return [];
    const goal = [t.goal, ...(t.criteria ?? []).map((c) => c.text)].join('\n');
    return [{ type: 'compact.instructions', key: `compact:${after.boot}:${t.id}:${hash(goal)}`, threadId: t.id }];
  });

/** A turn's end gathers its idle record: checks, uncommitted files, the audit. */
export const idleChecks: Rule = (event) => (event.threadId ? [{ type: 'idle.gather', key: `idle:${event.sequence}`, threadId: event.threadId }] : []);

/** A turn's end simplifies its last reply when Settings › Simplify › auto says so; the window holds that setting. */
export const autoSimplify: Rule = (event) => (event.threadId ? [{ type: 'simplify.auto', key: `simplify:${event.sequence}`, threadId: event.threadId }] : []);

/** A tool that pushes or opens a PR makes Core read the branch's PRs now and fast while CI runs. */
export const prSync: Rule = (event) => {
  const tool = event.payload as { phase?: string; text?: string } | null;
  if (!event.threadId || tool?.phase !== 'start' || !PUSHES_OR_OPENS.test(tool.text ?? '')) return [];
  return [{ type: 'pr.refresh', key: `pr:${event.sequence}`, threadId: event.threadId }];
};

/** A deleted thread's drafts go with it. */
export const draftsPrune: Rule = (event) => (event.threadId ? [{ type: 'drafts.prune', key: `drafts:${event.threadId}`, threadId: event.threadId }] : []);

/** Rules by the event type they react to. */
export const RULES: Readonly<Record<string, ReadonlyArray<Rule>>> = {
  'thread.saved': [queueRunner, delegatedReports, subThreadWakes, limitResumes, autoTitles, compactInstructions],
  'thread.deleted': [draftsPrune],
  'agent.turn-end': [idleChecks, autoSimplify],
  'agent.tool': [prSync],
};

export const react = (event: LoggedEvent, before: ReactorState, after: ReactorState) => (RULES[event.type] ?? []).flatMap((rule) => rule(event, before, after));

/** FNV-1a: a short key for text that would make a long one. */
function hash(text: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36);
}
