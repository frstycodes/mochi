import type {
  CommandResult,
  MirrorFrame,
  RemoteCommand,
} from '../host/types/remote.ts';
import { reducer } from '../store/root.ts';
import type { Action, State } from '../store/types.ts';
import { wireId } from './ids.ts';
import { storeActions } from './storeCommands.ts';

/** A command this device ran on one of a machine's threads, shown on its copy until a snapshot of that thread has it. */
export interface PendingRun {
  commandId: string;
  /** The machine's own id for the thread, as its frames name it. */
  threadId: string;
  actions: Action[];
  /** When it ran: the wall clock its folds stamp. */
  ms: number;
  /** Where the machine logged it, once its event or its answer says. */
  sequence?: number;
}

/** A machine's pending runs, and the sequence of each of its thread files as last sent. */
export interface Pending {
  runs: PendingRun[];
  snapshots: Record<string, number>;
}

export const NO_PENDING: Pending = { runs: [], snapshots: {} };

/** The mirror as this device shows it: each pending run folded on through the store's own reducer, in the order they ran. */
export function withPending(state: State, { runs }: Pending): State {
  return runs.reduce(
    (shown, run) =>
      run.actions.reduce(
        (s, action) => reducer(s, action, { ms: run.ms, isForeign: true }),
        shown,
      ),
    state,
  );
}

/**
 * `command` on `state` (the mirror as shown) as its machine will apply it (`storeActions`); undefined for a command that
 * isn't store actions, would fail there, or makes a thread, whose id is that machine's to give.
 */
export function pendingRun(
  command: RemoteCommand,
  state: State,
  commandId: string,
  ms: number,
): PendingRun | undefined {
  const threadId = threadOf(command, state);
  const stored = storeActions(command, state);
  if (!threadId || !stored?.result.isOk || !stored.actions.length)
    return undefined;
  const run = {
    commandId,
    threadId: wireId(threadId),
    actions: stored.actions,
    ms,
  };
  const ids = new Set(state.threads.map((t) => t.id));
  const shown = withPending(state, { runs: [run], snapshots: {} });
  return shown.threads.every((t) => ids.has(t.id)) ? run : undefined;
}

function threadOf(command: RemoteCommand, state: State) {
  if ('threadId' in command && command.threadId) return command.threadId;
  const queueId =
    command.type === 'resolve'
      ? command.queueId
      : command.type === 'seen'
        ? command.queueIds?.[0]
        : undefined;
  return state.queue.find((q) => q.id === queueId)?.threadId;
}

export const pendingAdded = (pending: Pending, run: PendingRun): Pending => ({
  ...pending,
  runs: [...pending.runs, run],
});

/** A run stops showing at the first snapshot of its thread at or past where it was logged; a deleted thread takes its runs. */
export function pendingAfter(pending: Pending, frame: MirrorFrame): Pending {
  if (frame.type === 'reset') return { ...pending, snapshots: {} };
  if (frame.type === 'logged')
    return located(pending, frame.commandId, frame.sequence);
  const { threadId, saved, sequence } = frame;
  return {
    runs: pending.runs.filter(
      (run) =>
        run.threadId !== threadId || (saved !== null && !isIn(run, sequence)),
    ),
    snapshots: { ...pending.snapshots, [threadId]: sequence },
  };
}

/** A failure drops the run; so does a machine that doesn't say where it logged it (an older version). */
export function pendingAnswered(
  pending: Pending,
  commandId: string,
  result: CommandResult,
): Pending {
  if (result.isOk && result.sequence !== undefined)
    return located(pending, commandId, result.sequence);
  return {
    ...pending,
    runs: pending.runs.filter((run) => run.commandId !== commandId),
  };
}

/** Its answer can come after the snapshot that has it: then it stops showing now. */
function located(pending: Pending, commandId: string, sequence: number) {
  return {
    ...pending,
    runs: pending.runs.flatMap((run) => {
      if (run.commandId !== commandId) return [run];
      const logged = { ...run, sequence };
      const snapshot = pending.snapshots[run.threadId];
      return snapshot !== undefined && isIn(logged, snapshot) ? [] : [logged];
    }),
  };
}

const isIn = (run: PendingRun, snapshot: number) =>
  run.sequence !== undefined && run.sequence <= snapshot;
