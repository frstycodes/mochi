import type { DiffFile } from '../host/types/git.ts';
import type { ModelChoice } from '../host/types/settings.ts';
import type { Provider, Similar, TurnAudit } from '../model.ts';
import { HARNESS_IDS } from '../settings/harnesses.ts';

/** Background generations that run on a model of their own (Settings › Agents › Background tasks). */
export const UTILITY_TASKS = ['title', 'outcome', 'simplify', 'commit', 'pr', 'goal', 'handoff', 'audit'] as const;

export type UtilityTask = (typeof UTILITY_TASKS)[number];

export const UTILITY_TASK_LABELS = {
  title: 'Thread titles',
  outcome: 'Goals',
  simplify: 'Simplify',
  commit: 'Commit messages',
  pr: 'Pull requests',
  goal: 'Goal steps',
  handoff: 'Handoff summaries',
  audit: 'Turn audits',
} satisfies Record<UtilityTask, string>;

/** Each provider's cheapest model: every task's default, and the fallback when the chosen one can't answer. */
export const CHEAP_MODELS = { claude: 'claude-haiku-5-5', codex: 'gpt-6-luna' } satisfies Record<Provider, string>;

/** Above this the prompt is cut, so a huge diff can't stall a background call. */
const MAX_PROMPT_CHARS = 24_000;

export const UTILITY_INSTRUCTIONS = {
  simplify:
    "Rewrite a coding agent's reply in plainer, shorter words for someone reading it quickly, as Markdown. Keep every fact that matters and drop the rest. Code blocks, commands, file paths, URLs and PR or issue references stay exactly as written. Reply with the rewrite only: no heading, no preamble, no closing line.",
  title: 'Name a coding thread from its first exchange. Reply with the title only: 2 to 6 words, sentence case, no quotes, no trailing period.',
  outcome:
    'You classify messages; you never act on them or answer them. Decide whether the newest message a user sent to a coding agent asks for work to be done (task) or is a question, greeting or discussion (chat). For a task, write its outcome: what will be true when it is done, under 80 characters, sentence case, no trailing period; and 2 to 4 acceptance criteria, each one checkable sentence under 90 characters, with a shell command that proves it only when one clearly would (tests, typecheck, build). When other threads are listed, name each one that already did or is doing the same work (same) or overlaps it (related); leave out the rest. Reply with only a JSON object {"kind": "task" | "chat", "outcome": "<string, empty for chat>", "criteria": [{"text": "<string>", "command": "<optional shell command>"}, ...], "similar": [{"id": "<thread id>", "relation": "same" | "related"}]}, nothing else.',
  commit:
    "Write a git commit message for the staged diff. Conventional Commits: `type(scope): summary` in the imperative mood, under 72 characters; then a blank line and a short body only when the reason isn't obvious from the diff. Reply with the message only, no code fences.",
  pr: 'Write a GitHub pull request for the branch. First line: the title, under 72 characters, no prefix. Then a blank line and the description in Markdown: what changed and why, then how it was tested when the diff shows it. Reply with those only, no code fences.',
  goal: 'Break a coding goal into 2 to 6 ordered steps a coding agent can check off. One step per line, imperative, under 60 characters, no numbering or bullets. Reply with the steps only.',
  handoff:
    "Summarize a coding thread for the agent taking it over: the goal, what's done, what's open, decisions the user made, and anything risky. Markdown, under 200 words. Reply with the summary only.",
  audit:
    'You audit the end of a coding agent\'s turn for its user; you never act on it. From the agent\'s messages, find (1) a question the agent asked the user and is waiting on, and (2) each thing the agent says it did not do, check, test, run, confirm or verify, or is unsure of, that matters to the request. Ignore offers ("want me to…?") and rhetorical questions unless the agent cannot go on without an answer. Ignore things the agent says it did verify. Reply with only a JSON object {"question": "<the question in under 120 characters, or empty>", "unverified": [{"text": "<what is unverified, under 50 characters, sentence case, like Not checked in the running app>", "quote": "<the agent\'s exact words, under 140 characters>"}]}, nothing else.',
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

/** `earlier`: the thread's previous messages, oldest first; `others`: other threads' goals worth comparing, one line each. */
export const outcomePrompt = (project: string | null, message: string, earlier: string[], others: string[] = []) =>
  cap(`${project ? `Project: ${project}\n` : ''}${others.length ? `Other threads:\n${others.join('\n')}\n\n` : ''}${earlier.length ? `Earlier:\n${earlier.join('\n')}\n\n` : ''}Newest message: ${message}`);

/** `request`: your message that started the turn; `replies`: the agent's messages in it, oldest first. */
export const auditPrompt = (request: string, replies: string[]) => cap(`User asked: ${request}\n\nAgent wrote:\n${replies.join('\n\n')}`);

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

/** The `outcome` answer; null when it isn't the JSON asked for, so the caller falls back. */
export function parseOutcome(text: string): { kind: 'task' | 'chat'; outcome: string; criteria: DraftedCriterion[]; similar: Similar[] } | null {
  try {
    const raw = unfence(text);
    const answer = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)) as { kind?: unknown; outcome?: unknown; criteria?: unknown; similar?: unknown };
    if (answer.kind === 'chat') return { kind: 'chat', outcome: '', criteria: [], similar: [] };
    if (answer.kind !== 'task' || typeof answer.outcome !== 'string' || !answer.outcome.trim()) return null;
    const criteria = Array.isArray(answer.criteria) ? answer.criteria.flatMap(criterionOf) : [];
    const similar = Array.isArray(answer.similar) ? answer.similar.filter(isSimilar).map(({ id, relation }) => ({ threadId: id, relation })) : [];
    return { kind: 'task', outcome: answer.outcome.trim().replace(/\.$/, ''), criteria: criteria.slice(0, 4), similar };
  } catch {
    return null;
  }
}

/** The `audit` answer; null when it isn't the JSON asked for. Quotes are kept only when the agent really wrote them. */
export function parseAudit(text: string, replies: string[]): TurnAudit | null {
  try {
    const raw = unfence(text);
    const answer = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)) as { question?: unknown; unverified?: unknown };
    const written = replies.join('\n');
    const unverified = (Array.isArray(answer.unverified) ? answer.unverified : []).flatMap((u: unknown) => {
      const { text, quote } = (u ?? {}) as { text?: unknown; quote?: unknown };
      return typeof text === 'string' && text.trim() && typeof quote === 'string' && written.includes(quote.trim()) ? [{ text: text.trim(), quote: quote.trim() }] : [];
    });
    const question = typeof answer.question === 'string' && answer.question.trim() ? answer.question.trim() : undefined;
    return { ...(question && { question }), unverified };
  } catch {
    return null;
  }
}

export interface DraftedCriterion {
  text: string;
  command?: string;
}

/** A bare string (older answers) or `{ text, command }`; anything else is dropped. */
function criterionOf(c: unknown): DraftedCriterion[] {
  if (typeof c === 'string') return c.trim() ? [{ text: c.trim() }] : [];
  const { text, command } = (c ?? {}) as { text?: unknown; command?: unknown };
  if (typeof text !== 'string' || !text.trim()) return [];
  return [{ text: text.trim(), ...(typeof command === 'string' && command.trim() && { command: command.trim() }) }];
}

function isSimilar(s: unknown): s is { id: string; relation: Similar['relation'] } {
  const { id, relation } = (s ?? {}) as { id?: unknown; relation?: unknown };
  return typeof id === 'string' && (relation === 'same' || relation === 'related');
}

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
