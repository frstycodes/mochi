import type { ThemesHost } from '../types/themes.ts';
import { bridge } from './bridge.ts';

export const themes = (): ThemesHost => bridge().themes;
