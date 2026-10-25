import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Schema } from 'effect';
import type { Switch } from '@mochi/schema';
import { itemText, type TranscriptItem } from './transcript.ts';

export const HISTORY_TOOL = 'thread_history';

export const HISTORY_TOOL_DESCRIPTION =
  "Read this thread's earlier work from Mochi's event log, including what ran before a provider switch or a compaction. op outline: the thread's chapters with their seq ranges. op read with fromSeq and toSeq: the events in that range, tool calls with their inputs and outputs, paged. op search with query: matching messages, tool inputs and outputs, each with its seq and a snippet. op get with seq or toolCallId: one item in full (a complete output or the whole diff). Check it before redoing or contradicting something done earlier in the thread.";

const Seq = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

export const HISTORY_TOOL_SHAPE = {
  op: Schema.Literals(['outline', 'read', 'search', 'get']),
  fromSeq: Schema.optionalKey(Seq),
  toSeq: Schema.optionalKey(Seq),
  query: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(200))),
  seq: Schema.optionalKey(Seq),
  toolCallId: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(256))),
};

export type HistoryArgs = Schema.Struct.Type<typeof HISTORY_TOOL_SHAPE>;

/** One `read` page; the reply says where the next one starts. */
const PAGE_CHARS = 40_000;
const READ_DETAIL = 4_000;
const MAX_HITS = 20;
const SNIPPET = 160;

/**
 * The answer to a `thread_history` call over the thread's transcript and brief. Search is a scan of this one thread's items,
 * which holds while a thread's log loads at once. ponytail: FTS5 over `events` once one thread outgrows that.
 */
export function historyAnswer(
  args: HistoryArgs,
  items: ReadonlyArray<TranscriptItem>,
  brief: Switch.StoredBrief | undefined,
): CallToolResult {
  switch (args.op) {
    case 'outline':
      return outline(items, brief);
    case 'read':
      return read(items, args.fromSeq ?? 0, args.toSeq ?? Infinity);
    case 'search':
      return args.query
        ? search(items, args.query)
        : failed('search needs a query');
    case 'get':
      return get(items, args);
  }
}

const text = (t: string): CallToolResult => ({
  content: [{ type: 'text', text: t }],
});

const failed = (t: string): CallToolResult => ({
  ...text(t),
  isError: true,
});

function outline(
  items: ReadonlyArray<TranscriptItem>,
  brief: Switch.StoredBrief | undefined,
) {
  const first = items[0]?.seq ?? 0;
  const last = items.at(-1)?.seq ?? 0;
  const chapters = (brief?.brief.chapters ?? []).map(
    (c) => `${c.fromSeq}–${c.toSeq} · ${c.line}`,
  );
  const uncovered =
    last > (brief?.throughSeq ?? 0) &&
    `${(brief?.throughSeq ?? first - 1) + 1}–${last} · not in a chapter yet: read it`;
  const lines = [...chapters, uncovered].filter(Boolean);
  return text(
    lines.length
      ? `${brief ? `Goal: ${brief.brief.goal}\n` : ''}${lines.join('\n')}`
      : 'This thread has no history yet.',
  );
}

function read(
  items: ReadonlyArray<TranscriptItem>,
  fromSeq: number,
  toSeq: number,
) {
  const range = items.filter((i) => i.seq >= fromSeq && i.seq <= toSeq);
  const page: string[] = [];
  let chars = 0;
  for (const item of range) {
    const line = itemText(item, READ_DETAIL);
    if (chars + line.length > PAGE_CHARS && page.length > 0) {
      page.push(
        `[More: read fromSeq=${item.seq}${toSeq === Infinity ? '' : ` toSeq=${toSeq}`}]`,
      );
      break;
    }
    page.push(line);
    chars += line.length;
  }
  return text(page.length ? page.join('\n\n') : 'No events in that range.');
}

function search(items: ReadonlyArray<TranscriptItem>, query: string) {
  const needle = query.toLowerCase();
  const hits = items
    .map((item) => {
      const body = `${item.text}\n${item.detail ?? ''}`;
      const at = body.toLowerCase().indexOf(needle);
      return at < 0 ? null : { item, body, at };
    })
    .filter((hit) => !!hit);
  if (!hits.length) return text(`Nothing matches "${query}".`);
  const shown = hits.slice(-MAX_HITS).map(({ item, body, at }) => {
    const start = Math.max(0, at - SNIPPET / 2);
    const snippet = body
      .slice(start, start + SNIPPET)
      .replaceAll('\n', ' ')
      .trim();
    return `[${item.seq}] ${item.kind}: …${snippet}…`;
  });
  const more =
    hits.length > MAX_HITS
      ? `\n(${hits.length - MAX_HITS} older matches: narrow the query or read a range)`
      : '';
  return text(`${shown.join('\n')}${more}`);
}

function get(items: ReadonlyArray<TranscriptItem>, args: HistoryArgs) {
  if (args.seq === undefined && !args.toolCallId)
    return failed('get needs a seq or a toolCallId');
  const item = items.find((i) =>
    args.toolCallId ? i.toolCallId === args.toolCallId : i.seq === args.seq,
  );
  // A seq inside an item (a streamed chunk, a tool's end) finds the item it belongs to.
  const within =
    item ?? items.findLast((i) => args.seq !== undefined && i.seq <= args.seq);
  return within
    ? text(itemText(within))
    : failed(`No item at ${args.toolCallId ?? `seq ${args.seq}`}`);
}
