import type { SimHost } from '../types/sim.ts';
import { bridge } from './bridge.ts';

export const sim = (): SimHost => bridge().sim;
