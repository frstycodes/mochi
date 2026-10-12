import type { AgentImage } from '../host/types/agent.ts';
import type { AppWindow } from '../host/types/windows.ts';
import type { Thread } from '../model.ts';

/** What `@` in the thread composer can point at. A window carries the screenshot taken when you picked it. */
export type Mention = { kind: 'thread'; id: string; title: string } | { kind: 'window'; id: string; title: string; icon?: string; image: AgentImage };

export type MentionOption = { kind: 'thread'; thread: Thread } | { kind: 'window'; window: AppWindow };

const MAX_OPTIONS = 6;
const DIGEST_MESSAGES = 8;
const DIGEST_MESSAGE_CHARS = 400;

/** The word after an `@` that ends the text, or null while there's none: `fix @log` → `log`, `mail a@b.co` → null. */
export function mentionQuery(text: string) {
  return /(?:^|\s)@([^\s@]*)$/.exec(text)?.[1] ?? null;
}

/** The text with the trailing `@query` taken out, once its option is picked. */
export function withoutQuery(text: string) {
  return text.replace(/(^|\s)@[^\s@]*$/, '$1');
}

/** Threads (not `selfId`) then windows whose title contains the query, at most six of each. */
export function mentionOptions(query: string, threads: Thread[], windows: AppWindow[], selfId: string): MentionOption[] {
  const q = query.toLowerCase();
  const hit = (title: string) => title.toLowerCase().includes(q);
  return [
    ...threads
      .filter((t) => t.id !== selfId && hit(t.title))
      .slice(0, MAX_OPTIONS)
      .map((thread) => ({ kind: 'thread' as const, thread })),
    ...windows
      .filter((w) => hit(w.title))
      .slice(0, MAX_OPTIONS)
      .map((window) => ({ kind: 'window' as const, window })),
  ];
}

/**
 * What the transcript shows (`text`: the references as `@title`, then your message) and what the agent gets (`prompt`:
 * each thread's digest and a note per screenshot ahead of your message, `images`: the screenshots in mention order).
 */
export function withReferences(message: string, mentions: Mention[], threads: Thread[]) {
  if (mentions.length === 0) return { text: message, prompt: message, images: [] };
  const text = `${mentions.map((m) => `@${m.title}`).join(' ')}\n\n${message}`;
  const context = mentions.map((m) => {
    if (m.kind === 'window') return `<window title="${attr(m.title)}">Screenshot of this window attached.</window>`;
    const thread = threads.find((t) => t.id === m.id);
    return thread ? threadDigest(thread) : `<thread title="${attr(m.title)}">No longer available.</thread>`;
  });
  const images = mentions.flatMap((m) => (m.kind === 'window' ? [m.image] : []));
  return { text, prompt: `The user referenced these for context:\n\n${context.join('\n\n')}\n\n${message}`, images };
}

/** A compact transcript: the goal, where it stands, then the latest messages. Tool calls and events are left out. */
export function threadDigest(thread: Thread) {
  const done = thread.steps.filter((s) => s.status === 'done').length;
  const messages = thread.activity.filter((a) => a.kind === 'message').slice(-DIGEST_MESSAGES);
  const lines = [
    `Goal: ${thread.goal}`,
    `Status: ${thread.status}, ${done}/${thread.steps.length} steps done${thread.repo ? `, ${thread.repo.project} on ${thread.repo.branch}` : ''}`,
    ...messages.map((m) => `${m.who}: ${clip(m.text)}`),
  ];
  return `<thread title="${attr(thread.title)}">\n${lines.join('\n')}\n</thread>`;
}

const clip = (text: string) => (text.length > DIGEST_MESSAGE_CHARS ? `${text.slice(0, DIGEST_MESSAGE_CHARS - 1)}…` : text).replace(/\s+/g, ' ');
const attr = (s: string) => s.replace(/"/g, '&quot;');
