import { v7 as uuidv7 } from 'uuid';
import { judgeDrift, type DriftVerdict } from '../drift.ts';
import { isWorking, type QueuedMessage, type QueuePause, type Thread } from '../model.ts';
import type { Prefs } from '../settings/prefsDefaults.ts';
import type { Action, State } from '../store/types.ts';
import { agentImage, shownImage } from './images.ts';
import { withReferences } from './mentions.ts';

export function pauseQueue(thread: Thread, reason: QueuePause): Thread {
  return thread.queued?.length ? { ...thread, queuePause: reason } : thread;
}

/** `ids` first in their order; anything they miss (queued meanwhile) keeps its place after them. */
export function orderQueue(queued: QueuedMessage[], ids: string[]) {
  const byId = new Map(queued.map((m) => [m.id, m]));
  return [...ids.flatMap((id) => byId.get(id) ?? []), ...queued.filter((m) => !ids.includes(m.id))];
}

/** Whether taking back `ids` (the clicked one first) stops the turn: only while the turn Send now was clicked in still runs. */
export function interruptsToSend(thread: Thread, ids: string[]) {
  const clicked = thread.steering?.find((s) => s.message.id === ids[0]);
  return !!thread.live?.isWorking && clicked?.sendNow === 'pending';
}

/**
 * The `send` a message makes, its references resolved, and the drift guard's verdict: settled now, or a promise whose answer
 * comes as `drift-verdict`. The composer, a queued message and a device's send all go through it.
 */
export function sendAction(state: Pick<State, 'threads'>, thread: Thread, message: QueuedMessage, extra?: { queuedId?: string }) {
  const { draft, images = [] } = message;
  const { text, ...references } = withReferences(draft, message.mentions, state.threads, { isCommand: message.isCommand, provider: thread.providers[0], typedSkills: message.typedSkills });
  const verdict: DriftVerdict | Promise<DriftVerdict> = judgeDrift(text, thread);
  const settled = verdict instanceof Promise ? undefined : verdict;
  const action: Extract<Action, { type: 'send' }> = {
    type: 'send',
    threadId: thread.id,
    text,
    drift: settled && settled.kind !== 'off-goal' ? settled.kind : undefined,
    reason: settled ? settled.reason : 'Checking against the goal',
    ...references,
    images: [...references.images, ...images.map(agentImage)],
    shownImages: images.map(shownImage),
    steers: true,
    typed: message,
    ...extra,
  };
  return { action, text, verdict };
}

/** Whether a message sent now waits for the turn to end: the setting, flipped for this one send while mod is held. */
export function shouldQueue(thread: Thread, whileWorking: Prefs['whileWorking'], isHeld: boolean) {
  return isWorking(thread) && (whileWorking === 'queue') !== isHeld;
}

export function queuedMessage(draft: string, fields: Omit<QueuedMessage, 'id' | 'draft'>): QueuedMessage {
  return { id: `m-${uuidv7()}`, draft, ...fields };
}
