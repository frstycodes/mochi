import type { ThemesHost } from '../types/themes.ts';
import { desktopNamespace } from './rpc.ts';

export const themes = (): ThemesHost => desktopNamespace('themes');
