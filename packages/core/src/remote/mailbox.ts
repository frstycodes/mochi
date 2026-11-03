import sodium from 'libsodium-wrappers';
import { deviceId } from './pairing.ts';
import type { DeviceKeys } from './session.ts';

/**
 * Work for a computer that's offline, waiting at the relay until it connects (plan › Mailbox). Only project operations that
 * spend no usage and are safe to run late: never an agent send, never a path. A message is signed by its sender, then sealed
 * to the recipient's key (`crypto_sign` then `crypto_box_seal`), so the relay holds ciphertext and the recipient can tell who
 * asked. Await `sodium.ready` before any of these.
 */
export const MAIL_COMMANDS = ['clone-project', 'link-project'] as const;

export type MailCommand = { type: (typeof MAIL_COMMANDS)[number] } & Record<
  string,
  unknown
>;

/** What the sender signs. */
export interface Mail {
  id: string;
  /** The sender's device id. */
  from: string;
  at: number;
  expiresAt: number;
  command: MailCommand;
}

/** How long a message waits, and how many a computer's mailbox holds (the relay keeps the same limits). */
export const MAIL_TTL_MS = 14 * 24 * 60 * 60_000;

const DOMAIN = 'mochi-mailbox-v1\n';

/** The relay's body for it: the id and expiry in clear (it routes and expires by them), the rest sealed. */
export function sealMail(
  mail: Mail,
  sender: DeviceKeys,
  recipientPublicKey: Uint8Array,
) {
  const signed = JSON.stringify(mail);
  const signature = b64(
    sodium.crypto_sign_detached(
      sodium.from_string(DOMAIN + signed),
      sender.privateKey,
    ),
  );
  const sealed = sodium.crypto_box_seal(
    sodium.from_string(JSON.stringify({ signed, signature })),
    sodium.crypto_sign_ed25519_pk_to_curve25519(recipientPublicKey),
  );
  return { id: mail.id, sealed: b64(sealed), expiresAt: mail.expiresAt };
}

/** A sender this computer trusts now: its key and whether it may change projects here. */
export interface MailSender {
  publicKey: Uint8Array;
  mayManage: boolean;
}

export type Opened = { mail: Mail } | { refused: string };

/**
 * Opens one message and decides whether to run it: sealed to this computer's key, signed by a current member that may
 * `manage` here, unexpired, not run before (`seen`), and a command the mailbox carries. Anything else is refused.
 */
export function openMail(
  sealed: string,
  keys: DeviceKeys,
  senderOf: (deviceId: string) => MailSender | undefined,
  seen: ReadonlySet<string>,
  now: number,
): Opened {
  let envelope: { signed?: unknown; signature?: unknown };
  try {
    envelope = JSON.parse(
      sodium.to_string(
        sodium.crypto_box_seal_open(
          sodium.from_base64(sealed, sodium.base64_variants.ORIGINAL),
          sodium.crypto_sign_ed25519_pk_to_curve25519(keys.publicKey),
          sodium.crypto_sign_ed25519_sk_to_curve25519(keys.privateKey),
        ),
      ),
    ) as typeof envelope;
  } catch {
    return { refused: 'It isn’t sealed to this computer' };
  }
  const { signed, signature } = envelope;
  if (typeof signed !== 'string' || typeof signature !== 'string')
    return { refused: 'It isn’t signed' };
  const mail = parseMail(signed);
  if (!mail) return { refused: 'It isn’t a message this computer reads' };
  const sender = senderOf(mail.from);
  if (!sender) return { refused: 'Its sender isn’t one of your computers now' };
  if (!verify(signed, signature, sender.publicKey))
    return { refused: 'Its signature doesn’t match its sender' };
  if (!sender.mayManage)
    return { refused: 'Its sender may not change projects here' };
  if (mail.expiresAt <= now) return { refused: 'It expired' };
  if (seen.has(mail.id)) return { refused: 'It already ran' };
  return { mail };
}

function verify(signed: string, signature: string, publicKey: Uint8Array) {
  try {
    return sodium.crypto_sign_verify_detached(
      sodium.from_base64(signature, sodium.base64_variants.ORIGINAL),
      sodium.from_string(DOMAIN + signed),
      publicKey,
    );
  } catch {
    return false;
  }
}

function parseMail(signed: string): Mail | undefined {
  try {
    const mail = JSON.parse(signed) as Partial<Mail>;
    const isCommand = MAIL_COMMANDS.includes(
      mail.command?.type as MailCommand['type'],
    );
    return typeof mail.id === 'string' &&
      typeof mail.from === 'string' &&
      typeof mail.at === 'number' &&
      typeof mail.expiresAt === 'number' &&
      isCommand
      ? (mail as Mail)
      : undefined;
  } catch {
    return undefined;
  }
}

/** A new message from `sender`, expiring after the mailbox's limit. */
export function newMail(
  sender: DeviceKeys,
  command: MailCommand,
  now: number,
): Mail {
  return {
    id: crypto.randomUUID(),
    from: deviceId(sender.publicKey),
    at: now,
    expiresAt: now + MAIL_TTL_MS,
    command,
  };
}

const b64 = (bytes: Uint8Array) =>
  sodium.to_base64(bytes, sodium.base64_variants.ORIGINAL);
