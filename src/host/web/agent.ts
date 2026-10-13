import { localClassifier } from '../../drift.ts';
import { demoReviewer } from '../../secondOpinion/demo.ts';
import { chunks, mockAnswer } from '../../sidechat/mockAnswer.ts';
import { CLAUDE_FALLBACK_MODELS } from '../../runtime/models.ts';
import { demoLimits } from '../../usage/demoLimits.ts';
import type { AgentAskEvent, AgentEvent, AgentHost, AgentModel } from '../types/agent.ts';

const listeners = new Set<(event: AgentEvent) => void>();
const askListeners = new Set<(event: AgentAskEvent) => void>();
let nextId = 0;

const emitAsk = (event: AgentAskEvent) => askListeners.forEach((listener) => listener(event));

// GAP: no runtime in the web build; threads run on the demo adapter (src/runtime/demo.ts), so these only end the turn.
const endTurn = async (threadId: string) => {
  setTimeout(() => listeners.forEach((listener) => listener({ threadId, type: 'turn-end', status: 'interrupted' })), 0);
};

export const agent: AgentHost = {
  start: endTurn,
  send: endTurn,
  interrupt: endTurn,
  stop: endTurn,
  async resolve() {},
  onEvent(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  async ask(context, messages) {
    const id = `ask-${++nextId}`;
    const parts = chunks(mockAnswer(context, messages));
    parts.forEach((text, i) => setTimeout(() => emitAsk({ id, type: 'text', text }), 200 + i * 25));
    setTimeout(() => emitAsk({ id, type: 'done', text: '' }), 220 + parts.length * 25);
    return { id };
  },
  onAskEvent(listener) {
    askListeners.add(listener);
    return () => askListeners.delete(listener);
  },
  ...demoReviewer,
  async classify(prompt, thread) {
    return localClassifier(prompt, thread);
  },
  async rewindFiles() {},
  async stopSubagent() {},
  // No agents in the web build, so no tool calls.
  onToolCall: () => () => {},
  async toolResult() {},
  async warm() {},
  async limits(provider) {
    return demoLimits(provider);
  },
  onLimits: () => () => {},
  async models(provider) {
    return provider === 'claude' ? CLAUDE_FALLBACK_MODELS : DEMO_CODEX_MODELS;
  },
};

// GAP: demo data. The desktop build reads each account's real list from `codex app-server` (`model/list`).
const CODEX_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
const DEMO_CODEX_MODELS: AgentModel[] = [
  { id: 'gpt-6-astra', name: 'GPT-6-Astra', description: 'Frontier intelligence for the most demanding work.', efforts: [...CODEX_EFFORTS, 'ultra'], defaultEffort: 'low', isDefault: true },
  { id: 'gpt-6-sol', name: 'GPT-6-Sol', description: 'Previous generation workhorse model.', efforts: [...CODEX_EFFORTS, 'ultra'], defaultEffort: 'medium', isDefault: false },
  { id: 'gpt-6-luna', name: 'GPT-6-Luna', description: 'Fast and affordable model for easier tasks.', efforts: CODEX_EFFORTS, defaultEffort: 'medium', isDefault: false },
];
