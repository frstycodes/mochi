import type { UsageHost } from '../types/usage.ts';
import { bridge } from './bridge.ts';

export const usage = (): UsageHost => bridge().usage;
