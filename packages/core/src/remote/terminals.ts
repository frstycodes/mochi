import { Context, Effect, Layer, PubSub, Schema, Stream } from 'effect';
import { Rpc, RpcGroup } from 'effect/rpc';
import { Relay } from '@mochi/schema';

/** Output kept per terminal; a subscriber further behind than this resumes at the oldest byte kept. */
export const MAX_OUTPUT = 256 * 1024;

export class TerminalUnknown extends Schema.TaggedError<TerminalUnknown>()('TerminalUnknown', { terminalId: Schema.String }) {}

/**
 * The shells this computer opens for devices belong to the window that owns the store: it registers each (`terminal.open`)
 * and feeds what the pty prints. A device with the `terminal` scope subscribes to `terminal.output` and is pushed the bytes.
 */
export class TerminalRpcs extends RpcGroup.make(
  Rpc.make('terminal.open', { payload: { terminalId: Schema.String, threadId: Schema.String } }),
  Rpc.make('terminal.feed', { payload: { terminalId: Schema.String, data: Schema.String } }),
  Rpc.make('terminal.exit', { payload: { terminalId: Schema.String, exitCode: Schema.Number } }),
  Rpc.make('terminal.close', { payload: { terminalId: Schema.String } }),
  /** Whether a device is subscribed now: an open pane sends nothing else, and its window keeps the shell open while this holds. */
  Rpc.make('terminal.watched', { payload: { terminalId: Schema.String }, success: Schema.Boolean }),
  /** From offset `after`, then each chunk as it is printed, in order; ends after the chunk that carries `exitCode`. */
  Rpc.make('terminal.output', {
    payload: { terminalId: Schema.String, threadId: Schema.String, after: Schema.Number },
    success: Relay.TerminalOutput,
    error: TerminalUnknown,
    stream: true,
  }),
) {}

interface Shell {
  threadId: string;
  output: string;
  /** Offset of `output[0]` in everything the shell printed. */
  start: number;
  exitCode?: number;
  watchers: number;
  changed: PubSub.PubSub<void>;
}

export class Terminals extends Context.Service<Terminals>()('mochi/core/Terminals', {
  make: Effect.sync(() => {
    const shells = new Map<string, Shell>();

    const read = (shell: Shell, after: number): typeof Relay.TerminalOutput.Type => {
      const from = Math.max(after, shell.start) - shell.start;
      return { data: shell.output.slice(from), next: shell.start + shell.output.length, ...(shell.exitCode !== undefined && { exitCode: shell.exitCode }) };
    };

    const open = (terminalId: string, threadId: string) =>
      Effect.gen(function* () {
        shells.set(terminalId, { threadId, output: '', start: 0, watchers: 0, changed: yield* PubSub.sliding<void>(1) });
      });

    const feed = (terminalId: string, data: string) =>
      Effect.sync(() => {
        const shell = shells.get(terminalId);
        if (!shell) return;
        shell.output += data;
        const over = shell.output.length - MAX_OUTPUT;
        if (over > 0) {
          shell.output = shell.output.slice(over);
          shell.start += over;
        }
        PubSub.publishUnsafe(shell.changed, undefined);
      });

    const exit = (terminalId: string, exitCode: number) =>
      Effect.sync(() => {
        const shell = shells.get(terminalId);
        if (!shell) return;
        shell.exitCode = exitCode;
        PubSub.publishUnsafe(shell.changed, undefined);
      });

    const watched = (terminalId: string) => Effect.sync(() => (shells.get(terminalId)?.watchers ?? 0) > 0);

    const close = (terminalId: string) => Effect.sync(() => void shells.delete(terminalId));

    /** The thread's own shell only: a device names the thread it was shown, so another thread's terminal id gets nothing. */
    const output = (terminalId: string, threadId: string, after: number) =>
      Stream.unwrap(
        Effect.gen(function* () {
          const shell = shells.get(terminalId);
          if (shell?.threadId !== threadId) return yield* new TerminalUnknown({ terminalId });
          // Subscribed before the first read, so output printed in between wakes the loop instead of being missed.
          const wake = yield* PubSub.subscribe(shell.changed);
          yield* Effect.acquireRelease(Effect.sync(() => void shell.watchers++), () => Effect.sync(() => void shell.watchers--));
          let cursor = after;
          return Stream.concat(Stream.make(undefined), Stream.fromSubscription(wake)).pipe(
            Stream.map(() => {
              const chunk = read(shell, cursor);
              cursor = chunk.next;
              return chunk;
            }),
            Stream.filter((chunk) => chunk.data !== '' || chunk.exitCode !== undefined),
            Stream.takeUntil((chunk) => chunk.exitCode !== undefined),
          );
        }),
      );

    return { open, feed, exit, close, watched, output };
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);
}
