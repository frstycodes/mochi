import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import type { CommandResult, DeviceKind, FollowedMachine, RemoteCommand, StreamFrame } from '../../src/host/types/remote.ts';
import { keepAlive, socketLink, type Link, type RawLink } from './link.ts';
import { PairingRefused } from './pairing.ts';
import { asKind, parseServerFrame, PROTOCOL_VERSION } from './protocol.ts';

/** One way to reach a machine. LAN and Tailscale addresses come first; the relay last. */
export interface Route {
  kind: 'lan' | 'relay';
  open(): Promise<RawLink>;
}

export interface FollowOptions {
  /** `lastSeenAt`: from an earlier launch, for "offline since" before this one ever reached it. */
  machine: { id: string; name: string; kind?: DeviceKind; lastSeenAt?: number };
  /** Read on every attempt: addresses and the account change between them. */
  routes: () => Route[];
  /** The pairing exchange as a returning device (`secureAsDevice`). */
  secure: (raw: RawLink) => Promise<Link>;
  onChange: (state: FollowedMachine) => void;
  onFrame: (frame: StreamFrame) => void;
  /** What it said about itself, to remember for the next launch. */
  onWelcome: (welcome: { addresses: string[]; kind?: DeviceKind }) => void;
}

export interface MachineFollower {
  state(): FollowedMachine;
  command(command: RemoteCommand): Promise<CommandResult>;
  /** Starts over without resuming: the next frames are a fresh snapshot, then actions. */
  resync(): void;
  close(): void;
}

const LAN_TIMEOUT_MS = 2000;
const MAX_BACKOFF_MS = 30_000;
const COMMAND_TIMEOUT_MS = 60_000;
/** A clone runs as long as the repository takes to download. */
const LONG_COMMAND_TIMEOUT_MS = { 'clone-project': 15 * 60_000, 'add-project': 2 * 60_000 } satisfies Partial<Record<RemoteCommand['type'], number>>;

/**
 * This computer's connection to one machine it paired with, as a device: kept open with backoff, resuming the stream where
 * it left off. Commands never queue while it's offline: sending later could spend usage unasked (DEVICES.md › Offline).
 */
export function followMachine(options: FollowOptions): MachineFollower {
  const { machine } = options;
  let state: FollowedMachine = { id: machine.id, name: machine.name, kind: machine.kind, status: 'connecting', scopes: [], lastSeenAt: machine.lastSeenAt };
  let link: Link | undefined;
  let resume: { epoch: string; seq: number } | undefined;
  let attempt = 0;
  let retry: ReturnType<typeof setTimeout> | undefined;
  // A resync or close makes an attempt still in flight stale.
  let generation = 0;
  const pending = new Map<string, (result: CommandResult) => void>();

  const set = (patch: Partial<FollowedMachine>) => {
    state = { ...state, ...patch };
    options.onChange(state);
  };

  async function connect() {
    const run = ++generation;
    clearTimeout(retry);
    set({ status: 'connecting' });
    const opened = await openFirst(options.routes(), options.secure);
    if (run !== generation) return 'link' in opened && opened.link.close(1000, 'Superseded');
    if ('refusal' in opened) return set({ status: 'refused', route: undefined, scopes: [], error: opened.refusal });
    if ('error' in opened) return offline(opened.error);
    attach(opened.link, opened.route, run);
  }

  function attach(opened: Link, route: Route['kind'], run: number) {
    link = opened;
    opened.onMessage((text) => onFrame(text, route));
    opened.onClose(() => {
      if (link !== opened) return;
      link = undefined;
      for (const answer of pending.values()) answer({ isOk: false, error: 'The connection dropped; check the thread before trying again' });
      pending.clear();
      if (run !== generation || state.status === 'refused') return;
      offline(state.error ?? 'The connection dropped', state.status === 'online' ? Date.now() : state.lastSeenAt);
    });
    opened.send(JSON.stringify({ type: 'hello', version: PROTOCOL_VERSION, ...(resume && { resume }) }));
  }

  function onFrame(text: string, route: Route['kind']) {
    const frame = parseServerFrame(text);
    switch (frame?.type) {
      case 'welcome':
        attempt = 0;
        const kind = asKind(frame.machineKind) ?? state.kind;
        options.onWelcome({ addresses: Array.isArray(frame.addresses) ? frame.addresses.filter((a) => typeof a === 'string') : [], kind });
        return set({ status: 'online', route, name: frame.machineName, kind, scopes: frame.scopes, error: undefined, lastSeenAt: Date.now() });
      case 'refused':
        // The machine couldn't serve the stream this time (it says to reconnect); the close that follows retries.
        return set({ error: frame.reason });
      case 'snapshot':
      case 'action':
        resume = { epoch: frame.epoch, seq: frame.seq };
        return options.onFrame(frame);
      case 'result': {
        const { type: _type, id, ...result } = frame;
        pending.get(id)?.(result as CommandResult);
        pending.delete(id);
      }
    }
  }

  function offline(error: string, lastSeenAt = state.lastSeenAt) {
    set({ status: 'offline', route: undefined, error, lastSeenAt });
    retry = setTimeout(() => void connect(), Math.min(MAX_BACKOFF_MS, 1000 * 2 ** attempt++));
  }

  void connect();
  return {
    state: () => state,
    command(command) {
      const open = link;
      if (!open || state.status !== 'online') return Promise.resolve({ isOk: false, error: `${state.name} is offline` });
      const id = randomUUID();
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          resolve({ isOk: false, error: `${state.name} didn’t answer; check the thread before trying again` });
        }, LONG_COMMAND_TIMEOUT_MS[command.type as keyof typeof LONG_COMMAND_TIMEOUT_MS] ?? COMMAND_TIMEOUT_MS);
        pending.set(id, (result) => {
          clearTimeout(timer);
          resolve(result);
        });
        open.send(JSON.stringify({ type: 'command', id, command }));
      });
    },
    resync() {
      resume = undefined;
      attempt = 0;
      link?.close(1000, 'Starting over');
      void connect();
    },
    close() {
      generation++;
      clearTimeout(retry);
      link?.close(1000, 'Stopped following');
    },
  };
}

/**
 * The first route that pairs. Only the relay's refusal is final: an address on the LAN may since belong to another computer,
 * which refuses a key it never paired with.
 */
async function openFirst(routes: Route[], secure: FollowOptions['secure']): Promise<{ link: Link; route: Route['kind'] } | { refusal: string } | { error: string }> {
  let error = 'No way to reach it';
  for (const route of routes) {
    let raw: RawLink | undefined;
    try {
      raw = await route.open();
      return { link: await secure(raw), route: route.kind };
    } catch (e) {
      raw?.close(1000, 'Pairing failed');
      if (e instanceof PairingRefused && route.kind === 'relay') return { refusal: e.message };
      error = e instanceof Error ? e.message : String(e);
    }
  }
  return { error };
}

/** A machine's server on its LAN or Tailscale address, kept alive by WebSocket pings. */
export function openLan(address: string): Promise<RawLink> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://${address}`);
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error(`Nothing answered at ${address}`));
    }, LAN_TIMEOUT_MS);
    ws.on('open', () => {
      clearTimeout(timer);
      keepAlive(ws, () => ws.ping());
      resolve(socketLink(ws));
    });
    ws.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}
