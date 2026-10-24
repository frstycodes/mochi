import type { GitHost } from '../types/git.ts';
import { desktopNamespace } from './rpc.ts';

export const git = (): GitHost => desktopNamespace('git');
