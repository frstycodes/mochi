import {
  Cause,
  Effect,
  Exit,
  Fiber,
  Latch,
  Schedule,
  Schema,
  Scope,
  Stream,
} from 'effect';
import { RpcClientError } from 'effect/rpc';
import { Persist, type Relay } from '@mochi/schema';
import {
  makeDeviceClient,
  type DeviceClient,
  type Routes,
} from '@mochi/core/remote/device';
import type { Link, RawLink } from '@mochi/core/remote/link';
import type {
  CommandResult,
  DeviceKind,
  FollowedMachine,
  RemoteCommand,
  Scope as MemberScope,
} from '../../src/host/types/remote.ts';
import { asKind, PairingRefused } from '@mochi/core/remote/pairing';

export interface FollowOptions {
  /** `lastSeenAt`: from an earlier launch, for "offline since" before this one ever reached it. */
  machine: { id: string; name: string; kind?: DeviceKind; lastSeenAt?: number };
  /** Read on every attempt: addresses and the account change between them. */
  routes: () => Routes | Promise<Routes>;
  /** The pairing exchange as a returning device (`secureAsDevice`). */
  secure: (raw: RawLink) => Promise<Link>;
  onChange: (state: FollowedMachine) => void;
  onFrame: (frame: Relay.MirrorFrame) => void;
  /** A terminal opened on the machine printed (or exited); in order, from the offset the window last got. */
  onTerminal: (
    output: { terminalId: string } & typeof Relay.TerminalOutput.Type,
  ) => void;
  /** A browser tab opened on the machine sent a frame; until it is closed, resubscribing after a dropped link. */
  onBrowserFrame: (frame: {
    threadId: string;
    tabId: string;
    frame: typeof Relay.BrowserFrame.Type;
  }) => void;
  /** What it said about itself, to remember for the next launch. */
  onWelcome: (welcome: {
    addresses: string[];
    kind?: DeviceKind;
    irohRelay?: string;
  }) => void;
  /** This computer's membership records, sent in each hello. */
  members?: () => unknown;
  /** The machine's records, from its welcome or a later `members` frame. */
  onMembers?: (members: unknown) => void;
  /** A thread file from the machine that didn't decode, for the log. */
  onRejected: (reason: string) => void;
}

export interface MachineFollower {
  state(): FollowedMachine;
  /** Its Core as an RPC client while it's online, for the windows' channels (`channels.ts`). */
  client(): DeviceClient | undefined;
  /** With `commandId`, where the machine logs its store actions comes back as a `logged` frame. */
  command(command: RemoteCommand, commandId?: string): Promise<CommandResult>;
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
  /** The commands sent that haven't answered yet, by `commandId`. */
  const issued = new Set<string>();
  let session:
    | {
        scope: Scope.Closeable;
        fiber: Fiber.Fiber<unknown, unknown>;
        client?: DeviceClient;
        /** Open while the machine is connected: a dropped stream resubscribes as soon as it opens again. */
        online: Latch.Latch;
        terminals: Map<string, Fiber.Fiber<unknown, unknown>>;
        /** By `threadId/tabId`. */
        browsers: Map<string, Fiber.Fiber<unknown, unknown>>;
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
      online: Latch.makeUnsafe(false),
      terminals: new Map(),
      browsers: new Map(),
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
          const kind = asKind(welcome.backend.kind) ?? state.kind;
          options.onWelcome({
            addresses: [...welcome.addresses],
            kind,
            ...(welcome.irohRelay && { irohRelay: welcome.irohRelay }),
          });
          if (welcome.members !== undefined)
            options.onMembers?.(welcome.members);
          current.online.openUnsafe();
          set({
            status: 'online',
            route,
            name: welcome.backend.name,
            kind,
            scopes: welcome.backend.scopes.filter(
              (scope): scope is MemberScope => scope !== 'local',
            ),
            error: undefined,
            lastSeenAt: Date.now(),
          });
        },
        onOffline: (error) => {
          current.online.closeUnsafe();
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
      // A welcome that came while the client was still being built: the windows' channels need the client too.
      if (state.status === 'online') options.onChange(state);
      yield* mirror(current.client, current.online, options, issued);
    }).pipe(Scope.provide(scope));
    current.fiber = Effect.runFork(program);
  }

  function stop(current: NonNullable<typeof session>) {
    if (session === current) session = undefined;
    void Effect.runPromise(
      Fiber.interruptAll([
        current.fiber,
        ...current.terminals.values(),
        ...current.browsers.values(),
      ]).pipe(Effect.andThen(Scope.close(current.scope, Exit.void))),
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
      whileConnected(current.online),
      Effect.ignore,
      Effect.ensuring(
        Effect.sync(() => void current.terminals.delete(terminalId)),
      ),
    );
    current.terminals.set(terminalId, Effect.runFork(output));
  }

  /** A browser tab opened on the machine pushes its frames until it is closed. */
  function watchBrowser(
    current: NonNullable<typeof session>,
    client: DeviceClient,
    command: RemoteCommand,
    result: CommandResult,
  ) {
    if (command.type !== 'browser-open' && command.type !== 'browser-close')
      return;
    const { threadId, tabId } = command;
    const key = `${threadId}/${tabId}`;
    if (command.type === 'browser-close' || !result.isOk)
      return interrupt(current.browsers, key);
    if (current.browsers.has(key)) return;
    const frames = Stream.suspend(() =>
      client['page.watch']({ threadId, tabId }),
    ).pipe(
      Stream.runForEach((frame) =>
        Effect.sync(() => options.onBrowserFrame({ threadId, tabId, frame })),
      ),
      whileConnected(current.online),
      Effect.ignore,
      Effect.ensuring(Effect.sync(() => void current.browsers.delete(key))),
    );
    current.browsers.set(key, Effect.runFork(frames));
  }

  start();
  return {
    state: () => state,
    client: () => (state.status === 'online' ? session?.client : undefined),
    async command(command, commandId) {
      const client = session?.client;
      if (!client || state.status !== 'online')
        return { isOk: false, error: `${state.name} is offline` };
      const timeout =
        LONG_COMMAND_TIMEOUT_MS[
          command.type as keyof typeof LONG_COMMAND_TIMEOUT_MS
        ] ?? COMMAND_TIMEOUT_MS;
      if (commandId) issued.add(commandId);
      const exit = await Effect.runPromiseExit(
        client['device.command']({ command, commandId }).pipe(
          Effect.timeout(timeout),
          Effect.ensuring(
            Effect.sync(() => commandId && issued.delete(commandId)),
          ),
        ),
      );
      if (Exit.isSuccess(exit)) {
        const result = exit.value as CommandResult;
        if (session) watchTerminal(session, client, command, result);
        if (session) watchBrowser(session, client, command, result);
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

/**
 * The machine's threads, kept in step with its `shell` and `thread` streams; each resumes after the last sequence it saw.
 * An `issued` command's event on them is where the machine logged it.
 */
const mirror = (
  client: DeviceClient,
  online: Latch.Latch,
  options: FollowOptions,
  issued: ReadonlySet<string>,
) =>
  Effect.gen(function* () {
    const following = new Map<string, Fiber.Fiber<unknown, unknown>>();
    const after = new Map<string, number>();

    const send = (threadId: string, saved: unknown, sequence: number) => {
      if (saved === null)
        return options.onFrame({
          type: 'thread',
          threadId,
          saved: null,
          sequence,
        });
      const decoded = decodeThread(saved);
      if (Exit.isSuccess(decoded))
        return options.onFrame({
          type: 'thread',
          threadId,
          saved: decoded.value,
          sequence,
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
              return send(threadId, item.saved, item.sequence);
            }
            const { sequence, commandId, type } = item.event;
            after.set(threadId, sequence);
            if (commandId && issued.has(commandId))
              options.onFrame({ type: 'logged', commandId, sequence });
            if (type === 'thread.deleted') send(threadId, null, sequence);
          }),
        ),
        whileConnected(online),
        Effect.ignore,
      );

    // A stream that ended for good (a refusal, not a dropped link) lets go of the thread: its next save follows it again.
    const follow = (threadId: string) =>
      Effect.gen(function* () {
        if (following.has(threadId)) return;
        const fiber: Fiber.Fiber<unknown, unknown> = yield* Effect.forkChild(
          thread(threadId).pipe(
            Effect.ensuring(
              Effect.sync(
                () =>
                  following.get(threadId) === fiber &&
                  following.delete(threadId),
              ),
            ),
          ),
        );
        following.set(threadId, fiber);
      });
    const unfollow = (threadId: string) =>
      Effect.gen(function* () {
        const fiber = following.get(threadId);
        if (!fiber) return;
        following.delete(threadId);
        const sequence = after.get(threadId) ?? 0;
        after.delete(threadId);
        yield* Fiber.interrupt(fiber);
        send(threadId, null, sequence);
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
      whileConnected(online),
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

/** Runs again after the link drops, once it's back: no backoff of its own, so a reconnect brings every stream back with it. */
const whileConnected =
  (online: Latch.Latch) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    online.await.pipe(
      Effect.andThen(effect),
      Effect.retry({
        schedule: Schedule.spaced('500 millis'),
        while: isDropped,
      }),
    );
