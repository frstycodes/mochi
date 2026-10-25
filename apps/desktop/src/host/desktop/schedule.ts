import type { ScheduleHost } from '../types/schedule.ts';
import { desktopNamespace } from './rpc.ts';

export const schedule = (): ScheduleHost => desktopNamespace('schedule');
