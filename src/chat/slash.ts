/** Commands Mochi runs itself from the thread composer. Anything else starting with `/` goes to the agent as typed. */
export const SLASH_COMMANDS = [{ name: 'side', usage: '/side <question>', description: 'Ask in side chat, with this thread as context' }] as const;

export type SlashCommand = (typeof SLASH_COMMANDS)[number];

/** `/side why redis?` → `{ command, arg: 'why redis?' }`; plain text or a command Mochi doesn't own → null. */
export function parseSlash(text: string) {
  const match = /^\/(\S+)(?:\s+([\s\S]*))?$/.exec(text.trim());
  const command = match && SLASH_COMMANDS.find((c) => c.name === match[1]);
  return command ? { command, arg: (match[2] ?? '').trim() } : null;
}

/** What the menu lists while the input is only `/` and part of a name. */
export function slashMatches(text: string): SlashCommand[] {
  const match = /^\/(\S*)$/.exec(text);
  return match ? SLASH_COMMANDS.filter((c) => c.name.startsWith(match[1])) : [];
}
