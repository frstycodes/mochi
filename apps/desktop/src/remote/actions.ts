import type {
  RemoteCommand,
  RemoteMessage,
  RemoteThreadAction,
} from '../host/types/remote.ts';
import type { QueuedMessage } from '../model.ts';
import type { Action } from '../store/index.tsx';

/**
 * What a store action means on another computer's thread: the command that does it there, `open` for going to one of its
 * threads, or null for what a device can't do (yet). The shared UI (Queue cards, sidebar rows) dispatches as it does at home.
 */
export function commandFor(
  action: Action,
): RemoteCommand | { type: 'open'; threadId: string } | null {
  switch (action.type) {
    case 'answer':
      return {
        type: 'resolve',
        queueId: action.queueId,
        ...(action.answers && { answers: action.answers }),
      };
    case 'send':
      return sendCommand(action);
    case 'interrupt':
      return { type: 'interrupt', threadId: action.threadId };
    case 'seen':
      return {
        type: 'seen',
        ...(action.threadId && { threadId: action.threadId }),
        ...(action.queueIds && { queueIds: action.queueIds }),
      };
    case 'rename':
      return { type: 'rename', threadId: action.threadId, title: action.title };
    case 'settle':
    case 'unsettle':
      return {
        type: 'settle',
        threadId: action.threadId,
        isSettled: action.type === 'settle',
      };
    case 'handoff':
      return { type: 'handoff', threadId: action.threadId, to: action.to };
    case 'fork':
      return { type: 'fork', threadId: action.threadId, point: action.point };
    case 'rewind':
      return {
        type: 'rewind',
        threadId: action.threadId,
        point: { kind: 'checkpoint', n: action.n },
        mode: action.mode ?? 'files',
      };
    case 'rewind-message':
      return {
        type: 'rewind',
        threadId: action.threadId,
        point: { kind: 'message', index: action.index },
        mode: action.mode ?? 'files',
      };
    case 'edit-goal':
      return {
        type: 'edit-goal',
        threadId: action.threadId,
        goal: action.draft.goal,
      };
    case 'pin-at':
      return {
        type: 'pin',
        threadId: action.threadId,
        isPinned: true,
        order: action.order,
      };
    case 'delete':
      return action.threadIds.length === 1
        ? { type: 'delete', threadId: action.threadIds[0] }
        : null;
    case 'go':
      return action.view.kind === 'thread'
        ? { type: 'open', threadId: action.view.id }
        : null;
    default: {
      const threadAction = threadActionFor(action);
      return threadAction
        ? {
            type: 'thread-action',
            threadId: (action as { threadId: string }).threadId,
            action: threadAction,
          }
        : null;
    }
  }
}

/**
 * The composer's send as typed, for the thread's computer to resolve as its own composer would. Send now on a queued
 * message names it: that computer sends its own copy. A send not typed here (a card's) goes as its text, when that's all it is.
 */
function sendCommand(
  action: Extract<Action, { type: 'send' }>,
): RemoteCommand | null {
  const { threadId, typed, queuedId } = action;
  if (queuedId) return { type: 'send', threadId, text: '', queuedId };
  if (typed) {
    const { draft, ...message } = wireMessage(typed);
    return { type: 'send', threadId, text: draft, ...message, steers: true };
  }
  return action.images?.length || action.skills?.length || action.prompt
    ? null
    : { type: 'send', threadId, text: action.text };
}

/** A message as it crosses: no id (the other computer gives it one) and no path of this computer's for an image. */
export function wireMessage(message: QueuedMessage): RemoteMessage {
  return {
    draft: message.draft,
    ...(message.images?.length && {
      images: message.images.map(({ mediaType, data, thumb }) => ({
        mediaType,
        data,
        thumb,
      })),
    }),
    ...(message.mentions.length > 0 && { mentions: message.mentions }),
    ...(message.isCommand && { isCommand: true }),
    ...(message.typedSkills.length > 0 && {
      typedSkills: message.typedSkills,
    }),
  };
}

/** The thread's own actions that cross as `thread-action`; null for the rest. */
function threadActionFor(action: Action): RemoteThreadAction | null {
  switch (action.type) {
    case 'controls':
      return { type: 'controls', controls: action.controls };
    case 'provider-switch':
      return {
        type: 'provider-switch',
        to: action.to,
        ...(action.model !== undefined && { model: action.model }),
      };
    case 'compact':
      return {
        type: 'compact',
        focus: action.focus,
        ...(action.queuedId && { queuedId: action.queuedId }),
      };
    case 'queued-add':
      return { type: 'queued-add', message: wireMessage(action.message) };
    case 'queued-remove':
      return { type: 'queued-remove', id: action.id };
    case 'queued-order':
      return { type: 'queued-order', ids: action.ids };
    case 'queued-resume':
      return { type: 'queued-resume' };
    // On its API key is that computer's to choose, where the key is; a reset's resume is its own timer's.
    case 'resume':
      return action.onApiKey || action.atReset ? null : { type: 'resume' };
    case 'limit-auto-resume':
      return { type: 'limit-auto-resume', isOn: action.isOn };
    case 'grant-answer':
      return {
        type: 'grant-answer',
        grantId: action.grantId,
        answer: action.answer,
        ...(action.models && { models: action.models }),
      };
    case 'proposal-answer':
      return {
        type: 'proposal-answer',
        proposalId: action.proposalId,
        state: action.state,
      };
    case 'proposal-start':
      return { type: 'proposal-start', proposalId: action.proposalId };
    case 'goal-remove':
      return { type: 'goal-remove' };
    case 'autofix-set':
      return {
        type: 'autofix-set',
        pr: action.pr,
        isOn: action.since !== undefined,
      };
    case 'auto-archive-set':
      return { type: 'auto-archive-set', pr: action.pr, isOn: action.isOn };
    default:
      return null;
  }
}
