import type { Action } from '../store/index.tsx';

/** Store actions counted into `State.streamed` by the root reducer. */
const tapped = new WeakSet<Action>();
// Until Settings › Remote access is read.
let machineName = 'this computer';
const MAX_ANSWERS = 1000;
/** Queue item id → where it was answered, for "Already answered on <device>". */
const answers = new Map<string, string>();

/** Called from `recordAction` for every store action, before it applies. */
export function tapAction(action: Action) {
  tapped.add(action);
  if (action.type === 'answer') markAnswered(action.queueId, machineName);
}

export const isTapped = (action: Action) => tapped.has(action);

export function setMachineName(name: string) {
  machineName = name;
}

/** The first answer wins: a later one for the same item learns where it went. */
export function markAnswered(queueId: string, by: string) {
  if (answers.has(queueId)) return;
  answers.set(queueId, by);
  if (answers.size > MAX_ANSWERS) answers.delete(answers.keys().next().value!);
}

export const answeredBy = (queueId: string) => answers.get(queueId);
