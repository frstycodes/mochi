import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import sodium from 'libsodium-wrappers';
import { newMail, openMail, sealMail, type MailSender } from './mailbox.ts';
import { deviceId } from './pairing.ts';
import type { DeviceKeys } from './session.ts';

await sodium.ready;

const keypair = (): DeviceKeys => sodium.crypto_sign_keypair();
const NOW = 1_000_000;
const CLONE = {
  type: 'clone-project',
  source: { github: 'frstycodes/mochi' },
} as const;

function setup() {
  const mac = keypair();
  const pc = keypair();
  const members = new Map<string, MailSender>([
    [deviceId(mac.publicKey), { publicKey: mac.publicKey, mayManage: true }],
  ]);
  const open = (
    sealed: string,
    { seen = new Set<string>(), now = NOW, keys = pc } = {},
  ) => openMail(sealed, keys, (id) => members.get(id), seen, now);
  return { mac, pc, members, open };
}

test('a message from a current member opens on the computer it was sealed to, and the relay sees none of it', () => {
  const { mac, pc, open } = setup();
  const mail = newMail(mac, CLONE, NOW);
  const body = sealMail(mail, mac, pc.publicKey);
  assert.deepEqual(open(body.sealed), { mail });
  assert.equal(body.id, mail.id);
  assert.equal(body.expiresAt, mail.expiresAt);
  assert.doesNotMatch(
    JSON.stringify(body),
    /clone-project|frstycodes|mochi/,
    'the relay stores ciphertext, an id and an expiry',
  );
});

test('a removed member’s message, a forged one and one sealed elsewhere are refused', () => {
  const { mac, pc, members, open } = setup();
  const mail = newMail(mac, CLONE, NOW);
  const { sealed } = sealMail(mail, mac, pc.publicKey);

  assert.deepEqual(open(sealed, { keys: keypair() }), {
    refused: 'It isn’t sealed to this computer',
  });

  const impostor = keypair();
  const forged = sealMail(mail, impostor, pc.publicKey).sealed;
  assert.deepEqual(open(forged), {
    refused: 'Its signature doesn’t match its sender',
  });

  members.delete(deviceId(mac.publicKey));
  assert.deepEqual(open(sealed), {
    refused: 'Its sender isn’t one of your computers now',
  });
});

test('an expired message, a replayed id and a member without manage are refused', () => {
  const { mac, pc, members, open } = setup();
  const mail = newMail(mac, CLONE, NOW);
  const { sealed } = sealMail(mail, mac, pc.publicKey);

  assert.deepEqual(open(sealed, { now: mail.expiresAt }), {
    refused: 'It expired',
  });
  assert.deepEqual(open(sealed, { seen: new Set([mail.id]) }), {
    refused: 'It already ran',
  });
  members.set(deviceId(mac.publicKey), {
    publicKey: mac.publicKey,
    mayManage: false,
  });
  assert.deepEqual(open(sealed), {
    refused: 'Its sender may not change projects here',
  });
});

test('only project operations travel by mail: anything else is refused even when signed', () => {
  const { mac, pc, open } = setup();
  const send = {
    ...newMail(mac, CLONE, NOW),
    command: { type: 'send', threadId: 't', text: 'spend usage' },
  };
  const { sealed } = sealMail(send as never, mac, pc.publicKey);
  assert.deepEqual(open(sealed), {
    refused: 'It isn’t a message this computer reads',
  });
});
