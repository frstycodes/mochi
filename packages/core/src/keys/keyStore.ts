import { scrypt } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Context, Effect, Layer } from 'effect';
import sodium from 'libsodium-wrappers';
import { Capabilities } from '../hostServer.ts';
import { writeFileAtomic } from '../utility/atomicWrite.ts';

/**
 * This machine's secrets, by name: the account session, device keys. They live in `<data>/keys/keys.json` (folder 0700,
 * file 0600), never in plain text:
 * - sealed with the OS keychain when one serves (main's `safeStorage`, the `secureStorage` capability);
 * - else locked with a key derived from `MOCHI_KEY_PASSPHRASE` (scrypt, then libsodium `secretbox`), as under
 *   `mochi serve` on a server;
 * - else kept in this process's memory only, and `onUnsaved` says so: gone at restart, never written weakly.
 * A file from before this held `{ plain }` entries; they are read, and locked or sealed on the next write that can.
 */
export interface Keys {
  /** The value saved under `name`, or undefined. Rejects when what protects it (keychain, passphrase) isn't here now. */
  get(name: string): Promise<string | undefined>;
  /** Saves `value` under `name`, protected as above. */
  set(name: string, value: string): Promise<void>;
  /** Forgets `name`; nothing when it isn't saved. */
  delete(name: string): Promise<void>;
}

/** The OS keychain, when this process has one now. */
export interface Sealer {
  isAvailable(): boolean;
  seal(text: string): Promise<string>;
  open(sealed: string): Promise<string>;
}

type Entry =
  | { readonly sealed: string }
  | { readonly locked: string }
  | { readonly plain: string };

interface KeysFile {
  readonly keys: Record<string, Entry>;
  /** The passphrase lock: scrypt's salt, and a known text locked with it, so a wrong passphrase is caught before a write. */
  readonly lock?: { readonly salt: string; readonly check: string };
}

export interface KeysOptions {
  /** Read on every call; defaults to `MOCHI_KEY_PASSPHRASE`. */
  passphrase?: () => string | undefined;
  /** `name` is held in memory only: neither a keychain nor a passphrase is here to protect it on disk. */
  onUnsaved?: (name: string) => void;
}

const CHECK = 'mochi-keys';
/** scrypt at N=2^17, r=8: 128 MiB and a fraction of a second, once per process. */
const SCRYPT = { N: 2 ** 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
const envPassphrase = () => process.env.MOCHI_KEY_PASSPHRASE || undefined;
/** Secrets nothing could protect on disk, per keys file: shared by every store on that file in this process. */
const unsaved = new Map<string, Map<string, string>>();

/** The store in `dataDir`, sealing through `sealer` whenever it is available. */
export function fileKeys(
  dataDir: string,
  sealer: Sealer,
  { passphrase = envPassphrase, onUnsaved }: KeysOptions = {},
): Keys {
  const dir = path.join(dataDir, 'keys');
  const file = path.join(dir, 'keys.json');
  const memory = unsaved.get(file) ?? new Map<string, string>();
  unsaved.set(file, memory);
  let writes = Promise.resolve();
  let derived:
    | { passphrase: string; salt: string; key: Uint8Array }
    | undefined;

  const read = async (): Promise<KeysFile> => {
    const text = await readFile(file, 'utf8').catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    });
    return text === null ? { keys: {} } : (JSON.parse(text) as KeysFile);
  };

  const keyFor = async (secret: string, salt: string) => {
    if (derived?.passphrase === secret && derived.salt === salt)
      return derived.key;
    const key = await new Promise<Uint8Array>((resolve, reject) =>
      scrypt(secret, Buffer.from(salt, 'base64'), 32, SCRYPT, (error, out) =>
        error ? reject(error) : resolve(new Uint8Array(out)),
      ),
    );
    derived = { passphrase: secret, salt, key };
    return key;
  };

  /** The passphrase's key for this file, checked against its lock; undefined with no passphrase. */
  const unlock = async (lock: KeysFile['lock']) => {
    const secret = passphrase();
    if (!secret) return undefined;
    if (!lock) return undefined;
    const key = await keyFor(secret, lock.salt);
    if (openBox(lock.check, key) !== CHECK)
      throw new Error(
        'MOCHI_KEY_PASSPHRASE doesn’t open the keys saved on this computer',
      );
    return key;
  };

  /** The lock to write with: this file's, or a new one when it has none yet. */
  const lockFor = async (held: KeysFile['lock']) => {
    const secret = passphrase();
    if (!secret) return undefined;
    if (held) return { lock: held, key: (await unlock(held))! };
    await sodium.ready;
    const salt = Buffer.from(sodium.randombytes_buf(16)).toString('base64');
    const key = await keyFor(secret, salt);
    return { lock: { salt, check: box(CHECK, key) }, key };
  };

  /** Changes apply one at a time, so two quick writes can't drop each other. */
  const update = (change: (keys: Record<string, Entry>) => void) => {
    const next = writes.then(async () => {
      await sodium.ready;
      const saved = await read();
      const keys = { ...saved.keys };
      change(keys);
      const isKeychain = sealer.isAvailable();
      const locking = isKeychain ? undefined : await lockFor(saved.lock);
      const protect = async (value: string): Promise<Entry | undefined> =>
        isKeychain
          ? { sealed: await sealer.seal(value) }
          : locking && { locked: box(value, locking.key) };
      // What memory held, and any plain entry from before, go to disk once something protects them.
      for (const [name, entry] of Object.entries(keys))
        if ('plain' in entry) {
          const protectedEntry = await protect(entry.plain);
          if (protectedEntry) keys[name] = protectedEntry;
        }
      for (const [name, value] of memory) {
        const protectedEntry = await protect(value);
        if (!protectedEntry) continue;
        keys[name] = protectedEntry;
        memory.delete(name);
      }
      await mkdir(dir, { recursive: true, mode: 0o700 });
      const lock = locking?.lock ?? saved.lock;
      await writeFileAtomic(
        file,
        JSON.stringify(lock ? { keys, lock } : { keys }),
        0o600,
      );
    });
    writes = next.catch(() => {});
    return next;
  };

  return {
    async get(name) {
      await writes;
      if (memory.has(name)) return memory.get(name);
      const saved = await read();
      const entry = saved.keys[name];
      if (!entry) return undefined;
      if ('plain' in entry) return entry.plain;
      if ('locked' in entry) {
        await sodium.ready;
        const key = await unlock(saved.lock);
        if (!key)
          throw new Error(
            `${name} is locked with a passphrase: set MOCHI_KEY_PASSPHRASE`,
          );
        return openBox(entry.locked, key);
      }
      if (!sealer.isAvailable())
        throw new Error(
          `${name} is sealed with this computer's keychain, which isn't reachable now: open Mochi on this computer`,
        );
      return sealer.open(entry.sealed);
    },
    set: (name, value) =>
      update((keys) => {
        delete keys[name];
        memory.set(name, value);
      }).then(() => {
        if (memory.has(name)) onUnsaved?.(name);
      }),
    delete: (name) =>
      update((keys) => {
        delete keys[name];
        memory.delete(name);
      }),
  };
}

function box(text: string, key: Uint8Array): string {
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
  const sealed = sodium.crypto_secretbox_easy(
    sodium.from_string(text),
    nonce,
    key,
  );
  return Buffer.concat([nonce, sealed]).toString('base64');
}

function openBox(text: string, key: Uint8Array): string | undefined {
  const bytes = new Uint8Array(Buffer.from(text, 'base64'));
  const nonce = bytes.subarray(0, sodium.crypto_secretbox_NONCEBYTES);
  try {
    return sodium.to_string(
      sodium.crypto_secretbox_open_easy(
        bytes.subarray(sodium.crypto_secretbox_NONCEBYTES),
        nonce,
        key,
      ),
    );
  } catch {
    return undefined;
  }
}

/** Core's `Keys`, sealed through whichever client serves `secureStorage` at the time of each call. */
export class KeyStore extends Context.Service<KeyStore>()(
  'mochi/core/KeyStore',
  {
    make: (userData: string | undefined) =>
      Effect.gen(function* () {
        const capabilities = yield* Capabilities;
        const services = yield* Effect.context<never>();
        const call = (method: 'encrypt' | 'decrypt', text: string) =>
          Effect.runPromise(
            capabilities
              .call({ capability: 'secureStorage', method, args: [text] })
              .pipe(
                Effect.catch((error) =>
                  Effect.die(
                    typeof error === 'string' ? new Error(error) : error,
                  ),
                ),
              ),
          ) as Promise<string>;
        // Tests run without a data folder; theirs is a scratch one.
        return fileKeys(
          userData ?? path.join(tmpdir(), 'mochi-core'),
          {
            isAvailable: () => capabilities.offers('secureStorage'),
            seal: (text) => call('encrypt', text),
            open: (sealed) => call('decrypt', sealed),
          },
          {
            onUnsaved: (name) =>
              void Effect.runPromiseWith(services)(
                Effect.logWarning(
                  `${name} is kept in memory only, so it is gone when Mochi restarts: this computer has no keychain, and MOCHI_KEY_PASSPHRASE isn't set to encrypt it on disk`,
                ).pipe(Effect.annotateLogs({ source: 'keys' })),
              ),
          },
        ) satisfies Keys;
      }),
  },
) {
  static readonly layer = (userData: string | undefined) =>
    Layer.effect(this, this.make(userData));
}
