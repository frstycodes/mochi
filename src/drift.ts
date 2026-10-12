import type { Thread } from './model.ts';
import { similarity, tokens } from './progress.ts';
import { getPrefs } from './settings/prefs.ts';

export type DriftKind = 'on-goal' | 'scope-add' | 'off-goal';

export interface DriftVerdict {
  kind: DriftKind;
  reason: string;
}

export type DriftClassifier = (prompt: string, thread: Thread) => DriftVerdict | Promise<DriftVerdict>;

/** Below this score a prompt is off-goal without asking the classifier: the thread's own threshold, else Settings › Goals and drift. */
export const driftThreshold = (thread: Thread) => thread.drift?.threshold ?? getPrefs().driftThreshold;
const ON_GOAL = 0.5;
const ALREADY_PLANNED = 0.8;
const MIN_TOKENS = 2;
const SCOPE_CUES = /\b(also|another|additionally|extend|plus|as well|support for)\b|^(please )?(add|include)\b/i;

/** Score a prompt against everything the goal covers: the goal sentence, the title, open step titles and their files. */
export function judgeDrift(prompt: string, thread: Thread): DriftVerdict | Promise<DriftVerdict> {
  return judgeLocally(prompt, thread) ?? classifyDrift(prompt, thread);
}

/** Clear cases only; `null` means ambiguous and goes to the classifier. */
export function judgeLocally(prompt: string, thread: Thread): DriftVerdict | null {
  if (tokens(prompt).size < MIN_TOKENS) return { kind: 'on-goal', reason: 'Short steering message' };
  const { score, best } = scoreDrift(prompt, thread);
  if (score < driftThreshold(thread)) return { kind: 'off-goal', reason: 'Shares nothing with the goal or its open steps' };
  if (SCOPE_CUES.test(prompt)) return null;
  if (score >= ON_GOAL) return { kind: 'on-goal', reason: `Matches "${best}"` };
  return null;
}

export function scoreDrift(prompt: string, thread: Thread) {
  const open = thread.steps.filter((s) => s.status !== 'done' && s.status !== 'dropped');
  const targets = [thread.goal, thread.title, ...open.map((s) => s.title), ...open.flatMap((s) => s.footprint)];
  let score = 0;
  let best = thread.title;
  for (const target of targets) {
    const value = similarity(prompt, target);
    if (value <= score) continue;
    score = value;
    best = target;
  }
  const stepScore = Math.max(0, ...thread.steps.filter((s) => s.status !== 'dropped').map((s) => similarity(prompt, s.title)));
  return { score, best, stepScore };
}

export const localClassifier: DriftClassifier = (prompt, thread) => {
  const { best, stepScore } = scoreDrift(prompt, thread);
  if (SCOPE_CUES.test(prompt) && stepScore < ALREADY_PLANNED) return { kind: 'scope-add', reason: 'Asks for something the plan does not have yet' };
  return { kind: 'on-goal', reason: `Close enough to "${best}"` };
};

const KINDS: DriftKind[] = ['on-goal', 'scope-add', 'off-goal'];
const MODEL_TIMEOUT_MS = 4000;

/** Clear cases locally; otherwise `model`'s `{ verdict, reason }` within the timeout, falling back to the local classifier on any failure. */
export async function classifyWithModel(prompt: string, thread: Thread, model: (signal: AbortSignal) => Promise<unknown>, timeoutMs = MODEL_TIMEOUT_MS): Promise<DriftVerdict> {
  const local = judgeLocally(prompt, thread);
  if (local) return local;
  const signal = AbortSignal.timeout(timeoutMs);
  const timeout = new Promise<never>((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  try {
    const answer = (await Promise.race([model(signal), timeout])) as { verdict?: unknown; reason?: unknown } | null;
    if (!KINDS.includes(answer?.verdict as DriftKind) || typeof answer?.reason !== 'string') throw new Error('Malformed verdict');
    return { kind: answer!.verdict as DriftKind, reason: answer!.reason as string };
  } catch {
    return localClassifier(prompt, thread);
  }
}

let classifier: DriftClassifier = localClassifier;

export function setDriftClassifier(next: DriftClassifier) {
  classifier = next;
}

export function classifyDrift(prompt: string, thread: Thread) {
  return classifier(prompt, thread);
}

const STEP_TITLE_MAX = 48;

/** A step title from a prompt: drops the leading cue word and caps the length. */
export function stepTitleFrom(prompt: string) {
  const text = prompt
    .trim()
    .replace(/^(please\s+)?(also\s+)?(add|include)?\s*/i, '')
    .replace(/[.!?]+$/, '');
  const title = text.charAt(0).toUpperCase() + text.slice(1);
  return title.length > STEP_TITLE_MAX ? `${title.slice(0, STEP_TITLE_MAX - 1)}…` : title;
}
