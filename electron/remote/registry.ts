import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_SCOPES } from '../../src/host/types/remote.ts';
import type { PairedDevice } from './pairing.ts';

/** A computer this one paired with, to control it (DEVICES.md › multi-machine uses the list). */
export interface PairedMachine {
  id: string;
  name: string;
  /** Ed25519, base64: the key it proved at pairing. A different key later means pairing again. */
  publicKey: string;
  pairedAt: number;
}

interface Stored {
  /** This install's id at the relay; never secret. */
  machineId: string;
  devices: PairedDevice[];
  machines: PairedMachine[];
}

/**
 * Who this computer trusts, in its own userData: the relay holds none of it, so a compromised relay can't add a device.
 * Public keys only; the private key is `crypto/keys.ts`'s, under `safeStorage`.
 */
export class Registry {
  private readonly file: string;
  private stored: Stored;

  constructor(dir: string) {
    this.file = join(dir, 'devices.json');
    this.stored = load(this.file);
  }

  get machineId() {
    return this.stored.machineId;
  }

  devices() {
    return this.stored.devices;
  }

  findDevice(id: string) {
    return this.stored.devices.find((d) => d.id === id);
  }

  addDevice(device: { id: string; name: string; publicKey: string }, now = Date.now()): PairedDevice {
    const paired: PairedDevice = { ...device, scopes: DEFAULT_SCOPES, pairedAt: now };
    this.save({ ...this.stored, devices: [...this.stored.devices.filter((d) => d.id !== device.id), paired] });
    return paired;
  }

  removeDevice(id: string) {
    this.save({ ...this.stored, devices: this.stored.devices.filter((d) => d.id !== id) });
  }

  machines() {
    return this.stored.machines;
  }

  addMachine(machine: Omit<PairedMachine, 'pairedAt'>, now = Date.now()) {
    this.save({ ...this.stored, machines: [...this.stored.machines.filter((m) => m.id !== machine.id), { ...machine, pairedAt: now }] });
  }

  removeMachine(id: string) {
    this.save({ ...this.stored, machines: this.stored.machines.filter((m) => m.id !== id) });
  }

  private save(next: Stored) {
    this.stored = next;
    writeFileSync(this.file, JSON.stringify(next), { mode: 0o600 });
  }
}

function load(file: string): Stored {
  try {
    const saved = JSON.parse(readFileSync(file, 'utf8')) as Partial<Stored>;
    if (typeof saved.machineId === 'string' && saved.machineId) return { machineId: saved.machineId, devices: saved.devices ?? [], machines: saved.machines ?? [] };
  } catch {
    // First launch, or an unreadable file: a fresh identity with nobody trusted.
  }
  const fresh = { machineId: randomBytes(12).toString('base64url'), devices: [], machines: [] };
  writeFileSync(file, JSON.stringify(fresh), { mode: 0o600 });
  return fresh;
}
