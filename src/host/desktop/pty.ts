import type { PtyHost } from '../types/pty.ts';
import { bridge } from './bridge.ts';

export const pty = (): PtyHost => bridge().pty;
