import { isConcrete } from '../drift.ts';
import type { Thread } from '../model.ts';
import { outcomePrompt } from '../utility/prompts.ts';

export interface GoalProposal {
  kind: 'task' | 'chat';
  outcome: string;
  criteria: string[];
}

const EARLIER_MESSAGES = 4;
const OUTCOME_MAX = 80;
const QUESTION = /\?\s*$|^(why|what|how|where|which|when|who|is|are|does|did|do|can|could|would|should|explain|tell me)\b/i;

/** Your newest message, when the thread has no goal yet and it's worth drafting one from; null otherwise. */
export function goalDraftRequest(t: Thread) {
  if (t.goal || t.isGoalOff || t.status === 'settled') return null;
  const messages = t.activity.filter((e) => e.kind === 'message' && typeof e.text === 'string');
  const latest = messages.findLast((e) => e.who === 'you');
  if (!latest || !isConcrete(latest.text)) return null;
  const earlier = messages
    .slice(0, messages.lastIndexOf(latest))
    .slice(-EARLIER_MESSAGES)
    .map((m) => `${m.who === 'you' ? 'User' : 'Agent'}: ${m.text.slice(0, 400)}`);
  return { key: `${t.id}:${latest.at}:${latest.text}`, text: latest.text, prompt: outcomePrompt(t.repo?.project ?? null, latest.text, earlier) };
}

/** No model answered (web build, offline, timeout): questions stay chats, any other concrete request becomes the outcome as written. */
export function localGoalDraft(text: string): GoalProposal {
  const trimmed = text.trim();
  if (QUESTION.test(trimmed)) return { kind: 'chat', outcome: '', criteria: [] };
  const outcome = trimmed.split('\n')[0].replace(/[.!]+$/, '');
  return { kind: 'task', outcome: outcome.length > OUTCOME_MAX ? `${outcome.slice(0, OUTCOME_MAX - 1)}…` : outcome, criteria: [] };
}
