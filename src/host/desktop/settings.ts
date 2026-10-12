import type { SettingsHost } from '../types/settings.ts';
import { bridge } from './bridge.ts';

export const settings = (): SettingsHost => bridge().settings;
