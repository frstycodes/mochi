import type { WindowsHost } from '../types/windows.ts';
import { bridge } from './bridge.ts';

export const windows = (): WindowsHost => bridge().windows;
