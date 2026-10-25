import type { LoggedEvent } from '@mochi/domain';
import type { QueueItem, Thread } from '../../../../apps/desktop/src/model.ts';
import {
  dueQueued,
  dueReports,
  dueWakes,
} from '../../../../apps/desktop/src/runtime/due.ts';
import { wordCount } from '../../../../apps/desktop/src/simplify/simplify.ts';
import type { ProjectionContext } from '../../../../apps/desktop/src/store/context.ts';
import { titleRequest } from '../../../../apps/desktop/src/utility/titles.ts';
import type { ReactorCommand } from './commands.ts';

/**
 * What Core knows of the threads: its projection's threads and queue, and your prefs and pins (`context`, kept in Core's
 * settings store). `boot` is this Core run's id, for commands whose effect lives in Core's memory and must be redone after a restart.
 */
export interface ReactorState {
  readonly threads: ReadonlyArray<Thread>;
  readonly queue: ReadonlyArray<QueueItem>;
  readonly context: ProjectionContext;
  readonly boot: string;
}

export type Rule = (
  event: LoggedEvent,
  before: ReactorState,
  after: ReactorState,
) => ReactorCommand[];

const PUSHES_OR_OPENS = /\b(git\s+push|gh\s+pr)\b/;

/** The head of each idle thread's queue (`dueQueued`). */
export const queueRunner: Rule = (_event, _before, after) =>
  dueQueued(after).map(({ thread, message }) => ({
    type: 'queue.send',
    key: `queue:${message.id}`,
    threadId: thread.id,
    messageId: message.id,
  }));

/** Each finished delegated task's report, steering the parent's turn (`dueReports`). */
export const delegatedReports: Rule = (_event, _before, after) =>
  dueReports(after.threads).map(({ thread, subagent }) => ({
    type: 'delegate.report',
    key: `report:${thread.id}:${subagent.id}`,
    threadId: thread.id,
    subagentId: subagent.id,
  }));

/** Each idle parent whose sub-threads are all idle, once per set of notes (`dueWakes`). */
export const subThreadWakes: Rule = (_event, _before, after) =>
  dueWakes(after).map((t) => ({
    type: 'subthread.wake',
    key: `wake:${t.id}:${hash((t.live?.notes ?? []).join('\n'))}`,
    threadId: t.id,
  }));

/** Each thread set to resume at its reset, due then; armed again for every new reset. */
export const limitResumes: Rule = (_event, _before, after) =>
  after.threads.flatMap((t): ReactorCommand[] => {
    const limit = t.live?.limit;
    if (!limit?.autoResume) return [];
    return [
      {
        type: 'limit.resume',
        key: `resume:${t.id}:${limit.resetsAt ?? ''}`,
        threadId: t.id,
        ...(limit.resetsAt && { resetsAt: limit.resetsAt }),
      },
    ];
  });

/** A title for each live thread main couldn't name before its start, once its first exchange is over (`titleRequest`). */
export const autoTitles: Rule = (_event, _before, after) =>
  after.threads.flatMap((t): ReactorCommand[] => {
    const prompt = titleRequest(t);
    return prompt
      ? [
          {
            type: 'title.generate',
            key: `title:${t.id}`,
            threadId: t.id,
            spaceId: t.spaceId,
            prompt,
          },
        ]
      : [];
  });

/**
 * Each live Claude thread's compaction instructions, again when its goal or pins change and after every Core start (Claude's
 * PreCompact hook reads them from Core's memory).
 */
export const compactInstructions: Rule = (_event, _before, after) =>
  after.threads.flatMap((t): ReactorCommand[] => {
    if (!t.live || t.session?.provider !== 'claude') return [];
    const kept = [
      t.goal,
      ...(t.criteria ?? []).map((c) => c.text),
      JSON.stringify(after.context.pins[t.id] ?? []),
    ].join('\n');
    return [
      {
        type: 'compact.instructions',
        key: `compact:${after.boot}:${t.id}:${hash(kept)}`,
        threadId: t.id,
      },
    ];
  });

/** A turn's end gets its idle record: gathered (checks, uncommitted files, the audit) with goals on, only marked without. */
export const idleChecks: Rule = (event, _before, after) => {
  if (!event.threadId) return [];
  const type = after.context.prefs.goals ? 'idle.gather' : 'idle.mark';
  return [{ type, key: `idle:${event.sequence}`, threadId: event.threadId }];
};

/** A turn's end simplifies its last reply when Settings › Simplify › auto is on and the reply is long enough for it. */
export const autoSimplify: Rule = (event, _before, after) => {
  const { simplifyAuto, simplifyAutoWords } = after.context.prefs;
  const reply = after.threads
    .find((t) => t.id === event.threadId)
    ?.activity.findLast(
      (e) => e.kind === 'message' && (e.who === 'claude' || e.who === 'codex'),
    );
  if (
    !event.threadId ||
    !simplifyAuto ||
    !reply ||
    reply.simplified ||
    wordCount(reply.text) < simplifyAutoWords
  )
    return [];
  return [
    {
      type: 'simplify.auto',
      key: `simplify:${event.sequence}`,
      threadId: event.threadId,
    },
  ];
};

/** A tool that pushes or opens a PR makes Core read the branch's PRs now and fast while CI runs. */
export const prSync: Rule = (event) => {
  const tool = event.payload as { phase?: string; text?: string } | null;
  if (
    !event.threadId ||
    tool?.phase !== 'start' ||
    !PUSHES_OR_OPENS.test(tool.text ?? '')
  )
    return [];
  return [
    {
      type: 'pr.refresh',
      key: `pr:${event.sequence}`,
      threadId: event.threadId,
    },
  ];
};

/** A turn's end keeps the brief a provider switch starts from current; the queue keeps one job per thread, the newest. */
export const briefUpdates: Rule = (event) =>
  event.threadId
    ? [
        {
          type: 'brief.update',
          key: `brief:${event.sequence}`,
          threadId: event.threadId,
        },
      ]
    : [];

/** Rules over the whole state, run after each fold that changed it. */
export const STATE_RULES: ReadonlyArray<Rule> = [
  queueRunner,
  delegatedReports,
  subThreadWakes,
  limitResumes,
  autoTitles,
  compactInstructions,
];

/** Rules by the event type they react to. */
export const RULES: Readonly<Record<string, ReadonlyArray<Rule>>> = {
  'agent.turn-end': [idleChecks, autoSimplify, briefUpdates],
  'agent.tool': [prSync],
};

/** A streamed reply's tokens make nothing due: the state rules wait for the event after them. */
const STREAMED = new Set(['agent.message', 'agent.reasoning', 'agent.usage']);

export const react = (
  event: LoggedEvent,
  before: ReactorState,
  after: ReactorState,
) => [
  ...((before.threads === after.threads &&
    before.queue === after.queue &&
    before.context === after.context) ||
  STREAMED.has(event.type)
    ? []
    : STATE_RULES.flatMap((rule) => rule(event, before, after))),
  ...(RULES[event.type] ?? []).flatMap((rule) => rule(event, before, after)),
];

/** FNV-1a: a short key for text that would make a long one. */
function hash(text: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++)
    h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36);
}
