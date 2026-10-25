import { safeStorage } from 'electron';
import { isWeakStorage, type KeyStorage } from './remote/crypto/keys';

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
