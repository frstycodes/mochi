import type { SimHost } from '@mochi/domain/host/types/sim';
import { desktopNamespace } from './rpc.ts';

export const sim = (): SimHost => desktopNamespace('sim');
