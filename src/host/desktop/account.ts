import type { AccountHost } from '../types/account.ts';
import { desktopNamespace } from './rpc.ts';

export const account = (): AccountHost => desktopNamespace('account');
