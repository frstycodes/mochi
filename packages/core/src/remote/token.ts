import { createHmac, timingSafeEqual } from 'node:crypto';
import { Schema } from 'effect';
import { Relay } from '@mochi/schema';

/** Who a tunnelled connection is: a paired device, with what it may do here. */
export const DeviceGrant = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  scopes: Schema.Array(Relay.Scope),
});
export type DeviceGrant = typeof DeviceGrant.Type;

const SignedGrant = Schema.fromJsonString(
  Schema.Struct({ ...DeviceGrant.fields, exp: Schema.Number }),
);
const PREFIX = 'd1.';
/** Checked only at the upgrade, and main mints one per dial, so it need not live long. */
const LIFETIME_MS = 5 * 60_000;

/**
 * A token for one device's tunnel into Core, signed with Core's own token: Core checks it without keeping any state, so it
 * still works after Core restarts. It carries the device's scopes, never `local`, and never leaves this computer.
 */
export function mintDeviceToken(
  secret: string,
  grant: DeviceGrant,
  now = Date.now(),
) {
  const body = Buffer.from(
    Schema.encodeSync(SignedGrant)({ ...grant, exp: now + LIFETIME_MS }),
  ).toString('base64url');
  return `${PREFIX}${body}.${sign(secret, body)}`;
}

/** The grant a token carries, when `secret` signed it and it hasn't expired. */
export function verifyDeviceToken(
  secret: string,
  token: string,
  now = Date.now(),
): DeviceGrant | undefined {
  if (!token.startsWith(PREFIX)) return undefined;
  const [body, mac, ...rest] = token.slice(PREFIX.length).split('.');
  if (!body || !mac || rest.length) return undefined;
  const expected = Buffer.from(sign(secret, body));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given))
    return undefined;
  const decoded = Schema.decodeUnknownOption(SignedGrant)(
    Buffer.from(body, 'base64url').toString('utf8'),
  );
  if (decoded._tag === 'None' || decoded.value.exp <= now) return undefined;
  const { exp: _exp, ...grant } = decoded.value;
  return grant;
}

const sign = (secret: string, body: string) =>
  createHmac('sha256', secret).update(body).digest('base64url');
