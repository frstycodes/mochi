import type { DataHost } from '../types/data.ts';
import { desktopNamespace } from './rpc.ts';

export const data = (): DataHost => desktopNamespace('data');
