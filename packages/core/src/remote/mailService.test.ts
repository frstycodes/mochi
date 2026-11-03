import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'vite-plus/test';
import sodium from 'libsodium-wrappers';
import { mailService } from './mailService.ts';
import { deviceId } from './pairing.ts';
import type { DeviceKeys } from './session.ts';

await sodium.ready;

const b64 = (bytes: Uint8Array) =>
  sodium.to_base64(bytes, sodium.base64_variants.ORIGINAL);
const CLONE = {
  type: 'clone-project',
  source: { github: 'frstycodes/mochi' },
} as const;

/** Two computers on one fake relay: the Mac queues for the PC while it's away, the PC drains when it connects. */
function setup() {
  const held = new Map<
    string,
    { id: string; sealed: string; expiresAt: number }[]
  >();
  const relay = {
    listMachines: async () => [{ id: 'pc', publicKey: b64(pcKeys.publicKey) }],
    listMail: async (_token: string, machineId: string) =>
      held.get(machineId) ?? [],
    postMail: async (
      _token: string,
      machineId: string,
      body: { id: string; sealed: string; expiresAt: number },
    ) => void held.set(machineId, [...(held.get(machineId) ?? []), body]),
    ackMail: async (_token: string, machineId: string, id: string) =>
      void held.set(
        machineId,
        (held.get(machineId) ?? []).filter((m) => m.id !== id),
      ),
  };
  const macKeys: DeviceKeys = sodium.crypto_sign_keypair();
  const pcKeys: DeviceKeys = sodium.crypto_sign_keypair();
  const ran: unknown[] = [];
  const logs: string[] = [];
  let macMayManage = true;
  const service = (keys: DeviceKeys, machineId: string) =>
    mailService({
      dir: mkdtempSync(join(tmpdir(), `mail-${machineId}-`)),
      keys: async () => keys,
      token: async () => 't',
      machineId: () => machineId,
      senderOf: (id) =>
        id === deviceId(macKeys.publicKey)
          ? {
              name: 'MacBook Pro',
              publicKey: macKeys.publicKey,
              mayManage: macMayManage,
            }
          : undefined,
      run: async (request) => {
        ran.push(request);
        return { isOk: true };
      },
      log: (line) => logs.push(line),
      relay: relay as never,
    });
  return {
    mac: service(macKeys, 'mac'),
    pc: service(pcKeys, 'pc'),
    held,
    ran,
    logs,
    revoke: () => (macMayManage = false),
  };
}

test('queued while the PC is away, it runs once when the PC connects, is acked, and leaves the Mac’s outbox', async () => {
  const { mac, pc, held, ran } = setup();
  const id = await mac.queue('pc', CLONE);
  assert.deepEqual(
    (await mac.outbox()).map((m) => [m.id, m.machineId, m.command.type]),
    [[id, 'pc', 'clone-project']],
  );
  assert.doesNotMatch(JSON.stringify(held.get('pc')), /frstycodes/);

  await pc.drain();
  assert.deepEqual(ran, [{ id, deviceName: 'MacBook Pro', command: CLONE }]);
  assert.deepEqual(held.get('pc'), [], 'acked, so the relay deletes it');
  assert.deepEqual(await mac.outbox(), [], 'it ran, so it waits no more');
});

test('a message delivered again does nothing, and one from a sender who lost manage is acked without running', async () => {
  const { mac, pc, held, ran, logs, revoke } = setup();
  await mac.queue('pc', CLONE);
  const [copy] = held.get('pc')!;
  await pc.drain();
  held.set('pc', [copy]);
  await pc.drain();
  assert.equal(ran.length, 1, 'a replayed message never runs twice');
  assert.match(logs.at(-1)!, /already ran/);

  revoke();
  await mac.queue('pc', CLONE);
  await pc.drain();
  assert.equal(ran.length, 1);
  assert.match(logs.at(-1)!, /may not change projects here/);
  assert.deepEqual(held.get('pc'), []);
});

test('Cancel takes a queued message back before it runs', async () => {
  const { mac, pc, ran } = setup();
  const id = await mac.queue('pc', CLONE);
  await mac.cancel('pc', id);
  assert.deepEqual(await mac.outbox(), []);
  await pc.drain();
  assert.deepEqual(ran, []);
});
