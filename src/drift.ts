import type { Thread } from './model.ts';
import { tokens } from './progress.ts';
import { getPrefs } from './settings/prefs.ts';

export type DriftKind = 'on-goal' | 'scope-add' | 'off-goal';

export interface DriftVerdict {
  kind: DriftKind;
  reason: string;
}

export type DriftClassifier = (prompt: string, thread: Thread) => DriftVerdict | Promise<DriftVerdict>;

const ON_GOAL = 0.5;
const ALREADY_PLANNED = 0.8;
const MIN_TOKENS = 2;
const RECENT_MESSAGES = 6;
/** Two "Keep here" choices in one thread mean its goal is broader than the guard thinks: it stops suggesting there. */
export const KEEPS_TO_MUTE = 2;
const SCOPE_CUES = /\b(also|another|additionally|extend|plus|as well|support for)\b|^(please )?(add|include)\b/i;
const QUESTION = /^(why|what|how|where|which|when|who|is|are|does|did|do|was|were|should|isn't|doesn't|didn't)\b[^?]*\?\s*$/i;
const STEERING = /^(no|nope|yes|yep|yeah|sure|wait|stop|don't|do not|use|switch|revert|undo|retry|try again|go ahead|keep going|continue|looks good|lgtm|ship it|it|this|that|these|those)\b|\b(instead|rather than)\b/i;
/** Words that say nothing about what a message is about: greetings, and verbs and path parts every coding request shares. */
const SMALL_TALK = new Set(['hey', 'hello', 'hiya', 'howdy', 'thank', 'thx', 'okay', 'cool', 'nice', 'great', 'good', 'morning', 'afternoon', 'evening', 'how', 'you', 'are', 'doing', 'going', 'there', 'sup', 'what', 'test', 'testing', 'please', 'lol', 'haha']);
const GENERIC = new Set(['fix', 'make', 'change', 'update', 'src', 'tsx', 'page', 'file', 'code', 'can', 'you', 'please', 'should', 'need', 'want']);

/** A message concrete enough to be a goal: a content word left once greetings and pleasantries are dropped, in a message of two words or more. "hi", "how are you", "auth" are not; "add a readme" is. */
export function isConcrete(text: string) {
  const content = [...tokens(text)].filter((w) => !SMALL_TALK.has(w));
  return content.length >= 2 || (content.length === 1 && text.trim().split(/\s+/).length >= 2);
}

/** Drift is measured only after the working agent or user has set a goal. */
export const hasGoal = (thread: Thread) => !!thread.goal.trim();

/** Clear on-goal cases are settled here; the rest go to the classifier, and only a confident off-goal from it suggests a new thread. */
export function judgeDrift(prompt: string, thread: Thread): DriftVerdict | Promise<DriftVerdict> {
  if (!getPrefs().driftGuard) return { kind: 'on-goal', reason: 'Drift guard is off' };
  if (thread.drift?.isMuted) return { kind: 'on-goal', reason: 'Drift guard off for this thread' };
  if (!hasGoal(thread)) return { kind: 'on-goal', reason: 'No goal yet' };
  return judgeLocally(prompt, thread) ?? classifyDrift(prompt, thread);
}

/** Only ever clears a message: word overlap is evidence a message belongs, never that it doesn't. `null` goes to the classifier. */
export function judgeLocally(prompt: string, thread: Thread): DriftVerdict | null {
  if (tokens(prompt).size < MIN_TOKENS) return { kind: 'on-goal', reason: 'Short steering message' };
  if (QUESTION.test(prompt.trim())) return { kind: 'on-goal', reason: 'A question about the work' };
  if (STEERING.test(prompt.trim())) return { kind: 'on-goal', reason: 'Steers the work in progress' };
  if (answersAgent(thread)) return { kind: 'on-goal', reason: "Answers the agent's question" };
  if (SCOPE_CUES.test(prompt)) return null;
  const { score, best } = scoreDrift(prompt, thread);
  if (score >= ON_GOAL) return { kind: 'on-goal', reason: `Matches "${best}"` };
  return null;
}

/** Overlap with everything the thread is about: goal, title, the agent's live plan items, and the last few messages. */
export function scoreDrift(prompt: string, thread: Thread) {
  const steps = thread.steps.filter((s) => s.status !== 'dropped');
  const targets = [thread.goal, thread.title, ...steps.map((s) => s.title), ...recentMessages(thread).map((m) => m.text)];
  let score = 0;
  let best = thread.title;
  for (const target of targets) {
    const value = overlap(prompt, target);
    if (value <= score) continue;
    score = value;
    best = target;
  }
  const stepScore = Math.max(0, ...steps.map((s) => overlap(prompt, s.title)));
  return { score, best, stepScore };
}

function overlap(a: string, b: string) {
  const ta = [...tokens(a)].filter((w) => !GENERIC.has(w));
  const tb = new Set([...tokens(b)].filter((w) => !GENERIC.has(w)));
  if (!ta.length || !tb.size) return 0;
  return ta.filter((w) => tb.has(w)).length / Math.min(ta.length, tb.size);
}

/** The newest messages, both sides, oldest first. Defensive about shape: the desktop build gets the thread over IPC. */
export function recentMessages(thread: Thread) {
  return (thread.activity ?? []).filter((e) => e.kind === 'message' && typeof e.text === 'string').slice(-RECENT_MESSAGES);
}

function answersAgent(thread: Thread) {
  const last = recentMessages(thread).at(-1);
  return !!last && last.who !== 'you' && last.text.trim().endsWith('?');
}

/** Offline fallback: never off-goal, since without the model nothing is confident enough to interrupt. */
export const localClassifier: DriftClassifier = (prompt, thread) => {
  const { best, stepScore } = scoreDrift(prompt, thread);
  if (SCOPE_CUES.test(prompt) && stepScore < ALREADY_PLANNED) return { kind: 'scope-add', reason: 'Asks for something the plan does not have yet' };
  return { kind: 'on-goal', reason: `Close enough to "${best}"` };
};

export const CLASSIFY_PROMPT =
  'Classify the newest message a user sent to a coding agent, given the thread so far. on-goal: works toward the goal, follows up, asks about, corrects or steers the work, answers the agent, or is a small related fix. scope-add: extends the same goal (same feature or area) with something the plan does not cover yet. off-goal: would start a separate piece of work: a different bug, feature, area or chore, even in the same codebase. confidence: high only when a reasonable engineer would agree without hesitation; otherwise low. Reply with only a JSON object {"verdict": "on-goal" | "scope-add" | "off-goal", "confidence": "high" | "low", "reason": "<one short sentence>"}, nothing else.';

/** What the model sees: goal, the agent's plan, and the recent conversation. */
export function classifyInput(prompt: string, thread: Thread) {
  const steps = thread.steps.filter((s) => s.status !== 'dropped');
  const plan = steps.map((s) => `- [${s.status}] ${s.title}`).join('\n') || '- none yet';
  const talk = recentMessages(thread).map((m) => `${m.who === 'you' ? 'User' : 'Agent'}: ${m.text.slice(0, 400)}`).join('\n') || '(none)';
  return `Goal: ${thread.goal}\nTitle: ${thread.title}\nPlan:\n${plan}\n\nRecent conversation:\n${talk}\n\nNewest message: ${prompt}`;
}

const KINDS: DriftKind[] = ['on-goal', 'scope-add', 'off-goal'];
const MODEL_TIMEOUT_MS = 4000;

/** Clear cases locally; otherwise `model`'s verdict within the timeout. A low-confidence off-goal passes; any failure falls back to the local classifier. */
export async function classifyWithModel(prompt: string, thread: Thread, model: (signal: AbortSignal) => Promise<unknown>, timeoutMs = MODEL_TIMEOUT_MS): Promise<DriftVerdict> {
  const local = judgeLocally(prompt, thread);
  if (local) return local;
  const signal = AbortSignal.timeout(timeoutMs);
  const timeout = new Promise<never>((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  try {
    const answer = (await Promise.race([model(signal), timeout])) as { verdict?: unknown; confidence?: unknown; reason?: unknown } | null;
    if (!KINDS.includes(answer?.verdict as DriftKind) || typeof answer?.reason !== 'string') throw new Error('Malformed verdict');
    const kind = answer.verdict as DriftKind;
    if (kind === 'off-goal' && answer.confidence !== 'high') return { kind: 'on-goal', reason: `Not clearly separate: ${answer.reason}` };
    return { kind, reason: answer.reason };
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
