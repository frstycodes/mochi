import type { AgentHost } from '../types/agent.ts';
import { bridge } from './bridge.ts';

export const agent = (): AgentHost => bridge().agent;
