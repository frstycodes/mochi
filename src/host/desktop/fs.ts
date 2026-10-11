import type { FsHost } from '../types/fs.ts';
import { bridge } from './bridge.ts';

export const fs = (): FsHost => bridge().fs;
