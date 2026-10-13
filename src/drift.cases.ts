import type { Action, State } from './store/index.tsx';
import { goalDraftRequest, localGoalDraft } from './goals/draft.ts';
import { initialQueue } from './store/queue.ts';
import { initialThreads, mapThread, threadsReducer } from './store/threads.ts';

/** A thread replayed through the store, then the next message to judge. `isOffGoal`: it would start unrelated work, so a new thread should be suggested. */
export interface DriftCase {
  name: string;
  turns: Turn[];
  /** The agent's plan, as it stands when `prompt` is typed. */
  steps?: { title: string; files?: string[] }[];
  prompt: string;
  isOffGoal: boolean;
}

type Turn = string | { agent: string };

const RATE_LIMIT_PLAN = [
  { title: 'Token bucket middleware', files: ['src/middleware/rateLimit.ts'] },
  { title: 'Per-key overrides from config', files: ['src/config/limits.ts'] },
  { title: 'Tests for 429 responses', files: ['src/middleware/rateLimit.test.ts'] },
];
const LOGIN_PLAN = [
  { title: 'Find why the session cookie is dropped', files: ['src/auth/session.ts'] },
  { title: 'Fix the redirect after login', files: ['src/pages/login.tsx'] },
];

export const DRIFT_CASES: DriftCase[] = [
  // A greeting first, then the real task: never a drift.
  { name: 'hi, then a task', turns: ['hi'], prompt: 'fix the login bug on the signup page', isOffGoal: false },
  { name: 'hello there, then a task', turns: ['hello there'], prompt: 'can you add dark mode to the settings page', isOffGoal: false },
  { name: 'hey, then a question about the repo', turns: ['hey'], prompt: 'what does this repo do?', isOffGoal: false },
  { name: 'thanks, then a task', turns: ['hi', { agent: 'Hi! What should we work on?' }], prompt: 'Add pagination to the users table', isOffGoal: false },
  { name: 'good morning, how are you, then a task', turns: ['good morning', 'how are you doing'], prompt: 'Migrate the auth flow to Better Auth', isOffGoal: false },
  { name: 'greeting, task, then a follow-up', turns: ['hi', 'fix the flaky checkout e2e test'], prompt: 'it still times out on the payment step', isOffGoal: false },

  // Follow-ups and clarifications.
  { name: 'why question', turns: ['Add rate limiting to the public API'], steps: RATE_LIMIT_PLAN, prompt: 'why did you pick a token bucket over a sliding window?', isOffGoal: false },
  { name: 'error report', turns: ['Add rate limiting to the public API'], steps: RATE_LIMIT_PLAN, prompt: 'the tests fail with ECONNREFUSED on redis', isOffGoal: false },
  { name: 'pronoun follow-up', turns: ['Fix the login redirect loop'], steps: LOGIN_PLAN, prompt: 'that still sends me back to the home page in Safari', isOffGoal: false },
  { name: 'show me', turns: ['Fix the login redirect loop'], steps: LOGIN_PLAN, prompt: 'show me the diff before you commit', isOffGoal: false },
  { name: 'run the tests', turns: ['Add rate limiting to the public API'], steps: RATE_LIMIT_PLAN, prompt: 'run the whole test suite and tell me what breaks', isOffGoal: false },
  { name: 'file question', turns: ['Fix the login redirect loop'], steps: LOGIN_PLAN, prompt: 'where is the session cookie set?', isOffGoal: false },

  // Steering.
  { name: 'use X instead', turns: ['Add rate limiting to the public API'], steps: RATE_LIMIT_PLAN, prompt: 'use a sliding window instead', isOffGoal: false },
  { name: 'revert', turns: ['Fix the login redirect loop'], steps: LOGIN_PLAN, prompt: 'revert your last change, it broke signup', isOffGoal: false },
  { name: 'stop and plan', turns: ['Migrate auth to Better Auth'], prompt: "stop, don't touch the database schema yet, write a plan first", isOffGoal: false },
  { name: 'keep going', turns: ['Migrate auth to Better Auth'], prompt: 'looks good, keep going', isOffGoal: false },
  { name: 'library swap', turns: ['Add form validation to the signup form'], prompt: 'switch to zod for the schemas', isOffGoal: false },

  // Answers to the agent's question.
  { name: 'answer: which store', turns: ['Add rate limiting to the public API', { agent: 'Should the counters live in Redis or in memory?' }], steps: RATE_LIMIT_PLAN, prompt: 'Redis, we already run it in prod', isOffGoal: false },
  { name: 'answer: numbers', turns: ['Add rate limiting to the public API', { agent: 'What limit should free keys get?' }], steps: RATE_LIMIT_PLAN, prompt: '100 requests per minute, 1000 for paid plans', isOffGoal: false },
  { name: 'answer: choice', turns: ['Migrate auth to Better Auth', { agent: 'Do you want me to keep the old sessions valid during the switch?' }], prompt: 'yes for two weeks, then expire them', isOffGoal: false },

  // Small related additions: scope, not drift.
  { name: 'also a header', turns: ['Add rate limiting to the public API'], steps: RATE_LIMIT_PLAN, prompt: 'also return a Retry-After header on 429 responses', isOffGoal: false },
  { name: 'related log line', turns: ['Fix the login redirect loop'], steps: LOGIN_PLAN, prompt: 'add a log line when the session cookie is missing', isOffGoal: false },
  { name: 'docs for the change', turns: ['Add rate limiting to the public API'], steps: RATE_LIMIT_PLAN, prompt: 'document the limits in the API README', isOffGoal: false },
  { name: 'lint fix in touched file', turns: ['Fix the login redirect loop'], steps: LOGIN_PLAN, prompt: 'fix the lint warnings in session.ts while you are there', isOffGoal: false },

  // Genuine side quests: suggest a new thread.
  { name: 'marketing typo', turns: ['Add rate limiting to the public API'], steps: RATE_LIMIT_PLAN, prompt: 'Fix the typo in the marketing landing page hero', isOffGoal: true },
  { name: 'unrelated feature', turns: ['Fix the login redirect loop'], steps: LOGIN_PLAN, prompt: 'Build a CSV export for the billing invoices page', isOffGoal: true },
  { name: 'dependency chore', turns: ['Add rate limiting to the public API'], steps: RATE_LIMIT_PLAN, prompt: 'Upgrade the whole monorepo to React 20 and fix whatever breaks', isOffGoal: true },
  { name: 'different bug', turns: ['Fix the login redirect loop'], steps: LOGIN_PLAN, prompt: 'The image uploader crashes on HEIC files from iPhones, fix that', isOffGoal: true },
  { name: 'infra', turns: ['Add form validation to the signup form'], prompt: 'Set up a GitHub Actions workflow that deploys the docs site to Cloudflare Pages', isOffGoal: true },
  { name: 'side quest after a greeting and a task', turns: ['hey', 'Add pagination to the users table'], prompt: 'Write a Slack bot that posts our weekly deploy notes', isOffGoal: true },
  { name: 'new screen', turns: ['Migrate auth to Better Auth'], prompt: 'Design an onboarding tour for the analytics dashboard', isOffGoal: true },
  { name: 'unrelated perf', turns: ['Add dark mode to the settings page'], prompt: 'Profile the nightly ETL job and cut its runtime in half', isOffGoal: true },
];

const emptyState = () => ({ ...initialThreads(null, false), ...initialQueue(null, false), spaceId: 'personal', views: {} }) as unknown as State;

/** The thread as the store has it when `c.prompt` is typed: created from the first turn, then each turn sent or said. */
export function replay(c: DriftCase) {
  const [first, ...rest] = c.turns;
  const run = (s: State, action: Action) => threadsReducer(s, action);
  let s = run(emptyState(), { type: 'create', title: first as string, provider: 'claude', project: null, isLive: true });
  const id = s.threads.at(-1)!.id;
  // What `useGoalDrafts` does offline after each of your messages.
  const draft = (state: State) => {
    const request = goalDraftRequest(state.threads.find((t) => t.id === id)!);
    const proposal = request && localGoalDraft(request.text);
    return proposal?.kind === 'task' ? run(state, { type: 'goal-drafted', threadId: id, outcome: proposal.outcome, criteria: [] }) : state;
  };
  s = draft(s);
  if (c.steps) {
    const steps = c.steps.map((st, i) => ({ id: `${id}-p${i}`, title: st.title, size: 1 as const, status: 'ready' as const, progress: 0, footprint: st.files ?? [], addedAt: s.now, addedBy: 'claude' as const, revision: 1 }));
    s = { ...s, threads: mapThread(s.threads, id, (t) => ({ ...t, steps })) };
  }
  for (const turn of rest)
    s = typeof turn === 'string' ? draft(run(s, { type: 'send', threadId: id, text: turn, drift: 'on-goal', reason: 'replay' })) : run(s, { type: 'say', threadId: id, entry: { who: 'claude', kind: 'message', text: turn.agent } });
  return s.threads.find((t) => t.id === id)!;
}

/** Precision and recall of `flags` (true = would suggest a new thread) against the labels. */
export function score(flags: boolean[], cases = DRIFT_CASES) {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  cases.forEach((c, i) => {
    if (flags[i] && c.isOffGoal) tp++;
    else if (flags[i]) fp++;
    else if (c.isOffGoal) fn++;
  });
  return { tp, fp, fn, precision: tp + fp ? tp / (tp + fp) : 1, recall: tp + fn ? tp / (tp + fn) : 1 };
}
