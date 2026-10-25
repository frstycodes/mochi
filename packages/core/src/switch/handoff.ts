import { Effect } from 'effect';
import type { Provider } from '../../../../apps/desktop/src/model.ts';
import { contextMax } from '../../../../apps/desktop/src/runtime/models.ts';
import { tokensOf } from './package.ts';
import { itemText, type TranscriptItem } from './transcript.ts';

/** One turn on a side session of the thread, for its handoff; `resume` continues that native session. Null when nothing came back. */
export interface HandoffAsk {
  readonly provider: Provider;
  readonly model?: string;
  readonly resume?: string;
  readonly prompt: string;
}
export type AskSession = (ask: HandoffAsk) => Effect.Effect<string | null>;

export interface Handoff {
  readonly text: string;
  /** Who wrote it: the session that ran the thread, or the one taking it over. */
  readonly by: Provider;
}

export interface HandoffInput {
  readonly from: Provider;
  readonly fromModel?: string;
  /** The native session that ran the thread, to resume for its own handoff. */
  readonly fromSession?: string;
  readonly to: Provider;
  readonly model?: string;
  /** The outgoing session ran out of usage: it can't write the handoff. */
  readonly isLimited: boolean;
  readonly items: ReadonlyArray<TranscriptItem>;
}

/** A transcript up to this share of the new model's window goes in one turn; past it, in chunks of half the window. */
const ONE_TURN_SHARE = 0.6;
const CHUNK_SHARE = 0.5;
const MAX_DETAIL = 2_000;

const SECTIONS =
  'the goal and what done means; each decision and why, including reasons never written down; what was tried or ruled out, and why; the current state (branch, files changed and why, what is verified, what is broken); open questions and the next steps; what the user said they want or do not want. Be specific: file paths, commands, branch and test names as written. Markdown, no preamble.';

/**
 * The handoff a session starts from after a switch (`PROVIDER-SWITCH.md` §6). The outgoing session writes it when it can, since
 * only it still holds its own reasoning; otherwise the incoming one writes its own from the transcript, in one turn when that fits
 * its window, else folded chunk by chunk, oldest first. Null when no model answered: the package then goes without one.
 */
export const writeHandoff = (ask: AskSession, input: HandoffInput) =>
  Effect.gen(function* () {
    const { from, to } = input;
    if (from !== to && !input.isLimited && input.fromSession) {
      const own = yield* ask({
        provider: from,
        ...(input.fromModel && { model: input.fromModel }),
        resume: input.fromSession,
        prompt: `You are handing this thread over to ${NAME[to]}, another coding agent that cannot see your reasoning or this session. Write the handoff it will start from: ${SECTIONS} Do not use tools or change anything; reply with the handoff only.`,
      });
      if (own) return { text: own, by: from } satisfies Handoff;
    }
    const self = (prompt: string) =>
      ask({ provider: to, ...(input.model && { model: input.model }), prompt });
    const lines = input.items.map((i) => itemText(i, MAX_DETAIL));
    const window = contextMax(to);
    if (tokensOf(lines.join('\n\n')) <= window * ONE_TURN_SHARE) {
      const text = yield* self(
        `Below is the transcript of a coding thread you are taking over. Write the handoff you will continue from: ${SECTIONS} Do not use tools; reply with the handoff only.\n\n${lines.join('\n\n')}`,
      );
      return text ? ({ text, by: to } satisfies Handoff) : null;
    }
    let text = '';
    for (const chunk of chunks(lines, window * CHUNK_SHARE))
      text =
        (yield* self(
          `You are taking over a coding thread too long to read at once, so you read it in parts, oldest first, keeping a handoff. Update the handoff below with the next part of the transcript: keep what still holds, drop what the new part made wrong, add what it decided. The handoff covers ${SECTIONS} Do not use tools; reply with the updated handoff only.\n\nHandoff so far:\n${text || '(none yet)'}\n\nNext part:\n${chunk.join('\n\n')}`,
        )) ?? text;
    return text ? ({ text, by: to } satisfies Handoff) : null;
  });

/** `lines` in order, grouped so each group stays under `maxTokens`; a line longer than that is a group of its own. */
function chunks(lines: ReadonlyArray<string>, maxTokens: number) {
  const groups: string[][] = [];
  let size = Infinity;
  for (const line of lines) {
    if (size + tokensOf(line) > maxTokens) {
      groups.push([]);
      size = 0;
    }
    groups.at(-1)!.push(line);
    size += tokensOf(line);
  }
  return groups;
}

const NAME = { claude: 'Claude', codex: 'Codex' } satisfies Record<
  Provider,
  string
>;
