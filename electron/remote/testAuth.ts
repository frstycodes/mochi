import type { AuthenticateDevice, AuthenticatedDevice } from './auth.ts';

/** Tests only: `auth` is a bare token looked up in `devices`. No real device authenticates this way. */
export function tokenAuth(devices: Record<string, AuthenticatedDevice>): AuthenticateDevice {
  return async ({ auth }) => (typeof auth === 'string' && Object.hasOwn(devices, auth) ? devices[auth] : { refusal: 'Unknown device' });
}
