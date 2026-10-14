import type { ActivityEntry, Thread, ThreadRef } from '../model.ts';
import { MOCHI_SERVER } from '../runtime/toolTable.ts';

export const isSendCall = (entry: Pick<ActivityEntry, 'mcp'>) => entry.mcp?.server === MOCHI_SERVER && entry.mcp.tool === 'send_to_thread';

/** The same call from its logged text alone (`Mcp mochi: send_to_thread`, as `parseTool` splits it). */
export const isSendTarget = (call: { verb: string; target: string }) => call.verb === 'Mcp' && call.target === `${MOCHI_SERVER}: send_to_thread`;

/** What the receiving agent reads: the message with its sender, so it knows who wrote it. */
export const receivedPrompt = (from: ThreadRef, text: string) => `From "${from.title}": ${text}`;

/**
 * The sender's `send_to_thread` row learns what it delivered: the newest such call without a message yet.
 * GAP: matched by order, not call id (the tool runs without its call id); a call whose start event arrives after it ran keeps the generic row.
 */
export function markSent(thread: Thread, sent: ThreadRef & { text: string }): Thread {
  const i = thread.activity.findLastIndex((e) => e.kind === 'tool' && isSendCall(e) && !e.sent);
  if (i < 0) return thread;
  return { ...thread, activity: thread.activity.map((e, j) => (j === i ? { ...e, sent } : e)) };
}

const LEGACY_PREFIX = /^From "(.*?)": ([\s\S]*)$/;

/** Saves from before `from` stored another thread's message as yours with a `From "title":` prefix; the sender is found by title when it's still there. */
export function migrateReceived(threads: Thread[]): Thread[] {
  return threads.map((thread) => {
    if (!thread.activity.some(isLegacyReceived)) return thread;
    const activity = thread.activity.map((e) => {
      const match = isLegacyReceived(e) && LEGACY_PREFIX.exec(e.text);
      if (!match) return e;
      const [, title, text] = match;
      const sender = threads.find((t) => t.title === title && t.id !== thread.id);
      return { ...e, text, from: { ...(sender && { threadId: sender.id }), title } };
    });
    return { ...thread, activity };
  });
}

const isLegacyReceived = (e: ActivityEntry) => e.who === 'you' && e.kind === 'message' && !e.from && LEGACY_PREFIX.test(e.text);
