import type { AgentAskContext, AgentAskMessage, AgentEvent, AgentHost } from '../../src/host/types/agent.ts';
import { chunks, mockAnswer } from '../../src/sidechat/mockAnswer.ts';
import { notImplemented, record, type Handlers } from './handlers.ts';

let nextId = 0;

export const agent = {
  start: notImplemented('agent.start'),
  async ask(sender, context, messages) {
    record(context, 'context');
    if (!Array.isArray(messages) || messages.length > 200) throw new TypeError('messages must be an array of up to 200');
    const id = `ask-${++nextId}`;
    const send = (event: AgentEvent) => !sender.isDestroyed() && sender.send('agent:onEvent', event);
    const parts = chunks(mockAnswer(context as unknown as AgentAskContext, messages as AgentAskMessage[]));
    parts.forEach((text, i) => setTimeout(() => send({ id, type: 'text', text }), 200 + i * 25));
    setTimeout(() => send({ id, type: 'done', text: '' }), 220 + parts.length * 25);
    return { id };
  },
} satisfies Handlers<AgentHost>;
