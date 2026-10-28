import { mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Context, Effect, Layer } from 'effect';
import { Capabilities } from '../hostServer.ts';
import { writeFileAtomic } from '../utility/atomicWrite.ts';

/**
 * This machine's secrets, by name: the account session, device keys. Each value is sealed with the OS keychain when one
 * serves (main's `safeStorage`, the `secureStorage` capability) and kept as is otherwise, as under `mochi serve` on a
 * server; either way it lives in `<data>/keys/keys.json`, the folder 0700 and the file 0600.
 */
export interface Keys {
  /** The value saved under `name`, or undefined. Rejects when it was sealed by a keychain this process can't reach now. */
  get(name: string): Promise<string | undefined>;
  /** Saves `value` under `name`, sealed when a keychain serves. */
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

type Entry = { readonly sealed: string } | { readonly plain: string };

interface KeysFile {
  readonly keys: Record<string, Entry>;
}

/** The store in `dataDir`, sealing through `sealer` whenever it is available. */
export function fileKeys(dataDir: string, sealer: Sealer): Keys {
  const dir = path.join(dataDir, 'keys');
  const file = path.join(dir, 'keys.json');
  let writes = Promise.resolve();

  const read = async (): Promise<KeysFile> => {
    const text = await readFile(file, 'utf8').catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    });
    return text === null ? { keys: {} } : (JSON.parse(text) as KeysFile);
  };

  /** Changes apply one at a time, so two quick writes can't drop each other. */
  const update = (change: (keys: Record<string, Entry>) => Promise<void>) => {
    const next = writes.then(async () => {
      const { keys } = await read();
      await change(keys);
      await mkdir(dir, { recursive: true, mode: 0o700 });
      await writeFileAtomic(file, JSON.stringify({ keys }), 0o600);
    });
    writes = next.catch(() => {});
    return next;
  };

  return {
    async get(name) {
      await writes;
      const entry = (await read()).keys[name];
      if (!entry) return undefined;
      if ('plain' in entry) return entry.plain;
      if (!sealer.isAvailable())
        throw new Error(
          `${name} is sealed with this computer's keychain, which isn't reachable now: open Mochi on this computer`,
        );
      return sealer.open(entry.sealed);
    },
    set: (name, value) =>
      update(async (keys) => {
        keys[name] = sealer.isAvailable()
          ? { sealed: await sealer.seal(value) }
          : { plain: value };
      }),
    delete: (name) =>
      update(async (keys) => {
        delete keys[name];
      }),
  };
}

/** Core's `Keys`, sealed through whichever client serves `secureStorage` at the time of each call. */
export class KeyStore extends Context.Service<KeyStore>()(
  'mochi/core/KeyStore',
  {
    make: (userData: string | undefined) =>
      Effect.gen(function* () {
        const capabilities = yield* Capabilities;
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
        return fileKeys(userData ?? path.join(tmpdir(), 'mochi-core'), {
          isAvailable: () => capabilities.offers('secureStorage'),
          seal: (text) => call('encrypt', text),
          open: (sealed) => call('decrypt', sealed),
        }) satisfies Keys;
      }),
  },
) {
  static readonly layer = (userData: string | undefined) =>
    Layer.effect(this, this.make(userData));
}
