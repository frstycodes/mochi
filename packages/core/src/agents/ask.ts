import type { AgentAskContext, AgentAskMessage, AgentAskModel } from '../../../../src/host/types/agent.ts';
import type { ModelChoice } from '../../../../src/host/types/settings.ts';
import type { Provider } from '../../../../src/model.ts';
import { UTILITY_INSTRUCTIONS, utilityCandidates, type UtilityTask } from '../../../../src/utility/prompts.ts';

const UTILITY_TIMEOUT_MS = 20_000;

/** One provider's side chat answer: text chunks for `prompt`, with `instructions` holding the thread context. */
export type Asker = (spaceId: string, instructions: string, prompt: string, model: string | undefined, abort: AbortController) => AsyncIterable<string>;

/** Side chat: the same context and transcript for either provider, answered on the profile's account for `model.provider`. */
export async function* ask(askers: Record<Provider, Asker>, context: AgentAskContext, messages: AgentAskMessage[], model: AgentAskModel, abort: AbortController) {
  const prompt = messages.map((m) => `${m.role === 'user' ? 'User' : 'You'}: ${m.text}`).join('\n\n');
  const instructions = `Answer side questions about a coding agent's thread from the context below, briefly, in Markdown. You cannot run tools or change anything.\n\n<thread>\n${JSON.stringify(context, null, 1)}\n</thread>`;
  const startedAt = performance.now();
  let isFirst = true;
  for await (const text of askers[model.provider](context.spaceId, instructions, prompt, model.model, abort)) {
    if (isFirst) console.info(`side chat: ${model.provider} ${model.model ?? '(default model)'} first token in ${Math.round(performance.now() - startedAt)}ms`);
    isFirst = false;
    yield text;
  }
}

/**
 * A background task's answer from the first candidate (`utilityCandidates`) that answers before the deadline, on the
 * profile's accounts and never an API key (the askers don't pass one). Null when none does: the caller keeps its local
 * behaviour. `offers` lists a provider's model ids for the account; a candidate it doesn't list is skipped, an empty list
 * (unreadable) lets it try.
 */
export async function utility(askers: Record<Provider, Asker>, offers: (provider: Provider) => Promise<string[]>, choice: ModelChoice, spaceId: string, task: UtilityTask, prompt: string, timeoutMs = UTILITY_TIMEOUT_MS) {
  const abort = new AbortController();
  const deadline = setTimeout(() => abort.abort(), timeoutMs);
  try {
    for (const { provider, model } of utilityCandidates(choice)) {
      const ids = await offers(provider);
      if (abort.signal.aborted) return null;
      if (ids.length && !ids.includes(model)) continue;
      try {
        let text = '';
        for await (const chunk of askers[provider](spaceId, UTILITY_INSTRUCTIONS[task], prompt, model, abort)) text += chunk;
        if (abort.signal.aborted) return null;
        if (text.trim()) return { provider, model, text };
      } catch (error) {
        if (abort.signal.aborted) return null;
        console.warn(`${task}: ${provider} ${model} failed, trying the next model`, error);
      }
    }
    return null;
  } finally {
    clearTimeout(deadline);
  }
}
