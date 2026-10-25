import type { Provider } from '../model.ts';

/**
 * A profile's own instructions are files in its folder (`<userData>/profiles/<id>/`), edited in any editor: `mochi.md`
 * reaches every harness, `<harness>.md` only that one. Mochi adds them to each new thread's system prompt and never
 * writes to Claude Code's or Codex's own CLAUDE.md or AGENTS.md.
 */
export const SHARED_INSTRUCTIONS = 'mochi.md';

export const instructionsFileOf = (provider: Provider) => `${provider}.md`;

/** One file in the folder, for Settings: which harness reads it (null: every one) and how long it is. */
export interface InstructionsFile {
  name: string;
  provider: Provider | null;
  lines: number;
}

export interface ProfileFolder {
  dir: string;
  files: InstructionsFile[];
}

/** What a thread on `provider` gets: the shared file, then the harness's own, under a heading that says whose they are. */
export function composeInstructions(shared: string, own: string) {
  const text = [shared.trim(), own.trim()].filter(Boolean).join('\n\n');
  return text && `The user's instructions for this Mochi profile:\n\n${text}`;
}
