import type { FsHost } from '../types/fs.ts';
import { desktopNamespace } from './rpc.ts';

export const fs = (): FsHost => desktopNamespace('fs');
