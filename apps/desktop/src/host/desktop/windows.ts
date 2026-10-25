import type { WindowsHost } from '../types/windows.ts';
import { desktopNamespace } from './rpc.ts';

export const windows = (): WindowsHost => desktopNamespace('windows');
