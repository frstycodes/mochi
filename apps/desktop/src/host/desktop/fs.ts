import type { FsHost } from '@mochi/domain/host/types/fs';
import { desktopNamespace } from './rpc.ts';

export const fs = (): FsHost => desktopNamespace('fs');
