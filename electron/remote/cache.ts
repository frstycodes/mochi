import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isWeakStorage, type KeyStorage } from './crypto/keys.ts';

/**
 * Each followed machine's last snapshot, so its threads read offline and show at launch before it answers. Encrypted with
 * `safeStorage`: thread content is the user's, and on a computer with only weak storage nothing is written at all.
 */
export class MachineCache {
  private readonly dir: string;
  private readonly storage: KeyStorage;
  private readonly platform: NodeJS.Platform;

  constructor(userData: string, storage: KeyStorage, platform: NodeJS.Platform = process.platform) {
    this.dir = join(userData, 'machine-cache');
    this.storage = storage;
    this.platform = platform;
  }

  read(machineId: string): string | undefined {
    try {
      return this.storage.decryptString(readFileSync(this.file(machineId)));
    } catch {
      return undefined;
    }
  }

  /** When it was last written, which is about when that machine was last online. */
  savedAt(machineId: string): number | undefined {
    try {
      return statSync(this.file(machineId)).mtimeMs;
    } catch {
      return undefined;
    }
  }

  write(machineId: string, saved: string) {
    if (isWeakStorage(this.storage, this.platform)) return;
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(this.file(machineId), this.storage.encryptString(saved), { mode: 0o600 });
  }

  remove(machineId: string) {
    rmSync(this.file(machineId), { force: true });
  }

  private file(machineId: string) {
    // Ids are the machine's own; one with a path in it never reaches the disk.
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(machineId)) throw new Error('Bad machine id');
    return join(this.dir, machineId);
  }
}
