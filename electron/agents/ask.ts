import type { AgentAskContext, AgentAskMessage, AgentAskModel } from '../../src/host/types/agent.ts';
import type { Provider } from '../../src/model.ts';

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
