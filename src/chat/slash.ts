import { fuzzyMatch } from '../files/fuzzy.ts';
import type { ProviderConfig } from '../host/types/settings.ts';
import type { NativeItem } from '../library/nativeItems.ts';
import type { AgentCommand, Provider } from '../model.ts';

/** Commands Mochi runs itself from the thread composer. Anything else starting with `/` goes to the agent as typed. */
export const SLASH_COMMANDS = [
  { name: 'side', argumentHint: '<question>', description: 'Ask in side chat, with this thread as context' },
  { name: 'compact', argumentHint: '[focus]', description: 'Summarize the conversation to free context, keeping your pins' },
] as const;

/**
 * One row of the `/` menu: Mochi's own command or the harness's skill or command. A skill works anywhere in the message
 * (its name goes to the agent separately); a command runs only when it opens the message.
 */
export type SlashItem = AgentCommand & { source: 'mochi' | Provider; isSkill: boolean; /** Listed but can't run now, and why. */ disabledReason?: string };

/** Mochi's commands first, then the harness's, a name the harness shares with Mochi left to Mochi. `skills` unset: all are skills. */
export function slashItems(commands: AgentCommand[], provider: Provider, skills?: string[]): SlashItem[] {
  const own = SLASH_COMMANDS.map((c) => ({ ...c, source: 'mochi' as const, isSkill: false }));
  const taken = new Set<string>(own.map((c) => c.name));
  const isSkill = (name: string) => !skills || skills.includes(name);
  return [...own, ...commands.filter((c) => !taken.has(c.name)).map((c) => ({ ...c, source: provider, isSkill: isSkill(c.name) }))];
}

/**
 * What the agent will offer, read from disk before it starts and reports its own list: the account's enabled skills, then
 * the project's, plugins' and custom ones, the first of a name kept. In the agent's shape, `skills` naming the skills among `commands`.
 * `off` is what the profile turned off (`offItems`), left out by the same rules the session's overrides apply: a skill by name, a
 * plugin with everything it brings.
 */
export function configuredCommands({ skills, commands }: Pick<ProviderConfig, 'skills' | 'commands'>, off: readonly NativeItem[] = []) {
  const offSkills = new Set(off.flatMap((i) => (i.kind === 'skill' ? [i.name] : [])));
  const offPlugins = off.flatMap((i) => (i.kind === 'plugin' ? [`${i.name.split('@')[0]}:`] : []));
  const isOn = (name: string) => !offSkills.has(name) && !offPlugins.some((prefix) => name.startsWith(prefix));
  const own = skills.filter((s) => s.enabled && isOn(s.name)).map(({ name, description, argumentHint }) => ({ name, description, ...(argumentHint && { argumentHint }), isSkill: true }));
  const seen = new Set<string>();
  const unique = [...own, ...commands.filter((c) => isOn(c.name))].filter((c) => !seen.has(c.name) && !!seen.add(c.name));
  return { commands: unique.map(({ isSkill: _, ...c }): AgentCommand => c), skills: unique.flatMap((c) => (c.isSkill ? [c.name] : [])) };
}

/** `/side why redis?` → `{ command, arg: 'why redis?' }`; plain text or a command Mochi doesn't own → null. */
export function parseSlash(text: string) {
  const match = /^\/(\S+)(?:\s+([\s\S]*))?$/.exec(text.trim());
  const command = match && SLASH_COMMANDS.find((c) => c.name === match[1]);
  return command ? { command, arg: (match[2] ?? '').trim() } : null;
}

/** The `/word` the caret is at the end of, typed at the start of the text or a line or after a space: `fix /rev|` → `rev`. */
export function slashQueryAt(text: string, caret = text.length) {
  const match = /(?:^|\s)\/([^\s/]*)$/.exec(text.slice(0, caret));
  if (!match || /^\S/.test(text.slice(caret))) return null;
  return { start: caret - match[1].length - 1, end: caret, query: match[1] };
}

/** What the menu lists for a query: prefix hits, then substring, then in-order letters. */
export function slashMatches(query: string, items: SlashItem[]): SlashItem[] {
  const q = query.toLowerCase();
  return items
    .map((item, i) => ({ item, i, rank: fuzzyMatch(item.name, q)?.rank ?? null }))
    .filter((m) => m.rank !== null)
    .sort((a, b) => a.rank! - b.rank! || a.i - b.i)
    .map((m) => m.item);
}

/** The `/` menu's section for an item: Mochi's own, the plugin a `plugin:skill` comes from, else its harness's. */
export function slashGroup(item: SlashItem) {
  if (item.source === 'mochi') return 'mochi';
  const colon = item.name.indexOf(':');
  return colon > 0 ? item.name.slice(0, colon) : item.source;
}

/** `items` with each section's rows together, sections in the order their best match ranks, so the arrows walk the menu as it reads. */
export function bySlashGroup(items: SlashItem[]) {
  const order = [...new Set(items.map(slashGroup))];
  return items.toSorted((a, b) => order.indexOf(slashGroup(a)) - order.indexOf(slashGroup(b)));
}

/** The text once `item` is picked for the `/query` at `range`: the name goes exactly where it was typed, the rest untouched. */
export function insertToken(text: string, range: { start: number; end: number }, item: SlashItem) {
  const after = text.slice(range.end);
  const token = `/${item.name}${/^\s/.test(after) ? '' : ' '}`;
  return { text: `${text.slice(0, range.start)}${token}${after}`, caret: range.start + token.length };
}

/** Every known `/name` in the text, at its start or after whitespace, in order: what the composer colours. */
export function slashTokens(text: string, items: SlashItem[]) {
  return [...text.matchAll(/(?<=^|\s)\/(\S+)/g)].flatMap((m) => {
    const item = items.find((i) => i.name === m[1]);
    return item ? [{ item, start: m.index, end: m.index + m[0].length }] : [];
  });
}

/** The skills a message names after its start, for the agent to load: a leading one the harness runs itself. */
export function typedSkills(text: string, items: SlashItem[]) {
  return [...new Set(slashTokens(text, items).flatMap((t) => (t.start > 0 && t.item.isSkill ? [t.item.name] : [])))];
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
