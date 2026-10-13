import { isConcrete } from '../drift.ts';
import type { Similar, Thread } from '../model.ts';
import { similarity } from '../progress.ts';
import { outcomePrompt, type DraftedCriterion } from '../utility/prompts.ts';

export interface GoalProposal {
  kind: 'task' | 'chat';
  outcome: string;
  criteria: DraftedCriterion[];
  similar: Similar[];
}

const EARLIER_MESSAGES = 4;
const SHORTLIST = 5;
// Word overlap only shortlists; the model decides what is really the same work.
const SHORTLIST_MIN = 0.34;
// Offline, only near-identical wording counts, and only as related: never claim same work without the model.
const LOCAL_RELATED = 0.8;
const OUTCOME_MAX = 80;
const QUESTION = /\?\s*$|^(why|what|how|where|which|when|who|is|are|does|did|do|can|could|would|should|explain|tell me)\b/i;

/** Your newest message, when the thread has no goal yet and it's worth drafting one from; null otherwise. `threads` are compared for duplicate work. */
export function goalDraftRequest(t: Thread, threads: Thread[] = []) {
  if (t.goal || t.isGoalOff || t.status === 'settled') return null;
  const messages = t.activity.filter((e) => e.kind === 'message' && typeof e.text === 'string');
  const latest = messages.findLast((e) => e.who === 'you');
  if (!latest || !isConcrete(latest.text)) return null;
  const earlier = messages
    .slice(0, messages.lastIndexOf(latest))
    .slice(-EARLIER_MESSAGES)
    .map((m) => `${m.who === 'you' ? 'User' : 'Agent'}: ${m.text.slice(0, 400)}`);
  const others = shortlist(t, latest.text, threads);
  const related = others.filter((o) => o.score >= LOCAL_RELATED).map((o) => ({ threadId: o.o.id, relation: 'related' as const }));
  return { key: `${t.id}:${latest.at}:${latest.text}`, text: latest.text, others: others.map((o) => o.o.id), related, prompt: outcomePrompt(t.repo?.project ?? null, latest.text, earlier, others.map((o) => describe(o.o))) };
}

/** Goals in the same profile, active or settled, sharing enough words with the message to be worth asking about. */
function shortlist(t: Thread, text: string, threads: Thread[]) {
  return threads
    .filter((o) => o.id !== t.id && o.spaceId === t.spaceId && o.goal)
    .map((o) => ({ o, score: similarity(text, `${o.goal} ${o.title}`) }))
    .filter(({ score }) => score >= SHORTLIST_MIN)
    .sort((a, b) => b.score - a.score)
    .slice(0, SHORTLIST);
}

function describe(o: Thread) {
  const prs = o.prs.map((p) => `PR #${p.number} ${p.state}`).join(', ');
  return `[${o.id}] ${o.goal} (${o.status}${prs ? `, ${prs}` : ''})`;
}

/** No model answered (web build, offline, timeout): questions stay chats, any other concrete request becomes the outcome as written. */
export function localGoalDraft(text: string): GoalProposal {
  const trimmed = text.trim();
  if (QUESTION.test(trimmed)) return { kind: 'chat', outcome: '', criteria: [], similar: [] };
  const outcome = trimmed.split('\n')[0].replace(/[.!]+$/, '');
  return { kind: 'task', outcome: outcome.length > OUTCOME_MAX ? `${outcome.slice(0, OUTCOME_MAX - 1)}…` : outcome, criteria: [], similar: [] };
}
