import type { AgentHost } from '../types/agent.ts';
import { desktopNamespace } from './rpc.ts';

export const agent = (): AgentHost => desktopNamespace('agent');
