import type { AgentCommand, Provider } from '../model.ts';

/** Commands Mochi runs itself from the thread composer. Anything else starting with `/` goes to the agent as typed. */
export const SLASH_COMMANDS = [{ name: 'side', argumentHint: '<question>', description: 'Ask in side chat, with this thread as context' }] as const;

/** One row of the `/` menu: Mochi's own command or the harness's skill or command. */
export type SlashItem = AgentCommand & { source: 'mochi' | Provider };

/** Mochi's commands first, then the harness's, a name the harness shares with Mochi left to Mochi. */
export function slashItems(commands: AgentCommand[], provider: Provider): SlashItem[] {
  const own = SLASH_COMMANDS.map((c) => ({ ...c, source: 'mochi' as const }));
  const taken = new Set<string>(own.map((c) => c.name));
  return [...own, ...commands.filter((c) => !taken.has(c.name)).map((c) => ({ ...c, source: provider }))];
}

/** `/side why redis?` → `{ command, arg: 'why redis?' }`; plain text or a command Mochi doesn't own → null. */
export function parseSlash(text: string) {
  const match = /^\/(\S+)(?:\s+([\s\S]*))?$/.exec(text.trim());
  const command = match && SLASH_COMMANDS.find((c) => c.name === match[1]);
  return command ? { command, arg: (match[2] ?? '').trim() } : null;
}

/** What the menu lists while the input is only `/` and part of a name: prefix hits, then substring, then in-order letters. */
export function slashMatches(text: string, items: SlashItem[]): SlashItem[] {
  const match = /^\/(\S*)$/.exec(text);
  if (!match) return [];
  const query = match[1].toLowerCase();
  return items
    .map((item, i) => ({ item, i, rank: fuzzyRank(item.name.toLowerCase(), query) }))
    .filter((m) => m.rank !== null)
    .sort((a, b) => a.rank! - b.rank! || a.i - b.i)
    .map((m) => m.item);
}

function fuzzyRank(name: string, query: string) {
  if (name.startsWith(query)) return 0;
  if (name.includes(query)) return 1;
  let at = 0;
  for (const ch of query) {
    at = name.indexOf(ch, at) + 1;
    if (at === 0) return null;
  }
  return 2;
}

/** The known `/name` that opens the text, with what follows it; an unknown name or none → null. */
export function resolveToken(text: string, items: SlashItem[]) {
  const match = /^\/(\S+)(?=\s|$)/.exec(text);
  const item = match && items.find((i) => i.name === match[1]);
  return item ? { item, end: match[0].length, rest: text.slice(match[0].length) } : null;
}

/** `<file> [--fix]` → `['<file>', '[--fix]']`: bracketed groups keep their spaces. */
export function argumentSlots(hint = '') {
  return hint.match(/<[^>]*>|\[[^\]]*\]|\S+/g) ?? [];
}

/**
 * The placeholder still owed after the token: one slot per argument not yet started, each word you type (even half typed)
 * taking the next. Gone once the text runs onto a second line. Leads with a space when the text doesn't end in one.
 */
export function slotPlaceholder(rest: string, hint?: string) {
  if (rest.includes('\n')) return '';
  const typed = rest.split(/\s+/).filter(Boolean).length;
  const left = argumentSlots(hint).slice(typed);
  if (!left.length) return '';
  return `${/\s$/.test(rest) ? '' : ' '}${left.join(' ')}`;
}
