import { safeStorage, type SafeStorage } from 'electron';

export type KeyStorage = Pick<
  SafeStorage,
  | 'isEncryptionAvailable'
  | 'getSelectedStorageBackend'
  | 'encryptString'
  | 'decryptString'
>;

/** `basic_text` encrypts with a hardcoded password; `unknown` means the app isn't ready. Neither may hold a secret. */
export function isWeakStorage(
  storage: KeyStorage,
  platform: NodeJS.Platform,
): boolean {
  if (!storage.isEncryptionAvailable()) return true;
  if (platform !== 'linux') return false;
  const backend = storage.getSelectedStorageBackend();
  return backend === 'basic_text' || backend === 'unknown';
}

/** False when the OS keychain is missing or, on Linux, only `basic_text` (a hardcoded password): callers keep secrets in memory then. */
export const canStore = (
  storage: KeyStorage = safeStorage,
  platform: NodeJS.Platform = process.platform,
) => !isWeakStorage(storage, platform);

/** Base64 ciphertext. Throws rather than seal with weak storage. */
export function seal(text: string, storage: KeyStorage = safeStorage): string {
  if (!canStore(storage)) throw new Error('The OS keychain is not available');
  return storage.encryptString(text).toString('base64');
}

export function open(
  base64: string,
  storage: KeyStorage = safeStorage,
): string {
  if (!canStore(storage)) throw new Error('The OS keychain is not available');
  return storage.decryptString(Buffer.from(base64, 'base64'));
}
