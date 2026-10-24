import type { LibraryHost } from '../types/library.ts';
import { desktopNamespace } from './rpc.ts';

export const library = (): LibraryHost => desktopNamespace('library');
