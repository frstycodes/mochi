import type { ThemesHost } from '@mochi/domain/host/types/themes';
import { desktopNamespace } from './rpc.ts';

export const themes = (): ThemesHost => desktopNamespace('themes');
