import { CLOSE, MAX_FRAME_BYTES, parseMachineFrame, splitChannel, withChannel, type RelayToMachine } from './protocol.ts';

/** What a socket is, kept on the socket itself so it survives the Durable Object hibernating. */
export type Attachment = { role: 'machine'; machineId: string } | { role: 'device'; machineId: string; deviceId: string; channel: number };

export interface MachineRecord {
  id: string;
  name: string;
  /** Ed25519, base64. Devices compare its fingerprint with the one the machine shows before trusting it. */
  publicKey: string;
  lastSeen: number;
}

/** The Durable Object's sockets and storage, behind just what the relay needs, so tests drive it without Cloudflare. */
export interface Room<S> {
  byTag(tag: string): S[];
  attachment(socket: S): Attachment;
  send(socket: S, data: string | Uint8Array): void;
  close(socket: S, code: number, reason: string): void;
  machines(): Promise<Record<string, MachineRecord>>;
  saveMachines(machines: Record<string, MachineRecord>): Promise<void>;
}

export type Admission = { tags: string[]; attachment: Attachment } | { refusal: string; code: number };

const machineTag = (machineId: string) => `machine:${machineId}`;
const channelTag = (channel: number) => `channel:${channel}`;
const devicesOfTag = (machineId: string) => `devices-of:${machineId}`;

/**
 * One account's relay: its machines' registry and the channels between devices and machines. It never reads what it
 * forwards; frames are end-to-end encrypted between the two ends (DEVICES.md › End-to-end encryption).
 */
export class Relay<S> {
  private readonly room: Room<S>;
  private readonly now: () => number;
  private readonly randomChannel: () => number;

  constructor(room: Room<S>, now: () => number = Date.now, randomChannel = () => crypto.getRandomValues(new Uint32Array(1))[0]) {
    this.room = room;
    this.now = now;
    this.randomChannel = randomChannel;
  }

  /** Decides before the socket is accepted. A machine replaces an older socket of its own; a device needs its machine online. */
  admit(role: 'machine', machineId: string): Admission;
  admit(role: 'device', machineId: string, deviceId: string): Admission;
  admit(role: 'machine' | 'device', machineId: string, deviceId?: string): Admission {
    if (role === 'machine') {
      for (const old of this.room.byTag(machineTag(machineId))) this.room.close(old, CLOSE.replaced, 'Replaced by a newer connection of this machine');
      return { tags: [machineTag(machineId)], attachment: { role: 'machine', machineId } };
    }
    if (!this.machineSocket(machineId)) return { refusal: 'That machine is offline', code: CLOSE.machineOffline };
    let channel = this.randomChannel();
    while (this.room.byTag(channelTag(channel)).length) channel = this.randomChannel();
    return { tags: [channelTag(channel), devicesOfTag(machineId)], attachment: { role: 'device', machineId, deviceId: deviceId!, channel } };
  }

  /** Right after accepting a device: its machine learns a channel opened. */
  opened(socket: S) {
    const a = this.room.attachment(socket);
    if (a.role !== 'device') return;
    const machine = this.machineSocket(a.machineId);
    if (!machine) return this.room.close(socket, CLOSE.machineOffline, 'That machine is offline');
    this.control(machine, { type: 'open', channel: a.channel, deviceId: a.deviceId });
  }

  async message(socket: S, data: string | ArrayBuffer) {
    const a = this.room.attachment(socket);
    const bytes = typeof data === 'string' ? null : new Uint8Array(data);
    if (bytes && bytes.length > MAX_FRAME_BYTES + 4) return this.room.close(socket, CLOSE.tooBig, 'Frame too big');
    if (a.role === 'device') {
      if (!bytes) return this.room.close(socket, CLOSE.unsupported, 'Devices send binary frames only');
      const machine = this.machineSocket(a.machineId);
      if (!machine) return this.room.close(socket, CLOSE.machineOffline, 'That machine went offline');
      return this.room.send(machine, withChannel(a.channel, bytes));
    }
    if (!bytes) return this.onControl(socket, a.machineId, data as string);
    const split = splitChannel(bytes);
    if (!split) return this.room.close(socket, CLOSE.badFrame, 'A frame needs its channel');
    const device = this.room.byTag(channelTag(split.channel)).find((d) => this.isDeviceOf(d, a.machineId));
    if (!device) return this.control(socket, { type: 'close', channel: split.channel });
    this.room.send(device, split.bytes);
  }

  closed(socket: S) {
    const a = this.room.attachment(socket);
    if (a.role === 'device') {
      const machine = this.machineSocket(a.machineId);
      if (machine) this.control(machine, { type: 'close', channel: a.channel });
      return;
    }
    // A replaced machine socket closing must not take the new one's devices with it.
    if (this.machineSocket(a.machineId, socket)) return;
    for (const device of this.room.byTag(devicesOfTag(a.machineId))) this.room.close(device, CLOSE.machineOffline, 'That machine went offline');
  }

  async list() {
    const machines = await this.room.machines();
    return Object.values(machines).map((m) => ({ ...m, isOnline: !!this.machineSocket(m.id) }));
  }

  /** Forgets a machine: its socket and its devices' channels close, and it has to register again to come back. */
  async remove(machineId: string) {
    const { [machineId]: _, ...rest } = await this.room.machines();
    await this.room.saveMachines(rest);
    for (const socket of this.room.byTag(machineTag(machineId))) this.room.close(socket, CLOSE.machineOffline, 'Removed from the account');
  }

  private async onControl(socket: S, machineId: string, raw: string) {
    const frame = parseMachineFrame(raw);
    if (!frame) return this.room.close(socket, CLOSE.badFrame, 'Unknown control frame');
    if (frame.type === 'close') {
      for (const device of this.room.byTag(channelTag(frame.channel))) if (this.isDeviceOf(device, machineId)) this.room.close(device, 1000, 'Closed by the machine');
      return;
    }
    const machines = await this.room.machines();
    await this.room.saveMachines({ ...machines, [machineId]: { id: machineId, name: frame.name, publicKey: frame.publicKey, lastSeen: this.now() } });
  }

  /** The machine's live socket, skipping `except` (one that is on its way out). */
  private machineSocket(machineId: string, except?: S) {
    return this.room.byTag(machineTag(machineId)).find((s) => s !== except);
  }

  private isDeviceOf(socket: S, machineId: string) {
    const a = this.room.attachment(socket);
    return a.role === 'device' && a.machineId === machineId;
  }

  private control(socket: S, frame: RelayToMachine) {
    this.room.send(socket, JSON.stringify(frame));
  }
}
