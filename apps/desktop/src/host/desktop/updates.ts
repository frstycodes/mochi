import type { UpdatesHost } from '@mochi/domain/host/types/updates';
import { desktopNamespace } from './rpc.ts';

export const updates = (): UpdatesHost => desktopNamespace('updates');
