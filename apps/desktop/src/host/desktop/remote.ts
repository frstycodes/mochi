import type { RemoteHost } from '../types/remote.ts';
import { desktopNamespace } from './rpc.ts';

export const remote = (): RemoteHost => desktopNamespace('remote');
