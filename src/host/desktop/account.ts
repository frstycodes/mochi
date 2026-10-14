import type { AccountHost } from '../types/account.ts';
import { bridge } from './bridge.ts';

export const account = (): AccountHost => bridge().account;
