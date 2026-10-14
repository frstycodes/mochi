import sodium from 'libsodium-wrappers';
import type { DeviceKind, Scope } from '../../src/host/types/remote.ts';
import { asKind, THIS_KIND } from './protocol.ts';
import { createHandshake, E2EError, type Session } from './crypto/session.ts';
import type { DeviceKeys } from './crypto/keys.ts';
import type { Link, RawLink } from './link.ts';

/**
 * Every connection opens with one pairing exchange, then carries only ciphertext (DEVICES.md › End-to-end encryption):
 *
 *   device → machine   { type: 'pair', version, name, kind, publicKey, hello, isReturning? }   its key, and a handshake signed with it
 *   machine → device   { type: 'paired', hello } | { type: 'refused', reason }
 *
 * The machine trusts only keys it approved on its own screen; the relay vouches for nothing but the account.
 */
export const PAIRING_VERSION = 1;
const MAX_NAME = 64;
const PAIR_TIMEOUT_MS = 15_000;
/** Long enough for someone to walk over to the machine and read its screen. */
export const APPROVAL_TIMEOUT_MS = 2 * 60_000;

export type Origin = 'lan' | 'relay';

/** A paired device as one connection knows it. */
export interface AuthenticatedDevice {
  deviceId: string;
  name: string;
  kind?: DeviceKind;
  scopes: Scope[];
}

export interface PairedDevice {
  id: string;
  name: string;
  kind?: DeviceKind;
  /** Ed25519, base64. */
  publicKey: string;
  scopes: Scope[];
  pairedAt: number;
}

export interface MachineSide {
  keys: DeviceKeys;
  find(deviceId: string): PairedDevice | undefined;
  /** "Allow <name>?" on this machine's screen, showing `code`; false on No or after `APPROVAL_TIMEOUT_MS`. */
  approve(request: { name: string; code: string }): Promise<boolean>;
  add(device: { id: string; name: string; kind?: DeviceKind; publicKey: string }): PairedDevice;
}

export type Secured = { link: Link; device: AuthenticatedDevice } | { refusal: string };

/** This machine's side of a connection's first exchange. A refusal is sent to the device before the caller closes the link. */
export async function secureAsMachine(raw: RawLink, origin: Origin, side: MachineSide): Promise<Secured> {
  await sodium.ready;
  const frame = await firstFrame(raw, PAIR_TIMEOUT_MS);
  const pair = frame && parsePair(frame);
  if (!pair) return refuse(raw, 'The first frame must be a pairing request');
  if (pair.version !== PAIRING_VERSION) return refuse(raw, `This computer pairs with version ${PAIRING_VERSION}; update Mochi on both`);
  const id = deviceId(pair.publicKey);
  const handshake = await createHandshake(side.keys, pair.publicKey, 'machine');
  let session: Session;
  try {
    // Checks the device holds the key it claims before anyone is asked about it.
    session = handshake.finish(pair.hello);
  } catch {
    return refuse(raw, 'The pairing request wasn’t signed by the key it names');
  }
  let device = side.find(id);
  if (!device) {
    // On the LAN nothing vouches that the device is yours; through the relay it is signed in to your account.
    if (origin === 'lan') return refuse(raw, 'Pair this device through your Mochi account first');
    // Reconnecting on its own after being removed here: nobody at that device asked, so nobody here is asked either.
    if (pair.isReturning) return refuse(raw, 'That computer removed this one; pair again');
    const isAllowed = await side.approve({ name: pair.name, code: pairingCode(side.keys.publicKey, pair.publicKey) });
    if (!isAllowed) return refuse(raw, 'That computer didn’t allow this one');
    if (!raw.isOpen()) return { refusal: 'The device left' };
    device = side.add({ id, name: pair.name, kind: pair.kind, publicKey: sodium.to_base64(pair.publicKey, sodium.base64_variants.ORIGINAL) });
  }
  sendJson(raw, { type: 'paired', hello: b64(handshake.hello) });
  return { link: encrypted(raw, session), device: { deviceId: device.id, name: device.name, kind: pair.kind, scopes: device.scopes } };
}

/**
 * A device's side: names itself, proves its key, and expects the machine at `machinePublicKey`. Rejects with the machine's
 * reason, as a `PairingRefused` when the machine said no. `isReturning`: following a machine it already paired with, so an
 * unknown key is refused instead of asking that machine's user again.
 */
export async function secureAsDevice(raw: RawLink, keys: DeviceKeys, machinePublicKey: Uint8Array, name: string, isReturning = false): Promise<Link> {
  await sodium.ready;
  const handshake = await createHandshake(keys, machinePublicKey, 'device');
  sendJson(raw, { type: 'pair', version: PAIRING_VERSION, name, kind: THIS_KIND, publicKey: b64(keys.publicKey), hello: b64(handshake.hello), ...(isReturning && { isReturning }) });
  const frame = await firstFrame(raw, (isReturning ? 0 : APPROVAL_TIMEOUT_MS) + PAIR_TIMEOUT_MS);
  const reply = frame && parseJson(frame);
  if (reply?.type === 'refused') throw new PairingRefused(typeof reply.reason === 'string' ? reply.reason : 'Refused');
  const hello = typeof reply?.hello === 'string' ? fromB64(reply.hello) : null;
  if (reply?.type !== 'paired' || !hello) throw new Error(frame ? 'The computer answered something unexpected' : 'The computer didn’t answer');
  try {
    return encrypted(raw, handshake.finish(hello));
  } catch (error) {
    // The key the relay listed isn't the one answering: a stale listing, or someone in between.
    if (error instanceof E2EError) throw new PairingRefused('That computer’s key doesn’t match; pair again from its current listing');
    throw error;
  }
}

/** The machine (or its key) said no: retrying the same way gets the same answer. */
export class PairingRefused extends Error {}

/**
 * Six digits both screens show while pairing. Derived from both public keys, so a relay that swapped either key would make
 * them differ; comparing them is what makes trusting the relay's machine list safe.
 */
export function pairingCode(machinePublicKey: Uint8Array, devicePublicKey: Uint8Array): string {
  const hash = sodium.crypto_generichash(8, new Uint8Array([...machinePublicKey, ...devicePublicKey]), null);
  const n = Number(new DataView(hash.buffer, hash.byteOffset).getBigUint64(0) % 1_000_000n);
  const digits = String(n).padStart(6, '0');
  return `${digits.slice(0, 3)} ${digits.slice(3)}`;
}

/** A key's short, URL-safe id: what the relay and the device list call it. Derived, so a device can't pick another's id. */
export function deviceId(publicKey: Uint8Array): string {
  return sodium.to_base64(sodium.crypto_generichash(12, publicKey, null), sodium.base64_variants.URLSAFE_NO_PADDING);
}

/** After pairing: text frames in, ciphertext out. A frame that fails to decrypt ends the connection. */
function encrypted(raw: RawLink, session: Session): Link {
  return {
    send: (text) => raw.send(session.encrypt(sodium.from_string(text))),
    close: (code, reason) => raw.close(code, reason),
    onMessage: (listener) =>
      raw.onMessage((bytes) => {
        let plain: Uint8Array;
        try {
          plain = session.decrypt(bytes);
        } catch {
          return raw.close(4403, 'A frame failed to decrypt');
        }
        listener(sodium.to_string(plain));
      }),
    onClose: (listener) => raw.onClose(() => listener()),
    isOpen: () => raw.isOpen(),
  };
}

function parsePair(bytes: Uint8Array) {
  const frame = parseJson(bytes);
  if (frame?.type !== 'pair' || typeof frame.name !== 'string' || typeof frame.publicKey !== 'string' || typeof frame.hello !== 'string') return null;
  const name = frame.name.trim().slice(0, MAX_NAME);
  const publicKey = fromB64(frame.publicKey);
  const hello = fromB64(frame.hello);
  if (!name || publicKey?.length !== sodium.crypto_sign_PUBLICKEYBYTES || !hello) return null;
  return { version: frame.version, name, kind: asKind(frame.kind), publicKey, hello, isReturning: frame.isReturning === true };
}

/** The first frame, or null when the link closed or `timeoutMs` passed. Later frames are the encrypted link's to read. */
function firstFrame(raw: RawLink, timeoutMs: number): Promise<Uint8Array | null> {
  return new Promise((resolve) => {
    let isDone = false;
    const done = (value: Uint8Array | null) => {
      if (isDone) return;
      isDone = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => done(null), timeoutMs);
    // Takes one frame and steps aside; the next waits for the encrypted link's reader.
    raw.onMessage((bytes) => {
      raw.onMessage(undefined);
      done(bytes);
    });
    raw.onClose(() => done(null));
  });
}

function refuse(raw: RawLink, reason: string): Secured {
  sendJson(raw, { type: 'refused', reason });
  return { refusal: reason };
}

const sendJson = (raw: RawLink, frame: object) => raw.isOpen() && raw.send(sodium.from_string(JSON.stringify(frame)));
const b64 = (bytes: Uint8Array) => sodium.to_base64(bytes, sodium.base64_variants.ORIGINAL);

function fromB64(text: string): Uint8Array | null {
  try {
    return sodium.from_base64(text, sodium.base64_variants.ORIGINAL);
  } catch {
    return null;
  }
}

function parseJson(bytes: Uint8Array): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(sodium.to_string(bytes));
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
