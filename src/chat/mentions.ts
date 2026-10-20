import type { AgentImage } from '../host/types/agent.ts';
import type { AppWindow } from '../host/types/windows.ts';
import type { AgentCommand, McpServer, Provider, Thread } from '../model.ts';
import { serializeMentions, type FileMention } from './fileMentions.ts';

/**
 * What `@` in the thread composer can point at. A window carries the screenshot taken when you picked it; a skill or MCP
 * server tells the agent what to use for this message (`id` is prefixed so it can't collide with a thread's). A file or a
 * thread stays in the text as a token (`@src/a.ts`, `@Fix login`) where you typed it; the rest show as chips.
 */
export type Mention =
  | { kind: 'thread'; id: string; title: string }
  | { kind: 'window'; id: string; title: string; icon?: string; image: AgentImage }
  | { kind: 'skill'; id: string; title: string; description: string }
  | { kind: 'mcp'; id: string; title: string; toolCount?: number }
  | FileMention;

/** Mentioned inside the text rather than as a chip. */
export const isInline = (mention: Mention) => mention.kind === 'file' || mention.kind === 'thread';

/** A file row: `name` bright, `dir` (where it sits, as you'd type it) dimmed. */
export type FileOption = { kind: 'file'; mention: FileMention; name: string; dir: string };

export type MentionOption = FileOption | { kind: 'thread'; thread: Thread } | { kind: 'window'; window: AppWindow } | { kind: 'skill'; skill: AgentCommand } | { kind: 'mcp'; server: McpServer };

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

/** Threads (not `selfId`, none settled), windows, skills, then MCP servers whose name contains the query, at most six of each. */
export function mentionOptions(query: string, threads: Thread[], windows: AppWindow[], selfId: string, skills: AgentCommand[] = [], servers: McpServer[] = []): MentionOption[] {
  const q = query.toLowerCase();
  const hit = (title: string) => title.toLowerCase().includes(q);
  return [
    ...threads
      .filter((t) => t.id !== selfId && t.status !== 'settled' && hit(t.title))
      .slice(0, MAX_OPTIONS)
      .map((thread) => ({ kind: 'thread' as const, thread })),
    ...windows
      .filter((w) => hit(w.title))
      .slice(0, MAX_OPTIONS)
      .map((window) => ({ kind: 'window' as const, window })),
    ...skills
      .filter((s) => hit(s.name))
      .slice(0, MAX_OPTIONS)
      .map((skill) => ({ kind: 'skill' as const, skill })),
    ...servers
      .filter((s) => hit(s.name))
      .slice(0, MAX_OPTIONS)
      .map((server) => ({ kind: 'mcp' as const, server })),
  ];
}

const MENTION_GROUPS = [
  { kind: 'file', label: 'Files' },
  { kind: 'thread', label: 'Threads' },
  { kind: 'window', label: 'Windows' },
  { kind: 'skill', label: 'Skills' },
  { kind: 'mcp', label: 'MCP servers' },
] as const;

/** The menu's sections in order with their items, empty ones left out. The screen-recording prompt sits with the windows it would unlock. */
export function mentionGroups<T extends { kind: MentionOption['kind'] | 'permission' }>(items: T[]) {
  const groupOf = (item: T) => (item.kind === 'permission' ? 'window' : item.kind);
  return MENTION_GROUPS.map((g) => ({ ...g, items: items.filter((item) => groupOf(item) === g.kind) })).filter((g) => g.items.length);
}

/** The mention a picked option adds; a window's needs its screenshot first, so it isn't made here. */
export function mentionFor(option: Exclude<MentionOption, { kind: 'window' }>): Mention {
  if (option.kind === 'file') return option.mention;
  if (option.kind === 'thread') return { kind: 'thread', id: option.thread.id, title: option.thread.title };
  if (option.kind === 'skill') return { kind: 'skill', id: `skill:${option.skill.name}`, title: option.skill.name, description: option.skill.description };
  return { kind: 'mcp', id: `mcp:${option.server.name}`, title: option.server.name, ...(option.server.toolCount !== undefined && { toolCount: option.server.toolCount }) };
}

export const optionId = (option: MentionOption) => (option.kind === 'file' ? option.mention.id : option.kind === 'thread' ? option.thread.id : option.kind === 'window' ? option.window.id : option.kind === 'skill' ? `skill:${option.skill.name}` : `mcp:${option.server.name}`);

/**
 * What the transcript shows (`text`: the chip references as `@title`, then your message as written) and what the agent gets
 * (`prompt`: each thread's digest and a note per screenshot ahead of your message, then what to use for it; `images`: the
 * screenshots in mention order; `skills`: the skills to attach, for harnesses that load them from the message rather than by
 * name). `typedSkills`: skills the message names as `/skill` after its start, which only the separate note makes the harness
 * load. A message that runs a `/command` keeps it first in both, since the harness only reads a command at the very start.
 * Inline tokens stay where they were typed; in the prompt each token is in its harness's form (`serializeMentions`).
 */
export function withReferences(message: string, mentions: Mention[], threads: Thread[], { isCommand = false, provider = 'claude', typedSkills = [] }: { isCommand?: boolean; provider?: Provider; typedSkills?: string[] } = {}) {
  const skills = [...new Set([...mentions.flatMap((m) => (m.kind === 'skill' ? [m.title] : [])), ...typedSkills])];
  const body = serializeMentions(message, mentions.filter((m) => m.kind === 'file' || m.kind === 'thread'), provider);
  const others = mentions.filter((m) => m.kind !== 'file');
  if (others.length === 0 && skills.length === 0) return { text: message, prompt: body, images: [], skills: [] };
  const tags = others
    .filter((m) => !isInline(m))
    .map((m) => `@${m.title}`)
    .join(' ');
  const text = !tags ? message : isCommand ? `${message}\n\n${tags}` : `${tags}\n\n${message}`;
  const context = others.flatMap((m) => {
    if (m.kind === 'window') return [`<window title="${attr(m.title)}">Screenshot of this window attached.</window>`];
    if (m.kind !== 'thread') return [];
    const thread = threads.find((t) => t.id === m.id);
    return [thread ? threadDigest(thread) : `<thread title="${attr(m.title)}">No longer available.</thread>`];
  });
  const uses = [...skills.map((name) => skillLine(name, provider)), ...mentions.flatMap((m) => (m.kind === 'mcp' ? [serverLine(m.title, provider)] : []))];
  const images = mentions.flatMap((m) => (m.kind === 'window' ? [m.image] : []));
  const preamble = [context.length ? `The user referenced these for context:\n\n${context.join('\n\n')}` : '', uses.join('\n')].filter(Boolean).join('\n\n');
  return { text, prompt: isCommand ? `${body}\n\n${preamble}` : `${preamble}\n\n${body}`, images, skills };
}

// Claude loads a skill only through its Skill tool; Codex gets the skill's SKILL.md attached to the message (`skills`).
const skillLine = (name: string, provider: Provider) =>
  provider === 'claude' ? `For this message, use the "${name}" skill: load it with the Skill tool before you start.` : `For this message, use the "${name}" skill; its instructions are attached.`;

// Claude names a server's tools `mcp__<server>__<tool>`, its name's characters outside [A-Za-z0-9_-] as `_`.
const serverLine = (name: string, provider: Provider) =>
  `For this message, prefer the tools of the "${name}" MCP server${provider === 'claude' ? ` (mcp__${name.replace(/[^a-zA-Z0-9_-]/g, '_')}__*)` : ''} over other ways to do the same thing.`;

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
