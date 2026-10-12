import type { ScheduleHost } from '../types/schedule.ts';
import { bridge } from './bridge.ts';

export const schedule = (): ScheduleHost => bridge().schedule;
