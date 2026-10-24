import type { SimHost } from '../types/sim.ts';
import { desktopNamespace } from './rpc.ts';

export const sim = (): SimHost => desktopNamespace('sim');
