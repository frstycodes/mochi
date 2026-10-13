import sodium from 'libsodium-wrappers';
import type { DeviceKeys } from './keys.ts';

const PROOF_CONTEXT = 'mochi-e2e-device-proof-v1:';
const CHALLENGE_BYTES = 32;

/** A fresh nonce per connection; the machine sends it in clear and keeps it for `verifyProof`. */
export async function createChallenge(): Promise<Uint8Array> {
  await sodium.ready;
  return sodium.randombytes_buf(CHALLENGE_BYTES);
}

export async function proveKey(keys: DeviceKeys, challenge: Uint8Array): Promise<Uint8Array> {
  await sodium.ready;
  return sodium.crypto_sign_detached(proofMessage(challenge), keys.privateKey);
}

/** For the remote-server's `authenticateDevice`: true only when `proof` was signed by `publicKey`'s private key over `challenge`. */
export async function verifyProof(publicKey: Uint8Array, challenge: Uint8Array, proof: Uint8Array): Promise<boolean> {
  await sodium.ready;
  if (challenge.length !== CHALLENGE_BYTES || proof.length !== sodium.crypto_sign_BYTES) return false;
  return sodium.crypto_sign_verify_detached(proof, proofMessage(challenge), publicKey);
}

function proofMessage(challenge: Uint8Array): Uint8Array {
  return Buffer.concat([sodium.from_string(PROOF_CONTEXT), challenge]);
}

/**
 * Asks on the owning machine's screen whether to trust a device ("Allow <device>?"), also when it arrives through the relay.
 * TODO(remote-server): implement with the approval prompt and call it at pairing, before the device's public key is stored.
 */
export type ApproveDevice = (device: { name: string; publicKey: Uint8Array }) => Promise<boolean>;
