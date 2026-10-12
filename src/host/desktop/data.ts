import type { DataHost } from '../types/data.ts';
import { bridge } from './bridge.ts';

export const data = (): DataHost => bridge().data;
