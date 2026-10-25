import type { Switch } from '@mochi/schema';
import type { Provider } from '../../../../apps/desktop/src/model.ts';
import { itemText, type TranscriptItem } from './transcript.ts';

/** ~4 characters a token: no tokenizer runs here. GAP: calibrate per provider against the `usage` each turn reports. */
export const tokensOf = (text: string) => Math.ceil(text.length / 4);

/** GAP: one budget for every model; size it to the target's window minus a reply reserve once `contextMax` is known at start. */
export const PACKAGE_TOKENS = 24_000;

/** A tool output or diff longer than this is cut, head and tail kept, with a pointer to the whole. */
const MAX_DETAIL = 2_000;

const HISTORY_LINE =
  'Earlier work in this thread is in the mcp__mochi__thread_history tool; check it before redoing or contradicting something. Every [seq] below is an address it takes.';

export interface PackageInput {
  readonly from: Provider;
  readonly brief: Switch.StoredBrief | undefined;
  readonly items: ReadonlyArray<TranscriptItem>;
  /** A resumed session already holds everything up to here; 0 for a fresh one. */
  readonly sinceSeq: number;
  /** `git status`, the diff stat, branch and HEAD, read from the worktree just now; empty when there is none. */
  readonly ground: string;
  readonly budget: number;
}

export interface ContextPackage {
  readonly text: string;
  /** `brief, 6 recent turns, 11.8k tokens`. */
  readonly contents: string;
  readonly tokens: number;
}

/**
 * What the provider a thread switched to starts from (`PROVIDER-SWITCH.md` §3): the brief, then the turns after `sinceSeq` newest
 * first while they fit, each long output cut rather than dropped, then the worktree as it is now. A resumed session that holds
 * the brief's span already gets only what it missed. Never fails for lack of budget: the brief's top and chapters are the floor.
 */
export function contextPackage(input: PackageInput): ContextPackage {
  const { from, brief, sinceSeq, ground, budget } = input;
  const isResumed = sinceSeq > 0;
  const header = isResumed
    ? `You are back on this thread after it ran on ${NAME[from]}. Below is what happened since you last saw it. Your user's next message follows; this is context, not a request.`
    : `This thread ran on ${NAME[from]} until now and continues with you. Below is the thread so far, kept by Mochi. Your user's next message follows; this is context, not a request.`;
  const worktree = ground && `## The worktree now\n${ground}`;
  const room = budget - tokensOf([header, HISTORY_LINE, worktree].join('\n\n'));
  let shown = isResumed ? NO_BRIEF : briefFor(brief?.brief, room);
  const recent = newestThatFit(
    input.items.filter((i) => i.seq > sinceSeq),
    room - tokensOf(shown.text),
  );
  // A resumed session that missed more than fits gets the brief after all, so the gap isn't silent.
  if (isResumed && !recent.isAll && brief)
    shown = { text: briefTop(brief.brief), label: 'brief outline' };
  const recentText =
    recent.texts.length > 0 &&
    `## ${isResumed ? 'Since you left' : 'Latest turns'}${recent.isAll ? '' : ' (older ones: thread_history)'}\n${recent.texts.join('\n\n')}`;
  const text = [header, HISTORY_LINE, shown.text, recentText, worktree]
    .filter(Boolean)
    .join('\n\n');
  const tokens = tokensOf(text);
  return { text, contents: contentsOf(shown.label, recent, tokens), tokens };
}

const NO_BRIEF = { text: '', label: '' };

/** The whole brief when it fits `room`, else its top and chapters. */
function briefFor(brief: Switch.ThreadBrief | undefined, room: number) {
  if (!brief) return NO_BRIEF;
  const full = briefText(brief);
  return tokensOf(full) <= room
    ? { text: full, label: 'brief' }
    : { text: briefTop(brief), label: 'brief outline' };
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

const contentsOf = (briefLabel: string, recent: Recent, tokens: number) =>
  [
    briefLabel,
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

const list = (title: string, lines: ReadonlyArray<string>) =>
  lines.length > 0 && `### ${title}\n${lines.map((l) => `- ${l}`).join('\n')}`;

const chapters = (brief: Switch.ThreadBrief) =>
  list(
    'Chapters',
    brief.chapters.map((c) => `${c.fromSeq}–${c.toSeq} · ${c.line}`),
  );

function briefText(brief: Switch.ThreadBrief) {
  return [
    `## Brief\n**Goal:** ${brief.goal}`,
    `**Current state:** ${brief.state}`,
    list('Decisions', brief.decisions),
    list('Ruled out', brief.ruledOut),
    list('Open', brief.open),
    list('User preferences', brief.preferences),
    chapters(brief),
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** The brief's top section and its chapter index: what goes when the whole brief doesn't fit. */
function briefTop(brief: Switch.ThreadBrief) {
  return [
    `## Brief\n**Goal:** ${brief.goal}`,
    `**Current state:** ${brief.state}`,
    chapters(brief),
  ]
    .filter(Boolean)
    .join('\n\n');
}
