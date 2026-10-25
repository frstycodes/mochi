import { sendAction, queuedMessage, shouldQueue } from '../chat/queued.ts';
import type { DriftVerdict } from '../drift.ts';
import { reviewNote } from '../git/files.ts';
import { draftFrom } from '../goals/edit.ts';
import type { CommandResult, RemoteCommand } from '../host/types/remote.ts';
import type { Thread } from '../model.ts';
import { pinAt, pinnedThreads, togglePin } from '../reorder.ts';
import type { Action, State } from '../store/types.ts';
import { answeredBy, markAnswered } from '@mochi/domain/remote/answers';

/**
 * A device command that is only store actions: what to apply, and the device's answer. `verdict` is a send's drift verdict
 * still out, whose answer comes as `drift-verdict`. Core runs these on its own store (packages/core/src/server.ts); the rest
 * need a window's host (`runRemoteCommand`).
 */
export interface StoreCommand {
  result: CommandResult;
  actions: Action[];
  verdict?: { threadId: string; text: string; verdict: Promise<DriftVerdict> };
}

const ok: CommandResult = { isOk: true };
const done = (...actions: Action[]): StoreCommand => ({ result: ok, actions });
const fail = (error: string): StoreCommand => ({
  result: { isOk: false, error },
  actions: [],
});

/** Undefined for a command that isn't one: it runs where a window's host is. */
export function storeCommand(
  command: RemoteCommand,
  state: State,
  deviceName: string,
): StoreCommand | undefined {
  if (command.type === 'resolve') return resolve(command, state, deviceName);
  if (command.type === 'seen') {
    if (
      command.threadId &&
      !state.threads.some((t) => t.id === command.threadId)
    )
      return fail('No such thread on this machine');
    return done({
      type: 'seen',
      threadId: command.threadId,
      queueIds: command.queueIds,
    });
  }
  if (!STORE_TYPES.has(command.type)) return undefined;
  const thread = state.threads.find(
    (t) => t.id === (command as { threadId: string }).threadId,
  );
  if (!thread) return fail('No such thread on this machine');
  switch (command.type) {
    case 'send':
      return send(state, thread, command.text);
    case 'interrupt':
      return thread.live?.isWorking
        ? done({ type: 'interrupt', threadId: thread.id })
        : fail('The agent isn’t working');
    case 'fork':
      return done({ type: 'fork', threadId: thread.id, point: command.point });
    case 'rename':
      return done({
        type: 'rename',
        threadId: thread.id,
        title: command.title,
      });
    case 'edit-goal':
      return done({
        type: 'edit-goal',
        threadId: thread.id,
        draft: { ...draftFrom(thread), goal: command.goal },
      });
    case 'pin':
      return pin(state, thread, command);
    case 'settle':
      return (thread.status === 'settled') === command.isSettled
        ? done()
        : done({
            type: command.isSettled ? 'settle' : 'unsettle',
            threadId: thread.id,
          });
    case 'delete':
      return done({ type: 'delete', threadIds: [thread.id] });
    case 'comment':
      return done({
        type: 'say',
        threadId: thread.id,
        entry: {
          who: 'you',
          kind: 'message',
          text: reviewNote(
            command.path,
            command.side,
            command.line,
            command.text,
          ),
        },
      });
  }
  return undefined;
}

const STORE_TYPES = new Set<RemoteCommand['type']>([
  'send',
  'interrupt',
  'fork',
  'rename',
  'edit-goal',
  'pin',
  'settle',
  'delete',
  'comment',
]);

function resolve(
  command: Extract<RemoteCommand, { type: 'resolve' }>,
  state: State,
  deviceName: string,
): StoreCommand {
  const by = answeredBy(command.queueId);
  if (by !== undefined) return fail(`Already answered on ${by}`);
  const item = state.queue.find((q) => q.id === command.queueId);
  if (!item) return fail('This is no longer waiting for an answer');
  // `operate` answers the agent; settling reviews, runs and collisions is the thread's own business (`manage`).
  if (item.kind !== 'approval' && item.kind !== 'question')
    return fail('Only approvals and questions can be answered from a device');
  if (item.kind === 'question' && !command.answers?.length)
    return fail('A question needs answers');
  // Before applying: a second answer can arrive before the first folds.
  markAnswered(command.queueId, deviceName);
  return done({
    type: 'answer',
    queueId: command.queueId,
    answers: command.answers,
  });
}

/** The composer's path: queued behind a working agent per Settings › General › While the agent is working, otherwise sent now. */
function send(state: State, thread: Thread, text: string): StoreCommand {
  const message = queuedMessage(text, {
    mentions: [],
    isCommand: false,
    typedSkills: [],
  });
  if (shouldQueue(thread, state.context.prefs.whileWorking, false))
    return done({ type: 'queued-add', threadId: thread.id, message });
  const sent = sendAction(state, thread, message);
  return {
    ...done(sent.action),
    ...(sent.verdict instanceof Promise && {
      verdict: { threadId: thread.id, text: sent.text, verdict: sent.verdict },
    }),
  };
}

/** The sidebar's pin toggle (mod Shift P), only when it changes something. */
function pin(
  state: State,
  thread: Thread,
  { isPinned, order }: Extract<RemoteCommand, { type: 'pin' }>,
): StoreCommand {
  if (isPinned && order !== undefined) {
    if (!pinAt(state.threads, thread.spaceId, thread.id, order))
      return fail('Pinned is full; unpin a thread first');
    return done({ type: 'pin-at', threadId: thread.id, order });
  }
  const isPinnedNow = pinnedThreads(state.threads, thread.spaceId).some(
    (t) => t.id === thread.id,
  );
  if (isPinnedNow === isPinned) return done();
  const lists = togglePin(state.threads, thread.spaceId, thread.id);
  if (!lists) return fail('Pinned is full; unpin a thread first');
  return done({ type: 'reorder', ...lists, at: Date.now() });
}
