import type { DiffFile } from '../host/types/git.ts';
import type { ModelChoice } from '../host/types/settings.ts';
import type { Provider } from '../model.ts';
import { HARNESS_IDS } from '../settings/harnesses.ts';

/** Background generations that run on a model of their own (Settings › Models › Background tasks). */
export const UTILITY_TASKS = [
  'title',
  'simplify',
  'commit',
  'pr',
  'handoff',
  'command',
] as const;

export type UtilityTask = (typeof UTILITY_TASKS)[number];

export const UTILITY_TASK_LABELS = {
  title: 'Thread titles',
  simplify: 'Simplify',
  commit: 'Commit messages',
  pr: 'Pull requests',
  handoff: 'Handoff summaries',
  command: 'Command titles',
} satisfies Record<UtilityTask, string>;

/** Each provider's cheapest model: every task's default, and the fallback when the chosen one can't answer. */
export const CHEAP_MODELS = {
  claude: 'claude-haiku-5-5',
  codex: 'gpt-6-luna',
} satisfies Record<Provider, string>;

/** Above this the prompt is cut, so a huge diff can't stall a background call. */
const MAX_PROMPT_CHARS = 24_000;

export const UTILITY_INSTRUCTIONS = {
  simplify:
    "Rewrite a coding agent's reply in plainer, shorter words for someone reading it quickly, as Markdown. Keep every fact that matters and drop the rest. Code blocks, commands, file paths, URLs and PR or issue references stay exactly as written. Reply with the rewrite only: no heading, no preamble, no closing line.",
  title:
    "Name a coding thread from its first message, and the agent's reply when there is one. Reply with the title only: 2 to 6 words, sentence case, no quotes, no trailing period.",
  commit:
    "Write a git commit message for the staged diff. Conventional Commits: `type(scope): summary` in the imperative mood, under 72 characters; then a blank line and a short body only when the reason isn't obvious from the diff. Reply with the message only, no code fences.",
  pr: 'Write a GitHub pull request for the branch. First line: the title, under 72 characters, no prefix. Then a blank line and the description in Markdown: what changed and why, then how it was tested when the diff shows it. Reply with those only, no code fences.',
  handoff:
    "Summarize a coding thread for the agent taking it over: the goal, what's done, what's open, decisions the user made, and anything risky. Markdown, under 200 words. Reply with the summary only.",
  command:
    "Say what a shell command a coding agent is running does, for a status line. Reply with the line only: 3 to 8 words, an imperative verb first, sentence case, no quotes, no trailing period, like Watch PR 260's CI checks.",
} satisfies Record<UtilityTask, string>;

/** What a task tries, in order: your choice, then each provider's cheapest model, Claude first. */
export function utilityCandidates(choice: ModelChoice): ModelChoice[] {
  const all = [
    choice,
    ...HARNESS_IDS.map((provider) => ({
      provider,
      model: CHEAP_MODELS[provider],
    })),
  ];
  return all.filter(
    (c, i) =>
      all.findIndex((d) => d.provider === c.provider && d.model === c.model) ===
      i,
  );
}

export const titlePrompt = (message: string, reply?: string) =>
  cap(reply ? `User: ${message}\n\nAgent: ${reply}` : `User: ${message}`);

export const commandPrompt = (command: string) => cap(command);

export const commitPrompt = (files: DiffFile[]) =>
  cap(files.map(fileDiff).join('\n\n'));

export const prPrompt = (title: string, files: DiffFile[]) =>
  cap(`Thread: ${title}\n\n${files.map(fileDiff).join('\n\n')}`);

/** First line, without quotes, heading marks or a trailing period; '' when nothing usable came back. */
export function parseTitle(text: string) {
  const line =
    unfence(text)
      .split('\n')
      .find((l) => l.trim()) ?? '';
  const title = line
    .replace(/^(?:#+\s*)?(?:title:\s*)?/i, '')
    .trim()
    .replace(/^["'`“]+|["'`”]+$/g, '')
    .replace(/\.$/, '')
    .trim();
  return title.length > 60 ? `${title.slice(0, 59)}…` : title;
}

export const parseCommit = (text: string) => unfence(text);

export function parsePr(text: string) {
  const [first = '', ...rest] = unfence(text).split('\n');
  return {
    title: first.replace(/^(?:#+\s*)?(?:title:\s*)?/i, '').trim(),
    body: rest.join('\n').trim(),
  };
}

function fileDiff(file: DiffFile) {
  const head = `${file.oldPath ? `${file.oldPath} → ` : ''}${file.path} (${file.kind}, +${file.added} −${file.removed})`;
  return file.binary || !file.patch ? head : `${head}\n${file.patch}`;
}

function cap(prompt: string) {
  return prompt.length > MAX_PROMPT_CHARS
    ? `${prompt.slice(0, MAX_PROMPT_CHARS)}\n… (cut)`
    : prompt;
}

function unfence(text: string) {
  return text
    .trim()
    .replace(/^```\w*\n([\s\S]*?)\n```$/, '$1')
    .trim();
}

/** The commit message when no model answers: what changed, by file name. */
export function localCommit(files: DiffFile[]) {
  const names = files.map((f) => f.path.split('/').at(-1)!);
  return names.length <= 3
    ? `Update ${names.join(', ')}`
    : `Update ${names.length} files`;
}
