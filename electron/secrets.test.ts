import assert from 'node:assert/strict';
import { test, vi } from 'vite-plus/test';

vi.mock('electron', () => ({ safeStorage: {} }));

const { canStore, seal, open } = await import('./secrets.ts');

const storage = (backend: string, available = true) => ({
  isEncryptionAvailable: () => available,
  getSelectedStorageBackend: () => backend as never,
  encryptString: (text: string) => Buffer.from(text).reverse(),
  decryptString: (bytes: Buffer) => Buffer.from(bytes).reverse().toString(),
});

test('refuses Linux basic_text and an unavailable keychain', () => {
  assert.equal(canStore(storage('basic_text'), 'linux'), false);
  assert.equal(canStore(storage('gnome_libsecret', false), 'linux'), false);
  assert.throws(() => seal('key', storage('x', false)));
  assert.throws(() => open('a2V5', storage('x', false)));
});

test('round-trips on a real backend', () => {
  const ok = storage('gnome_libsecret');
  assert.equal(canStore(ok, 'linux'), true);
  assert.equal(open(seal('key', ok), ok), 'key');
});
