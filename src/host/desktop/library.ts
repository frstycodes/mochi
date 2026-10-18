import type { LibraryHost } from '../types/library.ts';
import { bridge } from './bridge.ts';

export const library = (): LibraryHost => bridge().library;
