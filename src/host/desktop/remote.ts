import type { RemoteHost } from '../types/remote.ts';
import { bridge } from './bridge.ts';

export const remote = (): RemoteHost => bridge().remote;
