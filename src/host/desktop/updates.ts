import type { UpdatesHost } from '../types/updates.ts';
import { bridge } from './bridge.ts';

export const updates = (): UpdatesHost => bridge().updates;
