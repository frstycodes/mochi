import sodium from 'libsodium-wrappers';

/** Ed25519; converted to X25519 for `crypto_kx`. */
export type DeviceKeys = { publicKey: Uint8Array; privateKey: Uint8Array };

/** The machine owns the threads and is the `crypto_kx` server; the device controlling it is the client. */
export type Role = 'machine' | 'device';

export type Session = { encrypt(frame: Uint8Array): Uint8Array; decrypt(bytes: Uint8Array): Uint8Array };

export type Handshake = {
  /** Send to the peer first: static public key, fresh ephemeral public key, and a signature binding them. */
  hello: Uint8Array;
  /** Throws `E2EError` `wrong-key` unless the hello comes from the paired key. */
  finish(peerHello: Uint8Array): Session;
};

export type E2EErrorCode = 'wrong-key' | 'tampered' | 'replayed' | 'out-of-order';

export class E2EError extends Error {
  readonly code: E2EErrorCode;

  constructor(code: E2EErrorCode) {
    super(`e2e: ${code}`);
    this.name = 'E2EError';
    this.code = code;
  }
}

const HELLO_CONTEXT = 'mochi-e2e-hello-v1';
const KEY_BYTES = 32;
const SIGNATURE_BYTES = 64;
const HELLO_BYTES = KEY_BYTES * 2 + SIGNATURE_BYTES;
const SEQ_BYTES = 8;
const HEADER_BYTES = 24;

export async function createHandshake(local: DeviceKeys, peerPublicKey: Uint8Array, role: Role): Promise<Handshake> {
  await sodium.ready;
  const ephemeral = sodium.crypto_kx_keypair();
  const hello = concat([local.publicKey, ephemeral.publicKey, sodium.crypto_sign_detached(helloMessage(role, ephemeral.publicKey), local.privateKey)]);
  return {
    hello,
    finish(peerHello) {
      const peerEphemeral = verifyHello(peerHello, peerPublicKey, role === 'machine' ? 'device' : 'machine');
      const exchange = role === 'device' ? sodium.crypto_kx_client_session_keys : sodium.crypto_kx_server_session_keys;
      const statics = exchange(
        sodium.crypto_sign_ed25519_pk_to_curve25519(local.publicKey),
        sodium.crypto_sign_ed25519_sk_to_curve25519(local.privateKey),
        sodium.crypto_sign_ed25519_pk_to_curve25519(peerPublicKey),
      );
      const ephemerals = exchange(ephemeral.publicKey, ephemeral.privateKey, peerEphemeral);
      sodium.memzero(ephemeral.privateKey);
      return openSession(mix(statics.sharedTx, ephemerals.sharedTx), mix(statics.sharedRx, ephemerals.sharedRx));
    },
  };
}

function verifyHello(peerHello: Uint8Array, peerPublicKey: Uint8Array, peerRole: Role): Uint8Array {
  if (peerHello.length !== HELLO_BYTES) throw new E2EError('wrong-key');
  const claimedKey = peerHello.subarray(0, KEY_BYTES);
  const peerEphemeral = peerHello.subarray(KEY_BYTES, KEY_BYTES * 2);
  const signature = peerHello.subarray(KEY_BYTES * 2);
  if (!sodium.memcmp(claimedKey, peerPublicKey)) throw new E2EError('wrong-key');
  if (!sodium.crypto_sign_verify_detached(signature, helloMessage(peerRole, peerEphemeral), peerPublicKey)) throw new E2EError('wrong-key');
  return peerEphemeral;
}

/** The role is signed so a peer's own hello reflected back to it fails verification. */
function helloMessage(role: Role, ephemeralPublicKey: Uint8Array): Uint8Array {
  return concat([sodium.from_string(`${HELLO_CONTEXT}:${role}`), ephemeralPublicKey]);
}

function mix(staticKey: Uint8Array, ephemeralKey: Uint8Array): Uint8Array {
  return sodium.crypto_generichash(KEY_BYTES, concat([staticKey, ephemeralKey]), null);
}

/**
 * Frame: 8-byte big-endian sequence number, the secretstream header on frame 0, then the ciphertext, whose additional
 * data is the sequence number. The number travels in clear so replays and gaps get their own error before decryption; a
 * relay that rewrites it gets `replayed` or `out-of-order` instead of `tampered`, and the frame is rejected either way.
 */
function openSession(txKey: Uint8Array, rxKey: Uint8Array): Session {
  const push = sodium.crypto_secretstream_xchacha20poly1305_init_push(txKey);
  let sent = 0;
  let pull: ReturnType<typeof sodium.crypto_secretstream_xchacha20poly1305_init_pull> | undefined;
  let received = 0;
  return {
    encrypt(frame) {
      const seq = encodeSeq(sent);
      const cipher = sodium.crypto_secretstream_xchacha20poly1305_push(push.state, frame, seq, sodium.crypto_secretstream_xchacha20poly1305_TAG_MESSAGE);
      return concat([seq, sent++ === 0 ? push.header : new Uint8Array(), cipher]);
    },
    decrypt(bytes) {
      if (bytes.length < SEQ_BYTES) throw new E2EError('tampered');
      const seqBytes = bytes.subarray(0, SEQ_BYTES);
      const seq = new DataView(seqBytes.buffer, seqBytes.byteOffset).getBigUint64(0);
      if (seq < BigInt(received)) throw new E2EError('replayed');
      if (seq > BigInt(received)) throw new E2EError('out-of-order');
      const bodyStart = received === 0 ? SEQ_BYTES + HEADER_BYTES : SEQ_BYTES;
      if (bytes.length < bodyStart) throw new E2EError('tampered');
      // A failed pull leaves the stream state untouched, so the genuine frame still decrypts after a forged one.
      const state = pull ?? sodium.crypto_secretstream_xchacha20poly1305_init_pull(bytes.subarray(SEQ_BYTES, bodyStart), rxKey);
      const result = sodium.crypto_secretstream_xchacha20poly1305_pull(state, bytes.subarray(bodyStart), seqBytes);
      if (!result) throw new E2EError('tampered');
      pull = state;
      received++;
      return result.message;
    },
  };
}

function encodeSeq(seq: number): Uint8Array {
  const bytes = new Uint8Array(SEQ_BYTES);
  new DataView(bytes.buffer).setBigUint64(0, BigInt(seq));
  return bytes;
}

/** `Buffer.concat` output is a `Buffer`, whose `slice` aliases instead of copying: hand callers a plain `Uint8Array`. */
function concat(parts: Uint8Array[]): Uint8Array {
  return new Uint8Array(Buffer.concat(parts));
}
