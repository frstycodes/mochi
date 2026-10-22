import type { UsageHost } from '../types/usage.ts';
import { desktopNamespace } from './rpc.ts';

export const usage = (): UsageHost => desktopNamespace('usage');
