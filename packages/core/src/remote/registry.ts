import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_SCOPES,
  type DeviceKind,
  type Scope,
} from '../../../../apps/desktop/src/host/types/remote.ts';
import { parseRecords, type Member, type MemberRecord } from './members.ts';
import type { PairedDevice } from './pairing.ts';

/** A member computer this one follows, to control it (main's `electron/remote/client.ts` follows each). */
export interface PairedMachine {
  id: string;
  name: string;
  kind?: DeviceKind;
  /** Ed25519, base64: its member key. A different key is a different computer, which joins on its own. */
  publicKey: string;
  pairedAt: number;
  /** `host:port` it last said it listens on, LAN or Tailscale: tried before the relay. */
  addresses?: string[];
}

interface Stored {
  /** This install's id at the relay; never secret. */
  machineId: string;
  /** Signed membership records (`members.ts`); missing in a file from before membership, until its pairings are signed. */
  records?: MemberRecord[];
  /** Every member but this computer, with what it may do here. */
  devices: PairedDevice[];
  /** Every member the relay knows, followed as a machine. */
  machines: PairedMachine[];
}

/**
 * Who this computer trusts, in its own userData: the membership records, and per member what it may do here and where it
 * was last reachable. Public keys only; the private key is in `Keys` (`DEVICE_KEY` in `service.ts`).
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

  /** Undefined until the pairings from before membership were signed as records (`legacy`). */
  records() {
    return this.stored.records;
  }

  saveRecords(records: MemberRecord[]) {
    this.save({ ...this.stored, records });
  }

  /** Pairings made before membership: each becomes a member, vouched for by this computer. */
  legacy() {
    return { devices: this.stored.devices, machines: this.stored.machines };
  }

  /**
   * Devices and machines follow the members: a new one may do the default scopes here (terminal stays off), one no longer
   * trusted goes. Returns the device ids that went.
   */
  reconcile(members: Member[], selfId: string): string[] {
    const others = members.filter((m) => m.deviceId !== selfId);
    const devices = others.map((m): PairedDevice => {
      const known = this.findDevice(m.deviceId);
      return {
        id: m.deviceId,
        name: m.name,
        kind: m.kind ?? known?.kind,
        publicKey: m.publicKey,
        scopes: known?.scopes ?? DEFAULT_SCOPES,
        pairedAt: m.addedAt,
      };
    });
    const machines = others.flatMap((m): PairedMachine[] => {
      if (!m.machineId) return [];
      const known = this.stored.machines.find((p) => p.id === m.machineId);
      return [
        {
          id: m.machineId,
          name: m.name,
          kind: known?.kind ?? m.kind,
          publicKey: m.publicKey,
          pairedAt: m.addedAt,
          ...(known?.addresses && { addresses: known.addresses }),
        },
      ];
    });
    const gone = this.stored.devices
      .filter((d) => !devices.some((n) => n.id === d.id))
      .map((d) => d.id);
    if (
      JSON.stringify(devices) !== JSON.stringify(this.stored.devices) ||
      JSON.stringify(machines) !== JSON.stringify(this.stored.machines)
    )
      this.save({ ...this.stored, devices, machines });
    return gone;
  }

  devices() {
    return this.stored.devices;
  }

  findDevice(id: string) {
    return this.stored.devices.find((d) => d.id === id);
  }

  /** A device paired before devices named their kind gets it on its next connection. */
  setDeviceKind(id: string, kind: DeviceKind | undefined) {
    if (!kind || this.findDevice(id)?.kind === kind) return;
    this.save({
      ...this.stored,
      devices: this.stored.devices.map((d) =>
        d.id === id ? { ...d, kind } : d,
      ),
    });
  }

  setScopes(id: string, scopes: Scope[]) {
    this.save({
      ...this.stored,
      devices: this.stored.devices.map((d) =>
        d.id === id ? { ...d, scopes } : d,
      ),
    });
  }

  machines() {
    return this.stored.machines;
  }

  /** What a machine said about itself in its last welcome. */
  noteWelcome(id: string, welcome: Pick<PairedMachine, 'addresses' | 'kind'>) {
    const machine = this.stored.machines.find((m) => m.id === id);
    if (
      !machine ||
      (JSON.stringify(machine.addresses ?? []) ===
        JSON.stringify(welcome.addresses ?? []) &&
        machine.kind === welcome.kind)
    )
      return;
    this.save({
      ...this.stored,
      machines: this.stored.machines.map((m) =>
        m.id === id ? { ...m, ...welcome } : m,
      ),
    });
  }

  private save(next: Stored) {
    this.stored = next;
    writeFileSync(this.file, JSON.stringify(next), { mode: 0o600 });
  }
}

function load(file: string): Stored {
  try {
    const saved = JSON.parse(readFileSync(file, 'utf8')) as Partial<Stored>;
    if (typeof saved.machineId === 'string' && saved.machineId)
      return {
        machineId: saved.machineId,
        ...(saved.records && { records: parseRecords(saved.records) }),
        devices: saved.devices ?? [],
        machines: saved.machines ?? [],
      };
  } catch {
    // First launch, or an unreadable file: a fresh identity with nobody trusted.
  }
  const fresh = {
    machineId: randomBytes(12).toString('base64url'),
    records: [],
    devices: [],
    machines: [],
  };
  writeFileSync(file, JSON.stringify(fresh), { mode: 0o600 });
  return fresh;
}
