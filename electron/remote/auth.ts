import type { Scope } from '../../src/host/types/remote.ts';
import type { HelloFrame } from './protocol.ts';

export interface AuthenticatedDevice {
  deviceId: string;
  name: string;
  scopes: Scope[];
}

/** Says which paired device sent a hello frame, or why it is refused. */
export type AuthenticateDevice = (hello: HelloFrame) => Promise<AuthenticatedDevice | { refusal: string }>;

// TODO(account/e2e): pairing goes through the account's device list (`account`, `relay`), and each connection proves the
// device key against a fresh challenge (`e2e`). Until both land no device is paired, so every connection is refused.
export const authenticateDevice: AuthenticateDevice = async () => ({ refusal: 'Pairing a device needs a Mochi account, which isn’t available yet' });
