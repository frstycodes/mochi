import type { DiffFile } from '../host/types/git.ts';
import type { ModelChoice } from '../host/types/settings.ts';
import type { Provider } from '../model.ts';
import { HARNESS_IDS } from '../settings/harnesses.ts';

/** Background generations that run on a model of their own (Settings › Agents › Background tasks). */
export const UTILITY_TASKS = ['title', 'commit', 'pr', 'goal', 'handoff'] as const;

export type UtilityTask = (typeof UTILITY_TASKS)[number];

/** Each provider's cheapest model: every task's default, and the fallback when the chosen one can't answer. */
export const CHEAP_MODELS = { claude: 'claude-haiku-5-5', codex: 'gpt-6-luna' } satisfies Record<Provider, string>;

/** Above this the prompt is cut, so a huge diff can't stall a background call. */
const MAX_PROMPT_CHARS = 24_000;

export const UTILITY_INSTRUCTIONS = {
  title: 'Name a coding thread from its first exchange. Reply with the title only: 2 to 6 words, sentence case, no quotes, no trailing period.',
  commit:
    "Write a git commit message for the staged diff. Conventional Commits: `type(scope): summary` in the imperative mood, under 72 characters; then a blank line and a short body only when the reason isn't obvious from the diff. Reply with the message only, no code fences.",
  pr: 'Write a GitHub pull request for the branch. First line: the title, under 72 characters, no prefix. Then a blank line and the description in Markdown: what changed and why, then how it was tested when the diff shows it. Reply with those only, no code fences.',
  goal: 'Break a coding goal into 2 to 6 ordered steps a coding agent can check off. One step per line, imperative, under 60 characters, no numbering or bullets. Reply with the steps only.',
  handoff:
    "Summarize a coding thread for the agent taking it over: the goal, what's done, what's open, decisions the user made, and anything risky. Markdown, under 200 words. Reply with the summary only.",
} satisfies Record<UtilityTask, string>;

/** What a task tries, in order: your choice, then each provider's cheapest model, Claude first. */
export function utilityCandidates(choice: ModelChoice): ModelChoice[] {
  const all = [choice, ...HARNESS_IDS.map((provider) => ({ provider, model: CHEAP_MODELS[provider] }))];
  return all.filter((c, i) => all.findIndex((d) => d.provider === c.provider && d.model === c.model) === i);
}

export const titlePrompt = (goal: string, reply: string) => cap(`User: ${goal}\n\nAgent: ${reply}`);

export const commitPrompt = (files: DiffFile[]) => cap(files.map(fileDiff).join('\n\n'));

export const prPrompt = (title: string, goal: string, files: DiffFile[]) => cap(`Thread: ${title}\nGoal: ${goal}\n\n${files.map(fileDiff).join('\n\n')}`);

export const goalPrompt = (goal: string) => cap(`Goal: ${goal}`);

/** `context`: the local handoff template; `transcript`: the thread's recent messages, oldest first. */
export const handoffPrompt = (context: string, transcript: string[]) => cap(`${context}\n\nRecent transcript:\n${transcript.join('\n\n')}`);

/** First line, without quotes, heading marks or a trailing period; '' when nothing usable came back. */
export function parseTitle(text: string) {
  const line = unfence(text).split('\n').find((l) => l.trim()) ?? '';
  const title = line.replace(/^(?:#+\s*)?(?:title:\s*)?/i, '').trim().replace(/^["'`“]+|["'`”]+$/g, '').replace(/\.$/, '').trim();
  return title.length > 60 ? `${title.slice(0, 59)}…` : title;
}

export const parseCommit = (text: string) => unfence(text);

export function parsePr(text: string) {
  const [first = '', ...rest] = unfence(text).split('\n');
  return { title: first.replace(/^(?:#+\s*)?(?:title:\s*)?/i, '').trim(), body: rest.join('\n').trim() };
}

/** Up to 8 steps, bullets and numbering stripped. */
export function parseSteps(text: string) {
  return unfence(text)
    .split('\n')
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 8)
    .map((s) => (s.length > 80 ? `${s.slice(0, 79)}…` : s));
}

export const parseHandoff = (text: string) => unfence(text);

function fileDiff(file: DiffFile) {
  const head = `${file.oldPath ? `${file.oldPath} → ` : ''}${file.path} (${file.kind}, +${file.added} −${file.removed})`;
  return file.binary || !file.patch ? head : `${head}\n${file.patch}`;
}

function cap(prompt: string) {
  return prompt.length > MAX_PROMPT_CHARS ? `${prompt.slice(0, MAX_PROMPT_CHARS)}\n… (cut)` : prompt;
}

function unfence(text: string) {
  return text.trim().replace(/^```\w*\n([\s\S]*?)\n```$/, '$1').trim();
}

/** The commit message when no model answers: what changed, by file name. */
export function localCommit(files: DiffFile[]) {
  const names = files.map((f) => f.path.split('/').at(-1)!);
  return names.length <= 3 ? `Update ${names.join(', ')}` : `Update ${names.length} files`;
}
