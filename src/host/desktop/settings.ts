import type { SettingsHost } from '../types/settings.ts';
import { desktopNamespace } from './rpc.ts';

export const settings = (): SettingsHost => desktopNamespace('settings');
