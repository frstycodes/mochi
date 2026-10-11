import type { NotifyHost } from '../types/notify.ts';
import { bridge } from './bridge.ts';

export const notify = (): NotifyHost => bridge().notify;
