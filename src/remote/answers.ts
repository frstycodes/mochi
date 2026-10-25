// Until Settings › Remote access is read.
let machineName = 'this computer';
const MAX_ANSWERS = 1000;
/** Queue item id → where it was answered, for "Already answered on <device>". */
const answers = new Map<string, string>();

export function setMachineName(name: string) {
  machineName = name;
}

/** The first answer wins: a later one for the same item learns where it went. */
export function markAnswered(queueId: string, by: string) {
  if (answers.has(queueId)) return;
  answers.set(queueId, by);
  if (answers.size > MAX_ANSWERS) answers.delete(answers.keys().next().value!);
}

/** An answer given in this window. */
export const markOwnAnswer = (queueId: string) =>
  markAnswered(queueId, machineName);

export const answeredBy = (queueId: string) => answers.get(queueId);
