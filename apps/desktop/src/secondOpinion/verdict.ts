import type { GitDiff } from '../host/types/git.ts';
import type { Provider, Thread } from '../model.ts';

export const VERDICTS = ['approve', 'concerns', 'block'] as const;
export const SEVERITIES = ['high', 'medium', 'low'] as const;

export type VerdictKind = (typeof VERDICTS)[number];
export type Severity = (typeof SEVERITIES)[number];

export interface Finding {
  file: string;
  line?: number;
  severity: Severity;
  text: string;
}

export interface Verdict {
  verdict: VerdictKind;
  summary: string;
  findings: Finding[];
}

/** One second-opinion run on a thread, kept with it. `afterIndex`: the activity length when it started, where its row sits in the chat. */
export interface Review {
  id: string;
  provider: Provider;
  afterIndex: number;
  startedAt: number;
  status: 'running' | 'done' | 'failed';
  /** What the reviewer is doing ("Read src/a.ts"), newest last. */
  steps: string[];
  result?: Verdict;
  error?: string;
  isTruncated?: boolean;
  isSent?: boolean;
  isDismissed?: boolean;
  /** The thread's own agent asked for it (`ask_second_opinion`): the verdict goes back to it on its own. */
  isAgentAsked?: boolean;
}

/** Both providers' structured-output schema. Strict mode (OpenAI) wants every property required, so `line` is nullable instead of optional. */
export const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'summary', 'findings'],
  properties: {
    verdict: { type: 'string', enum: VERDICTS },
    summary: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['file', 'line', 'severity', 'text'],
        properties: {
          file: { type: 'string' },
          line: { type: ['integer', 'null'] },
          severity: { type: 'string', enum: SEVERITIES },
          text: { type: 'string' },
        },
      },
    },
  },
} as const;

export const MAX_DIFF_CHARS = 60_000;
const MAX_FINDINGS = 50;

/**
 * The reviewer's answer as a checked verdict, from a structured-output object or from text holding one JSON object
 * (a model that ignores the schema often wraps it in prose or a fence). Throws a message the card can show.
 */
export function parseVerdict(answer: unknown): Verdict {
  const value = typeof answer === 'string' ? extractJson(answer) : answer;
  if (typeof value !== 'object' || value === null)
    throw new Error('The reviewer did not answer with a verdict');
  const v = value as Record<string, unknown>;
  if (!VERDICTS.includes(v.verdict as VerdictKind))
    throw new Error(`Unknown verdict "${String(v.verdict)}"`);
  if (typeof v.summary !== 'string' || !v.summary.trim())
    throw new Error('The verdict has no summary');
  const findings = Array.isArray(v.findings)
    ? v.findings.slice(0, MAX_FINDINGS).flatMap(parseFinding)
    : [];
  return {
    verdict: v.verdict as VerdictKind,
    summary: v.summary.trim(),
    findings,
  };
}

function parseFinding(raw: unknown): Finding[] {
  if (typeof raw !== 'object' || raw === null) return [];
  const f = raw as Record<string, unknown>;
  if (typeof f.text !== 'string' || !f.text.trim()) return [];
  const severity = SEVERITIES.includes(f.severity as Severity)
    ? (f.severity as Severity)
    : 'medium';
  const file =
    typeof f.file === 'string' ? f.file.trim().replace(/^(?:a|b)\//, '') : '';
  const line =
    typeof f.line === 'number' && Number.isInteger(f.line) && f.line > 0
      ? f.line
      : undefined;
  return [{ file, ...(line && { line }), severity, text: f.text.trim() }];
}

function extractJson(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** The review prompt: the thread's title and the diff against base, cut at `maxChars` with a note saying so. */
export function reviewPrompt(
  thread: Pick<Thread, 'title'>,
  diff: Pick<GitDiff, 'base' | 'branch' | 'files'>,
  maxChars = MAX_DIFF_CHARS,
) {
  const patch = diff.files
    .map((f) => (f.binary ? `Binary file ${f.path} changed\n` : f.patch))
    .join('\n');
  const isTruncated = patch.length > maxChars;
  const shown = isTruncated ? patch.slice(0, maxChars) : patch;
  const prompt = [
    "You are giving a second opinion on another coding agent's work. You are read-only: do not edit files or run commands that change anything.",
    `Thread: ${thread.title}`,
    `Diff of ${diff.branch} against ${diff.base} (${diff.files.length} files):`,
    isTruncated
      ? `NOTE: the diff is truncated to its first ${maxChars} characters; read the remaining files in the working tree if they matter.`
      : '',
    `\`\`\`diff\n${shown || '(no changes)'}\n\`\`\``,
    'Review for correctness bugs and risky changes; answer with a verdict.',
    'Answer with only a JSON object: {"verdict": "approve" | "concerns" | "block", "summary": "<two sentences at most>", "findings": [{"file": "<repo-relative path>", "line": <number or null>, "severity": "high" | "medium" | "low", "text": "<what is wrong and why>"}]}. Use "block" only for bugs that must be fixed before merging.',
  ];
  return { prompt: prompt.filter(Boolean).join('\n\n'), isTruncated };
}

/** The findings as a message to the thread's own agent. */
export function findingsMessage(
  provider: Provider,
  verdict: Verdict,
  isAgentAsked?: boolean,
) {
  const name = provider === 'claude' ? 'Claude' : 'Codex';
  const items = verdict.findings.map(
    (f) =>
      `- [${f.severity}] ${f.file ? `\`${f.file}${f.line ? `:${f.line}` : ''}\` ` : ''}${f.text}`,
  );
  const head = `${isAgentAsked ? '[Second opinion you asked for] ' : ''}${name} reviewed the diff (verdict: ${verdict.verdict}): ${verdict.summary}`;
  const close = !isAgentAsked
    ? 'Please address these, or tell me why not.'
    : items.length
      ? 'This is the reviewer, not the user. Weigh each finding: fix the ones that hold, and say in your reply which you set aside and why.'
      : 'This is the reviewer, not the user. Nothing to change; carry on.';
  return [head, items.length ? `Findings:\n${items.join('\n')}` : '', close]
    .filter(Boolean)
    .join('\n\n');
}

export const otherProvider = (provider: Provider): Provider =>
  provider === 'claude' ? 'codex' : 'claude';
export const providerName = (provider: Provider) =>
  provider === 'claude' ? 'Claude' : 'Codex';
