import type { FsHost } from '../../src/host/types/fs.ts';
import { notImplemented, type Handlers } from './handlers.ts';

export const fs = {
  readDir: notImplemented('fs.readDir'),
  readFile: notImplemented('fs.readFile'),
} satisfies Handlers<FsHost>;
