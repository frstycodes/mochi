import type { Provider } from '../../../../apps/desktop/src/model.ts';
import type { Handoff } from './handoff.ts';
import { itemText, type TranscriptItem } from './transcript.ts';

/** ~4 characters a token: no tokenizer runs here. GAP: calibrate per provider against the `usage` each turn reports. */
export const tokensOf = (text: string) => Math.ceil(text.length / 4);

/** GAP: one budget for every model; size it to the target's window minus a reply reserve once `contextMax` is known at start. */
export const PACKAGE_TOKENS = 24_000;

/** A tool output or diff longer than this is cut, head and tail kept, with a pointer to the whole. */
const MAX_DETAIL = 2_000;

const HISTORY_LINE =
  "Mochi's thread_history tool holds this thread's whole event log. What is here should be enough to go on: use the tool only when you need something it doesn't cover, such as an exact command output, a whole diff or an earlier message. Every [seq] below is an address it takes.";

export interface PackageInput {
  readonly from: Provider;
  /** The provider taking over; the same as `from` for a fresh session after a usage limit. */
  readonly to: Provider;
  readonly handoff: Handoff | null;
  readonly items: ReadonlyArray<TranscriptItem>;
  /** A resumed session already holds everything up to here; 0 for a fresh one. */
  readonly sinceSeq: number;
  /** `git status`, the diff stat, branch and HEAD, read from the worktree just now; empty when there is none. */
  readonly ground: string;
  readonly budget: number;
}

export interface ContextPackage {
  readonly text: string;
  /** `handoff by Claude, 2 recent turns, 3.1k tokens`. */
  readonly contents: string;
  readonly tokens: number;
}

/**
 * What a session starts from after a switch (`PROVIDER-SWITCH.md` §3): the handoff, then the turns after `sinceSeq` newest first
 * while they fit, each long output cut rather than dropped, then the worktree as it is now. A resumed session gets only what it
 * missed. Never fails for lack of budget: the handoff always goes, and the history tool holds the rest.
 */
export function contextPackage(input: PackageInput): ContextPackage {
  const { from, to, handoff, sinceSeq, ground, budget } = input;
  const isResumed = sinceSeq > 0;
  const header = isResumed
    ? `You are back on this thread after it ran on ${NAME[from]}. Below is what happened since you last saw it. Your user's next message follows; this is context, not a request.`
    : from === to
      ? "This thread continues in a fresh session: the previous one ran out of usage. Below is the thread so far, kept by Mochi. Your user's next message follows; this is context, not a request."
      : `This thread ran on ${NAME[from]} until now and continues with you. Below is the thread so far, kept by Mochi. Your user's next message follows; this is context, not a request.`;
  const handoffText =
    handoff &&
    `## Handoff (written by ${handoff.by === to ? 'you, from the transcript' : NAME[handoff.by]})\n${handoff.text}`;
  const worktree = ground && `## The worktree now\n${ground}`;
  const room =
    budget -
    tokensOf([header, HISTORY_LINE, handoffText, worktree].join('\n\n'));
  const recent = newestThatFit(
    input.items.filter((i) => i.seq > sinceSeq),
    room,
  );
  const recentText =
    recent.texts.length > 0 &&
    `## ${isResumed ? 'Since you left' : 'Latest turns'}${recent.isAll ? '' : ' (older ones: thread_history)'}\n${recent.texts.join('\n\n')}`;
  const text = [header, HISTORY_LINE, handoffText, recentText, worktree]
    .filter(Boolean)
    .join('\n\n');
  const tokens = tokensOf(text);
  const by = handoff && `handoff by ${NAME[handoff.by]}`;
  return { text, contents: contentsOf(by || '', recent, tokens), tokens };
}

interface Recent {
  /** Oldest first. */
  readonly texts: string[];
  readonly turns: number;
  readonly isAll: boolean;
}

/** The newest items whose text fits `room` together, each long detail cut. */
function newestThatFit(
  items: ReadonlyArray<TranscriptItem>,
  room: number,
): Recent {
  const texts: string[] = [];
  let turns = 0;
  for (const item of items.toReversed()) {
    const text = itemText(item, MAX_DETAIL);
    if (tokensOf(text) > room) break;
    room -= tokensOf(text);
    texts.unshift(text);
    if (item.kind === 'you') turns++;
  }
  return { texts, turns, isAll: texts.length === items.length };
}

const contentsOf = (lead: string, recent: Recent, tokens: number) =>
  [
    lead,
    recent.texts.length > 0 &&
      (recent.turns > 0
        ? `${recent.turns} recent ${recent.turns === 1 ? 'turn' : 'turns'}`
        : `${recent.texts.length} events`),
    `${(tokens / 1000).toFixed(1)}k tokens`,
  ]
    .filter(Boolean)
    .join(', ');

const NAME = { claude: 'Claude', codex: 'Codex' } satisfies Record<
  Provider,
  string
>;
