import type { AccountHost } from '@mochi/domain/host/types/account';
import { desktopNamespace } from './rpc.ts';

export const account = (): AccountHost => desktopNamespace('account');
