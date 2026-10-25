import { Option, Schema } from 'effect';
import { Switch } from '@mochi/schema';
import type { Thread } from '../../../../apps/desktop/src/model.ts';
import { itemText, type TranscriptItem } from './transcript.ts';

/** A turn that added fewer items than this leaves the brief as it is; the delta covers them verbatim at a switch. */
export const BRIEF_EVERY = 6;

/** The new events a brief job reads at most; the rest fold in on the next turn's job. */
const MAX_PROMPT_CHARS = 20_000;
const MAX_DETAIL = 400;

const FORMAT = `Fold the new events of a coding thread into its brief, for an agent that may take the thread over. Keep what still holds from the previous brief, drop what the new events made wrong, and add what they decided. Write each field in short, concrete lines: file paths, commands, branch and test names as written.
- goal: what the thread is for, as it is now understood, with its success criteria.
- decisions: each decision with its reason. ruledOut: what was tried or rejected, and why.
- state: branch, files changed and why, what is verified, what is broken.
- open: open questions and the plan's pending steps. preferences: what the user said they want or don't want.
- chapters: keep every earlier chapter unchanged, then add one or more for the new events, using their [seq] numbers, each a single line like "412–530 · migrated the auth store, tests red on refresh".
Reply with only a JSON object {"goal": string, "decisions": [string], "ruledOut": [string], "state": string, "open": [string], "preferences": [string], "chapters": [{"fromSeq": number, "toSeq": number, "line": string}]}, nothing else.`;

export interface BriefRequest {
  readonly prompt: string;
  /** The last log sequence the new brief covers. */
  readonly throughSeq: number;
}

/**
 * The prompt that folds `items` (the events after `previous.throughSeq`) into `previous`, oldest first. Past
 * `MAX_PROMPT_CHARS` it stops at the last whole item that fits: the brief's job is per turn, not per thread length.
 * `lastSeq` is the thread's latest log sequence, covered when every item fits.
 */
export function briefRequest(
  thread: Pick<Thread, 'goal' | 'steps'>,
  previous: Switch.StoredBrief | undefined,
  items: ReadonlyArray<TranscriptItem>,
  lastSeq: number,
): BriefRequest {
  const lines: string[] = [];
  let chars = 0;
  let throughSeq = lastSeq;
  for (const [i, item] of items.entries()) {
    const text = itemText(item, MAX_DETAIL);
    if (chars + text.length > MAX_PROMPT_CHARS && lines.length > 0) {
      throughSeq = items[i].seq - 1;
      break;
    }
    lines.push(text);
    chars += text.length;
  }
  const steps = thread.steps.map((s) => `- [${s.status}] ${s.title}`);
  const prompt = [
    FORMAT,
    `Previous brief:\n${previous ? JSON.stringify(previous.brief) : 'none, this is the first'}`,
    thread.goal && `The goal Mochi shows the user: ${thread.goal}`,
    steps.length > 0 && `The plan's steps:\n${steps.join('\n')}`,
    `New events:\n${lines.join('\n\n')}`,
  ]
    .filter(Boolean)
    .join('\n\n');
  return { prompt, throughSeq };
}

const decodeBrief = Schema.decodeUnknownOption(
  Schema.fromJsonString(Switch.ThreadBrief),
);

/** The JSON object in a model's reply, fences and prose around it ignored; undefined when it isn't a brief. */
export function parseBrief(text: string): Switch.ThreadBrief | undefined {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) return undefined;
  return Option.getOrUndefined(decodeBrief(text.slice(start, end + 1)));
}
