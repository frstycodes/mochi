import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SafeStorage } from 'electron';
import sodium from 'libsodium-wrappers';

/** Ed25519; `session.ts` converts it to X25519 for `crypto_kx`. */
export type DeviceKeys = { publicKey: Uint8Array; privateKey: Uint8Array };

/** `persisted: false` → the key lives in memory only and a new one is made on the next launch. */
export type LoadedDeviceKeys = { keys: DeviceKeys; persisted: boolean };

export type KeyStorage = Pick<SafeStorage, 'isEncryptionAvailable' | 'getSelectedStorageBackend' | 'encryptString' | 'decryptString'>;

const KEY_FILE = 'device-key';

let memoryKeys: DeviceKeys | undefined;

/** Call after `app` is ready: before it, `safeStorage` reports no encryption and the key would not persist. */
export async function loadDeviceKeys(storage: KeyStorage, dir: string, platform: NodeJS.Platform = process.platform): Promise<LoadedDeviceKeys> {
  await sodium.ready;
  if (isWeakStorage(storage, platform)) return { keys: (memoryKeys ??= generate()), persisted: false };
  const file = join(dir, KEY_FILE);
  if (existsSync(file)) return { keys: fromSeed(sodium.from_base64(storage.decryptString(readFileSync(file)))), persisted: true };
  const seed = sodium.randombytes_buf(sodium.crypto_sign_SEEDBYTES);
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, storage.encryptString(sodium.to_base64(seed)), { mode: 0o600 });
  return { keys: fromSeed(seed), persisted: true };
}

/** `basic_text` encrypts with a hardcoded password; `unknown` means the app isn't ready. Neither may hold a device key. */
export function isWeakStorage(storage: KeyStorage, platform: NodeJS.Platform): boolean {
  if (!storage.isEncryptionAvailable()) return true;
  if (platform !== 'linux') return false;
  const backend = storage.getSelectedStorageBackend();
  return backend === 'basic_text' || backend === 'unknown';
}

function generate(): DeviceKeys {
  return fromSeed(sodium.randombytes_buf(sodium.crypto_sign_SEEDBYTES));
}

function fromSeed(seed: Uint8Array): DeviceKeys {
  const { publicKey, privateKey } = sodium.crypto_sign_seed_keypair(seed);
  return { publicKey, privateKey };
}
