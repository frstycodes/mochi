import type { AgentHost } from '../../src/host/types/agent.ts';
import { notImplemented, type Handlers } from './handlers.ts';

export const agent = {
  start: notImplemented('agent.start'),
} satisfies Handlers<AgentHost>;
