import { Schema } from 'effect';
import { Int } from './checks.ts';

const Lines = Schema.Array(Schema.String);

/** A stretch of the thread's event log, `fromSeq`–`toSeq`, in one line: what an agent reads before asking `thread_history` for it. */
export const Chapter = Schema.Struct({
  fromSeq: Int,
  toSeq: Int,
  line: Schema.String,
});
export type Chapter = typeof Chapter.Type;

/**
 * The thread as the utility model condensed it (`PROVIDER-SWITCH.md` §2), folded forward a turn at a time: what a provider the
 * thread switches to starts from.
 */
export const ThreadBrief = Schema.Struct({
  goal: Schema.String,
  decisions: Lines,
  ruledOut: Lines,
  state: Schema.String,
  open: Lines,
  preferences: Lines,
  chapters: Schema.Array(Chapter),
});
export type ThreadBrief = typeof ThreadBrief.Type;

/** A brief and the last event it covers. */
export const StoredBrief = Schema.Struct({
  throughSeq: Int,
  brief: ThreadBrief,
});
export type StoredBrief = typeof StoredBrief.Type;
