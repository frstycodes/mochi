import { host } from '../host/index.ts';
import type { Action } from '../store/index.tsx';

/** Store actions the remote stream has numbered; the root reducer counts them into `State.streamed`. */
const tapped = new WeakSet<Action>();
let tappedCount = 0;
/** Empty while remote is off. A fresh one each time streaming starts, so main never stitches numbers across a gap. */
let epoch = '';
// Until Settings › Devices is read.
let machineName = 'this computer';
const MAX_ANSWERS = 1000;
/** Queue item id → where it was answered, for "Already answered on <device>". */
const answers = new Map<string, string>();

/** Called from `recordAction` for every store action, before it applies. */
export function tapAction(action: Action) {
  tapped.add(action);
  tappedCount++;
  if (action.type === 'answer') markAnswered(action.queueId, machineName);
  if (epoch) host.remote.push(epoch, tappedCount, JSON.stringify(action)).catch((error: unknown) => console.error('Streaming to devices failed', error));
}

export const isTapped = (action: Action) => tapped.has(action);

/** The stream's position: a snapshot is consistent only when the committed store's `streamed` equals it. */
export const streamPosition = () => ({ epoch, seq: tappedCount });

export function setStreaming(isOn: boolean, name: string) {
  machineName = name;
  if (isOn === !!epoch) return;
  epoch = isOn ? crypto.randomUUID() : '';
}

/** The first answer wins: a later one for the same item learns where it went. */
export function markAnswered(queueId: string, by: string) {
  if (answers.has(queueId)) return;
  answers.set(queueId, by);
  if (answers.size > MAX_ANSWERS) answers.delete(answers.keys().next().value!);
}

export const answeredBy = (queueId: string) => answers.get(queueId);
