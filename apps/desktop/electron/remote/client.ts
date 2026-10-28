import { Cause, Effect, Exit, Fiber, Schema, Scope, Stream } from 'effect';
import { RpcClientError } from 'effect/rpc';
import { Persist, type Relay } from '@mochi/schema';
import {
  makeDeviceClient,
  type DeviceClient,
  type Route,
} from '@mochi/core/remote/device';
import type { Link, RawLink } from '@mochi/core/remote/link';
import { reconnect } from '@mochi/core/remote/reconnect';
import type {
  CommandResult,
  DeviceKind,
  FollowedMachine,
  RemoteCommand,
} from '../../src/host/types/remote.ts';
import { asKind, PairingRefused } from './pairing.ts';

export type { Route };

export interface FollowOptions {
  /** `lastSeenAt`: from an earlier launch, for "offline since" before this one ever reached it. */
  machine: { id: string; name: string; kind?: DeviceKind; lastSeenAt?: number };
  /** Read on every attempt: addresses and the account change between them. */
  routes: () => Route[];
  /** The pairing exchange as a returning device (`secureAsDevice`). */
  secure: (raw: RawLink) => Promise<Link>;
  onChange: (state: FollowedMachine) => void;
  onFrame: (frame: Relay.MirrorFrame) => void;
  /** A terminal opened on the machine printed (or exited); in order, from the offset the window last got. */
  onTerminal: (
    output: { terminalId: string } & typeof Relay.TerminalOutput.Type,
  ) => void;
  /** What it said about itself, to remember for the next launch. */
  onWelcome: (welcome: { addresses: string[]; kind?: DeviceKind }) => void;
  /** This computer's membership records, sent in each hello. */
  members?: () => unknown;
  /** The machine's records, from its welcome or a later `members` frame. */
  onMembers?: (members: unknown) => void;
  /** A thread file from the machine that didn't decode, for the log. */
  onRejected: (reason: string) => void;
}

export interface MachineFollower {
  state(): FollowedMachine;
  command(command: RemoteCommand): Promise<CommandResult>;
  /** Starts over: the window drops what it has and every thread comes again from its snapshot. */
  resync(): void;
  close(): void;
}

const COMMAND_TIMEOUT_MS = 60_000;
/** A clone runs as long as the repository takes to download. */
const LONG_COMMAND_TIMEOUT_MS = {
  'clone-project': 15 * 60_000,
  'add-project': 2 * 60_000,
} satisfies Partial<Record<RemoteCommand['type'], number>>;
const decodeThread = Schema.decodeUnknownExit(Persist.SavedThread);

/**
 * This computer's connection to one machine it paired with, as a device: that machine's Core as an RPC client, its thread
 * list from the `shell` stream and each thread from the `thread` stream a window there reads. Commands never queue while
 * it's offline: sending later could spend usage unasked (DEVICES.md › Offline).
 */
export function followMachine(options: FollowOptions): MachineFollower {
  const { machine } = options;
  let state: FollowedMachine = {
    id: machine.id,
    name: machine.name,
    kind: machine.kind,
    status: 'connecting',
    scopes: [],
    lastSeenAt: machine.lastSeenAt,
  };
  let session:
    | {
        scope: Scope.Closeable;
        fiber: Fiber.Fiber<unknown, unknown>;
        client?: DeviceClient;
        terminals: Map<string, Fiber.Fiber<unknown, unknown>>;
      }
    | undefined;

  const set = (patch: Partial<FollowedMachine>) => {
    state = { ...state, ...patch };
    options.onChange(state);
  };

  function start() {
    const scope = Scope.makeUnsafe();
    const current: NonNullable<typeof session> = {
      scope,
      fiber: undefined as never,
      terminals: new Map(),
    };
    session = current;
    options.onFrame({ type: 'reset' });
    set({ status: 'connecting', error: undefined });
    const program = Effect.gen(function* () {
      current.client = yield* makeDeviceClient({
        routes: options.routes,
        secure: options.secure,
        isRefusal: (error) => error instanceof PairingRefused,
        members: options.members,
        onMembers: options.onMembers,
        onWelcome: (welcome, route) => {
          const kind = asKind(welcome.machineKind) ?? state.kind;
          options.onWelcome({ addresses: [...welcome.addresses], kind });
          if (welcome.members !== undefined)
            options.onMembers?.(welcome.members);
          set({
            status: 'online',
            route,
            name: welcome.machineName,
            kind,
            scopes: [...welcome.scopes],
            error: undefined,
            lastSeenAt: Date.now(),
          });
        },
        onOffline: (error) => {
          if (session !== current || state.status === 'refused') return;
          set({
            status: 'offline',
            route: undefined,
            error,
            lastSeenAt:
              state.status === 'online' ? Date.now() : state.lastSeenAt,
          });
        },
        onRefused: (reason) => {
          if (session !== current) return;
          set({
            status: 'refused',
            route: undefined,
            scopes: [],
            error: reason,
          });
          stop(current);
        },
      });
      yield* mirror(current.client, options);
    }).pipe(Scope.provide(scope));
    current.fiber = Effect.runFork(program);
  }

  function stop(current: NonNullable<typeof session>) {
    if (session === current) session = undefined;
    void Effect.runPromise(
      Fiber.interruptAll([current.fiber, ...current.terminals.values()]).pipe(
        Effect.andThen(Scope.close(current.scope, Exit.void)),
      ),
    );
  }

  /** A terminal opened on the machine pushes its output until it is closed or exits, resuming after a dropped link where it left off. */
  function watchTerminal(
    current: NonNullable<typeof session>,
    client: DeviceClient,
    command: RemoteCommand,
    result: CommandResult,
  ) {
    if (command.type === 'terminal-close')
      return interrupt(current.terminals, command.terminalId);
    if (
      command.type !== 'terminal-open' ||
      !result.isOk ||
      !result.data ||
      !('terminalId' in result.data)
    )
      return;
    const { terminalId } = result.data;
    let after = 0;
    const output = Stream.suspend(() =>
      client['terminal.output']({
        terminalId,
        threadId: command.threadId,
        after,
      }),
    ).pipe(
      Stream.runForEach((chunk) =>
        Effect.sync(() => {
          after = chunk.next;
          options.onTerminal({ terminalId, ...chunk });
        }),
      ),
      Effect.retry({ schedule: reconnect, while: isDropped }),
      Effect.ignore,
      Effect.ensuring(
        Effect.sync(() => void current.terminals.delete(terminalId)),
      ),
    );
    current.terminals.set(terminalId, Effect.runFork(output));
  }

  start();
  return {
    state: () => state,
    async command(command) {
      const client = session?.client;
      if (!client || state.status !== 'online')
        return { isOk: false, error: `${state.name} is offline` };
      const timeout =
        LONG_COMMAND_TIMEOUT_MS[
          command.type as keyof typeof LONG_COMMAND_TIMEOUT_MS
        ] ?? COMMAND_TIMEOUT_MS;
      const exit = await Effect.runPromiseExit(
        client['device.command']({ command }).pipe(Effect.timeout(timeout)),
      );
      if (Exit.isSuccess(exit)) {
        const result = exit.value as CommandResult;
        if (session) watchTerminal(session, client, command, result);
        return result;
      }
      const error = Cause.squash(exit.cause);
      if (Cause.isTimeoutError(error))
        return {
          isOk: false,
          error: `${state.name} didn’t answer; check the thread before trying again`,
        };
      return {
        isOk: false,
        error: error instanceof Error ? error.message : String(error),
      };
    },
    resync() {
      if (session) stop(session);
      start();
    },
    close() {
      if (session) stop(session);
    },
  };
}

/** The machine's threads, kept in step with its `shell` and `thread` streams; each resumes after the last sequence it saw. */
const mirror = (client: DeviceClient, options: FollowOptions) =>
  Effect.gen(function* () {
    const following = new Map<string, Fiber.Fiber<unknown, unknown>>();
    const after = new Map<string, number>();

    const send = (threadId: string, saved: unknown) => {
      if (saved === null)
        return options.onFrame({ type: 'thread', threadId, saved: null });
      const decoded = decodeThread(saved);
      if (Exit.isSuccess(decoded))
        return options.onFrame({
          type: 'thread',
          threadId,
          saved: decoded.value,
        });
      options.onRejected(
        `Thread ${threadId} didn’t decode: ${Cause.pretty(decoded.cause).slice(0, 500)}`,
      );
    };

    const thread = (threadId: string) =>
      Stream.suspend(() =>
        client.thread({ threadId, afterSequence: after.get(threadId) ?? 0 }),
      ).pipe(
        Stream.runForEach((item) =>
          Effect.sync(() => {
            if (item._tag === 'snapshot') {
              after.set(threadId, item.sequence);
              return send(threadId, item.saved);
            }
            after.set(threadId, item.event.sequence);
            if (item.event.type === 'thread.deleted') send(threadId, null);
          }),
        ),
        Effect.retry({ schedule: reconnect, while: isDropped }),
        Effect.ignore,
      );

    const follow = (threadId: string) =>
      Effect.gen(function* () {
        if (!following.has(threadId))
          following.set(threadId, yield* Effect.forkChild(thread(threadId)));
      });
    const unfollow = (threadId: string) =>
      Effect.gen(function* () {
        const fiber = following.get(threadId);
        if (!fiber) return;
        following.delete(threadId);
        after.delete(threadId);
        yield* Fiber.interrupt(fiber);
        send(threadId, null);
      });

    yield* client.shell().pipe(
      Stream.runForEach((item) =>
        Effect.gen(function* () {
          if (item._tag === 'snapshot') {
            const ids = new Set(item.shell.threads.map((t) => t.id));
            for (const id of [...following.keys()])
              if (!ids.has(id)) yield* unfollow(id);
            for (const id of ids) yield* follow(id);
            return;
          }
          const { type, threadId } = item.event;
          if (!threadId) return;
          if (type === 'thread.deleted') yield* unfollow(threadId);
          if (type === 'thread.saved') yield* follow(threadId);
        }),
      ),
      // Without `read` (or past any other refusal) there is nothing to mirror; commands still go.
      Effect.retry({ schedule: reconnect, while: isDropped }),
      Effect.ignore,
    );
  });

function interrupt(
  fibers: Map<string, Fiber.Fiber<unknown, unknown>>,
  id: string,
) {
  const fiber = fibers.get(id);
  fibers.delete(id);
  if (fiber) void Effect.runPromise(Fiber.interrupt(fiber));
}

const isDropped = (error: unknown) =>
  error instanceof RpcClientError.RpcClientError;
