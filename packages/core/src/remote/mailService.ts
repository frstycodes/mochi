import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sodium from 'libsodium-wrappers';
import type {
  MailCommand,
  QueuedMail,
} from '../../../../apps/desktop/src/host/types/remote.ts';
import { newMail, openMail, sealMail, type MailSender } from './mailbox.ts';
import { ackMail, listMachines, listMail, postMail } from './relayClient.ts';
import type { DeviceKeys } from './session.ts';

interface Deps {
  /** Where `outbox.json` and `mail-seen.json` live, beside `devices.json`. */
  dir: string;
  keys: () => Promise<DeviceKeys>;
  token: () => Promise<string>;
  machineId: () => string;
  /** A current member by device id, with whether its pairing here allows `manage`; undefined once it's removed. */
  senderOf: (deviceId: string) => (MailSender & { name: string }) | undefined;
  /** Runs one command as a device's would run here, in an open interface (`remote.run`). */
  run: (request: {
    id: string;
    deviceName: string;
    command: unknown;
  }) => Promise<unknown>;
  log: (message: string) => void;
  /** The relay's mailbox and listing routes; tests hand in their own. */
  relay?: RelayMail;
}

type RelayMail = {
  listMachines: (
    token: string,
  ) => Promise<readonly { id: string; publicKey: string }[]>;
  listMail: typeof listMail;
  postMail: typeof postMail;
  ackMail: typeof ackMail;
};

const RELAY: RelayMail = { listMachines, listMail, postMail, ackMail };

/** How many run ids this computer remembers, so a message delivered again does nothing. */
const SEEN_LIMIT = 500;

/**
 * The mailbox from both ends: queue work for an offline computer (signed, then sealed to its key) and take it back, and on
 * this computer's own connect, run what waited for it and ack each message so the relay deletes it.
 */
export function mailService(deps: Deps) {
  const outboxFile = join(deps.dir, 'outbox.json');
  const seenFile = join(deps.dir, 'mail-seen.json');
  const { listMachines, listMail, postMail, ackMail } = deps.relay ?? RELAY;

  async function queue(machineId: string, command: MailCommand) {
    await sodium.ready;
    const [keys, token] = await Promise.all([deps.keys(), deps.token()]);
    const machine = (await listMachines(token)).find((m) => m.id === machineId);
    if (!machine) throw new Error('That computer isn’t on your account');
    const mail = newMail(keys, command, Date.now());
    await postMail(
      token,
      machineId,
      sealMail(
        mail,
        keys,
        sodium.from_base64(machine.publicKey, sodium.base64_variants.ORIGINAL),
      ),
    );
    const held = await readJson<QueuedMail[]>(outboxFile, []);
    await writeJson(outboxFile, [
      ...held,
      {
        id: mail.id,
        machineId,
        command,
        at: mail.at,
        expiresAt: mail.expiresAt,
      },
    ]);
    return mail.id;
  }

  /** What still waits: anything the relay no longer holds was run (or expired) and drops out. */
  async function outbox(): Promise<QueuedMail[]> {
    const held = await readJson<QueuedMail[]>(outboxFile, []);
    if (held.length === 0) return held;
    const token = await deps.token();
    const waiting = new Map<string, Set<string> | undefined>();
    for (const machineId of new Set(held.map((m) => m.machineId)))
      waiting.set(
        machineId,
        await listMail(token, machineId).then(
          (mail) => new Set(mail.map((m) => m.id)),
          // Unreachable now: keep what's queued until the relay can say.
          () => undefined,
        ),
      );
    const now = Date.now();
    const left = held.filter(
      (m) => m.expiresAt > now && (waiting.get(m.machineId)?.has(m.id) ?? true),
    );
    if (left.length !== held.length) await writeJson(outboxFile, left);
    return left;
  }

  async function cancel(machineId: string, id: string) {
    await ackMail(await deps.token(), machineId, id);
    const held = await readJson<QueuedMail[]>(outboxFile, []);
    await writeJson(
      outboxFile,
      held.filter((m) => m.id !== id),
    );
  }

  /** Runs what waited for this computer, oldest first; each is acked whether it ran or was refused, so none repeats. */
  async function drain() {
    await sodium.ready;
    const [keys, token] = await Promise.all([deps.keys(), deps.token()]);
    const machineId = deps.machineId();
    const waiting = await listMail(token, machineId);
    if (waiting.length === 0) return;
    const seen = await readJson<string[]>(seenFile, []);
    for (const { id, sealed } of waiting) {
      const opened = openMail(
        sealed,
        keys,
        deps.senderOf,
        new Set(seen),
        Date.now(),
      );
      if ('refused' in opened)
        deps.log(`Mail ${id} refused: ${opened.refused}`);
      else {
        const { mail } = opened;
        const result = await deps
          .run({
            id: mail.id,
            deviceName: deps.senderOf(mail.from)?.name ?? 'Another computer',
            command: mail.command,
          })
          .catch((error: unknown) => ({ isOk: false, error: String(error) }));
        deps.log(
          `Mail ${id} (${mail.command.type}): ${JSON.stringify(result)}`,
        );
        seen.push(mail.id);
      }
      await ackMail(token, machineId, id).catch((error: unknown) =>
        deps.log(`Couldn’t ack mail ${id}: ${String(error)}`),
      );
    }
    await writeJson(seenFile, seen.slice(-SEEN_LIMIT));
  }

  return { queue, outbox, cancel, drain };
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  return readFile(file, 'utf8').then(
    (text) => JSON.parse(text) as T,
    () => fallback,
  );
}

const writeJson = (file: string, value: unknown) =>
  writeFile(file, JSON.stringify(value), { mode: 0o600 });
