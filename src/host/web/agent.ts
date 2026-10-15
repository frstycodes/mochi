import { localClassifier } from '../../drift.ts';
import { demoReviewer } from '../../secondOpinion/demo.ts';
import { chunks, mockAnswer } from '../../sidechat/mockAnswer.ts';
import { CLAUDE_FALLBACK_MODELS, claudeFast } from '../../runtime/models.ts';
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
  compact: endTurn,
  async compactInstructions() {},
  interrupt: endTurn,
  stop: endTurn,
  async resolve() {},
  async setupChoice() {},
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
  // No models in the web build: every background task keeps its local behaviour.
  async utility() {
    return null;
  },
  async classify(prompt, thread) {
    return localClassifier(prompt, thread);
  },
  async rewindFiles() {},
  async rewindPoint() {
    return null;
  },
  async stopSubagent() {},
  async attached() {
    return [];
  },
  // No agents in the web build, so no tool calls.
  onToolCall: () => () => {},
  async pendingToolCalls() {
    return [];
  },
  async toolResult() {},
  async warm() {},
  async limits(provider) {
    return demoLimits(provider);
  },
  onLimits: () => () => {},
  async models(provider) {
    return provider === 'claude' ? DEMO_CLAUDE_MODELS : DEMO_CODEX_MODELS;
  },
};

// GAP: demo data. The desktop build reads each account's real list from `codex app-server` (`model/list`).
const CODEX_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
// Tiers shaped like 0.155.1's `serviceTiers`.
const DEMO_CODEX_MODELS: AgentModel[] = [
  { id: 'gpt-6-astra', name: 'GPT-6-Astra', description: 'Frontier intelligence for the most demanding work.', efforts: [...CODEX_EFFORTS, 'ultra'], defaultEffort: 'low', speeds: [{ id: 'priority', name: 'Fast', description: '2x speed, increased usage' }], isDefault: true },
  { id: 'gpt-6-sol', name: 'GPT-6-Sol', description: 'Previous generation workhorse model.', efforts: [...CODEX_EFFORTS, 'ultra'], defaultEffort: 'medium', speeds: [{ id: 'priority', name: 'Fast', description: '1.5x speed, increased usage' }, { id: 'ultrafast', name: 'Ultrafast', description: 'The fastest available responses for latency-sensitive work.' }], isDefault: false },
  { id: 'gpt-6-luna', name: 'GPT-6-Luna', description: 'Fast and affordable model for easier tasks.', efforts: CODEX_EFFORTS, defaultEffort: 'medium', speeds: [], isDefault: false },
];
// GAP: demo data; on desktop fast mode shows only where the account's `supportedModels()` reports it.
const DEMO_CLAUDE_MODELS = CLAUDE_FALLBACK_MODELS.map((m) => (m.id === 'claude-opus-5-5' ? { ...m, speeds: [claudeFast(m.id)] } : m));
