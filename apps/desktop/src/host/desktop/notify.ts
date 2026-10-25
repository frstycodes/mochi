import type { NotifyHost } from '../types/notify.ts';
import { desktopNamespace } from './rpc.ts';

export const notify = (): NotifyHost => desktopNamespace('notify');
