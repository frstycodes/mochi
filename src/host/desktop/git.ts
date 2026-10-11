import type { GitHost } from '../types/git.ts';
import { bridge } from './bridge.ts';

export const git = (): GitHost => bridge().git;
