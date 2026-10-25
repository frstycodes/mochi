import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { it } from '@effect/vitest';
import { Effect, Fiber, Layer, Option, Queue, Stream } from 'effect';
import { NodeServices } from '@effect/platform-node';
import { COMMAND_TYPE, project } from '@mochi/domain';
import type {
  AgentEvent,
  AgentRunOptions,
  AgentStartOptions,
} from '../../../../apps/desktop/src/host/types/agent.ts';
import type { Provider, Thread } from '../../../../apps/desktop/src/model.ts';
import { isUnstarted } from '../../../../apps/desktop/src/git/workspace.ts';
import { agentCalls } from '../../../../apps/desktop/src/runtime/live.ts';
import type {
  Action,
  State,
} from '../../../../apps/desktop/src/store/types.ts';
import type { HarnessAdapter } from '../agents/adapter.ts';
import { useEventLog, type SeqEvent } from '../agents/events.ts';
import { Run } from '../run.ts';
import { Projection } from '../store/projection.ts';
import { Store } from '../store/store.ts';
import { ThreadContext } from './context.ts';
import type { HandoffAsk } from './handoff.ts';
import type { HistoryArgs } from './history.ts';
import { launchSession } from './launch.ts';

const THREAD = 'new-1';

/** The thread's latest switch row. */
const rowOf = (thread: Thread) =>
  thread.activity.findLast((e) => e.handoff?.isSwitch)?.handoff;

type Unthreaded<E> = E extends unknown ? Omit<E, 'threadId'> : never;

/** A harness that records each start instead of running an agent. */
const fakeAdapter = (starts: AgentRunOptions[]) =>
  ({
    start: async (_threadId: string, run: AgentRunOptions) =>
      void starts.push(run),
  }) as unknown as HarnessAdapter;

const repo = () => {
  const dir = mkdtempSync(join(tmpdir(), 'mochi-switch-'));
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
  git('init', '-q', '-b', 'main');
  writeFileSync(join(dir, 'limit.ts'), 'export {}\n');
  git('add', '.');
  git(
    '-c',
    'user.name=t',
    '-c',
    'user.email=t@t',
    'commit',
    '-qm',
    'add limiter',
  );
  writeFileSync(join(dir, 'limit.ts'), 'export const refill = 1\n');
  return dir;
};

/**
 * A Core with its store, projection and `ThreadContext`, a Claude thread that ran a turn (a long failing test run among it),
 * and helpers to drive it. Each handoff side turn goes to `answer`, which says what the fake session replies.
 */
const withThread = <A>(
  answer: (ask: HandoffAsk) => string | null,
  body: (
    core: Effect.Success<ReturnType<typeof setUp>>,
  ) => Effect.Effect<A, unknown>,
) => {
  const dir = repo();
  const asks: HandoffAsk[] = [];
  const layer = ThreadContext.layer((_thread, _space, _cwd, ask) =>
    Effect.sync(() => (asks.push(ask), answer(ask))),
  ).pipe(
    Layer.provideMerge(Projection.layer(undefined)),
    Layer.provideMerge(Store.layer(join(dir, '.mochi.db'))),
    Layer.provideMerge(Run.layer.pipe(Layer.provide(NodeServices.layer))),
    Layer.orDie,
  );
  return Effect.gen(function* () {
    const core = yield* setUp(dir, asks);
    return yield* body(core);
  }).pipe(Effect.scoped, Effect.provide(layer));
};

const setUp = (dir: string, asks: HandoffAsk[]) =>
  Effect.gen(function* () {
    const store = yield* Store;
    const projection = yield* Projection;
    const context = yield* ThreadContext;
    // What `launchSession` emits goes into the log, in order, as the agents layer does.
    const emitted = yield* Queue.unbounded<SeqEvent>();
    useEventLog((event) => Queue.offerUnsafe(emitted, event));
    yield* Stream.fromQueue(emitted).pipe(
      Stream.runForEach((event) =>
        store.append({
          type: `agent.${event.type}`,
          threadId: event.threadId,
          payload: event,
        }),
      ),
      Effect.forkScoped,
    );
    yield* Effect.addFinalizer(() => Effect.sync(() => useEventLog(() => {})));
    const command = (action: Action) =>
      store.append({ type: COMMAND_TYPE, threadId: THREAD, payload: action });
    const agent = (event: Unthreaded<AgentEvent>) =>
      store.append({
        type: `agent.${event.type}`,
        threadId: THREAD,
        payload: { ...event, threadId: THREAD },
      });
    const say = (text: string) =>
      command({ type: 'send', threadId: THREAD, text, reason: '' });
    /** Runs `during`, then waits for the fold that leaves the thread `isReady`; watching starts before `during` does. */
    const afterFold = <B, E>(
      isReady: (t: Thread) => boolean,
      during: Effect.Effect<B, E>,
    ) =>
      Effect.gen(function* () {
        const folded = yield* Effect.forkChild(
          projection.folded.pipe(
            Stream.map(({ after }) => after as unknown as State),
            Stream.filter((state) =>
              state.threads.some((t) => t.id === THREAD && isReady(t)),
            ),
            Stream.runHead,
          ),
          { startImmediately: true },
        );
        const value = yield* during;
        const state = Option.getOrThrow(yield* Fiber.join(folded));
        const thread = state.threads.find((t) => t.id === THREAD)!;
        return { value, state, thread };
      });
    /** Picks `to` in the composer; the start your next message makes, as the renderer would call it. */
    const switchTo = (to: Provider, model?: string) =>
      Effect.gen(function* () {
        const { state } = yield* afterFold(
          (t) =>
            t.providers[0] === to &&
            t.activity.at(-1)?.handoff?.status === 'pending',
          command({ type: 'provider-switch', threadId: THREAD, to, model }),
        );
        const send: Action = {
          type: 'send',
          threadId: THREAD,
          text: 'Go on',
          reason: '',
        };
        const [call] = agentCalls(state, send, () => project(state, send));
        assert.ok(call?.method === 'start');
        yield* command(send);
        return call.options;
      });
    /** Starts `options` on a fake harness through Core's start path; the run it got and the thread once the row records it. */
    const start = (options: AgentStartOptions) =>
      Effect.gen(function* () {
        const starts: AgentRunOptions[] = [];
        const { thread } = yield* afterFold(
          (t) => rowOf(t)?.status === 'started',
          Effect.promise(() =>
            launchSession(
              context,
              fakeAdapter(starts),
              THREAD,
              {
                provider: options.provider,
                spaceId: options.spaceId,
                prompt: options.prompt,
                ...(options.model && { model: options.model }),
                cwd: dir,
              },
              options.switchFrom,
            ),
          ),
        );
        return {
          run: starts[0],
          row: rowOf(thread)!,
          thread,
        };
      });

    yield* command({
      type: 'create',
      spaceId: 's',
      title: 'Rate limiter',
      provider: 'claude',
      project: null,
      isLive: true,
      prompt: 'Add a rate limiter to the API',
    });
    yield* agent({
      type: 'session',
      provider: 'claude',
      sessionId: 'claude-1',
    });
    yield* agent({
      type: 'message',
      text: 'Adding a token bucket',
      isDelta: false,
    });
    yield* agent({ type: 'message', text: ' in src/limit.ts.', isDelta: true });
    yield* agent({
      type: 'tool',
      id: 't1',
      phase: 'start',
      text: 'Run the tests',
      command: 'pnpm test',
    });
    yield* agent({
      type: 'tool',
      id: 't1',
      phase: 'end',
      text: 'Run the tests',
      exitCode: 1,
      output: `${'ok\n'.repeat(4000)}FAIL limit.test.ts refill`,
    });
    yield* say('No new dependencies, please');
    yield* afterFold(
      (t) => t.live?.turnEnd === 'done',
      agent({ type: 'turn-end', status: 'done' }),
    );
    return {
      store,
      context,
      command,
      agent,
      say,
      afterFold,
      switchTo,
      start,
      asks,
    };
  });

it.live(
  'Claude to Codex: Claude writes the handoff from its own session at the next start, Codex starts from it; back on Claude, its session resumes with only what it missed',
  () =>
    withThread(
      (ask) =>
        ask.provider === 'claude'
          ? '## Goal\nRate-limit the API\n## Why\nToken bucket: bursts are fine'
          : null,
      ({ store, context, agent, say, switchTo, start, asks }) =>
        Effect.gen(function* () {
          const options = yield* switchTo('codex', 'gpt-6');
          assert.equal(asks.length, 0, 'picking a provider runs nothing');
          assert.deepEqual(options.switchFrom, { provider: 'claude' });
          assert.equal(options.resume, undefined);
          assert.equal(options.model, 'gpt-6');

          const { run, row, thread } = yield* start(options);
          assert.equal(asks.length, 1);
          assert.equal(asks[0].provider, 'claude');
          assert.equal(
            asks[0].resume,
            'claude-1',
            "Claude's own session writes it",
          );
          assert.match(asks[0].prompt, /handing this thread over to Codex/);
          assert.equal(run.resume, undefined);
          assert.equal(run.prompt, 'Go on', 'your words, as typed');
          const sent = run.context ?? '';
          assert.match(
            sent,
            /## Handoff \(written by Claude\)\n## Goal\nRate-limit the API/,
          );
          assert.match(
            sent,
            /User: No new dependencies, please/,
            'the latest turns',
          );
          assert.doesNotMatch(
            sent,
            /User: Go on/,
            'your message goes as itself',
          );
          assert.match(sent, /\[… [\d,]+ lines, thread_history get seq=\d+\]/);
          assert.match(sent, /FAIL limit\.test\.ts refill/);
          assert.match(
            sent,
            /use the tool only when you need something it doesn't cover/,
          );
          assert.match(sent, /Branch main at \w+ add limiter/);
          assert.equal(row.prompt, sent);
          assert.equal(row.handoffBy, 'claude');
          assert.equal(row.model, 'gpt-6');
          assert.match(
            row.contents ?? '',
            /^handoff by Claude, 2 recent turns, [\d.]+k tokens$/,
          );
          assert.equal(thread.agent, undefined);
          assert.equal(
            thread.session,
            undefined,
            "Claude's session left with the start",
          );
          const logged = yield* store.eventsAfter(0);
          assert.ok(
            logged.some((e) => e.type === 'agent.context-writing'),
            'the row said the handoff was being written',
          );

          // What the package cut, Codex gets back from the event log when it needs it.
          const historyText = (args: HistoryArgs) =>
            Effect.map(context.history(THREAD, args), (r) =>
              r.content.map((c) => (c.type === 'text' ? c.text : '')).join(''),
            );
          const pointer = Number(/thread_history get seq=(\d+)/.exec(sent)![1]);
          const full = yield* historyText({ op: 'get', seq: pointer });
          assert.equal(full.match(/^ok$/gm)?.length, 4000, 'the whole output');
          assert.equal(
            yield* historyText({ op: 'get', toolCallId: 't1' }),
            full,
          );
          assert.match(
            yield* historyText({ op: 'outline' }),
            /^\d+–\d+ · Add a rate limiter to the API\n\d+–\d+ · No new dependencies, please/,
          );
          assert.match(
            yield* historyText({ op: 'search', query: 'no new dependencies' }),
            /^\[\d+\] you: …No new dependencies, please…$/m,
          );
          const before = yield* historyText({
            op: 'read',
            fromSeq: 0,
            toSeq: pointer - 1,
          });
          assert.match(before, /User: Add a rate limiter to the API/);
          assert.doesNotMatch(
            before,
            /Run the tests/,
            'the range ends before the tool',
          );

          yield* agent({
            type: 'session',
            provider: 'codex',
            sessionId: 'codex-1',
          });
          yield* say('Fix the refill math');
          yield* agent({
            type: 'message',
            text: 'Refill fixed, tests green.',
            isDelta: false,
          });
          yield* agent({ type: 'turn-end', status: 'done' });
          const back = yield* start(yield* switchTo('claude'));
          assert.equal(
            asks.length,
            1,
            'a session coming back needs no handoff',
          );
          assert.equal(back.run.resume, 'claude-1');
          const delta = back.run.context ?? '';
          assert.match(
            delta,
            /You are back on this thread after it ran on Codex/,
          );
          assert.match(delta, /Agent: Refill fixed, tests green\./);
          assert.doesNotMatch(
            delta,
            /Add a rate limiter/,
            'Claude saw that already',
          );
          assert.doesNotMatch(delta, /## Handoff/);
        }),
    ),
);

it.live(
  'out of usage: Codex writes its own handoff from the whole transcript; another Claude model starts a fresh session from its own handoff',
  () =>
    withThread(
      (ask) =>
        `Handoff by ${ask.provider}${ask.model ? ` on ${ask.model}` : ''}`,
      ({ agent, switchTo, start, asks, afterFold }) =>
        Effect.gen(function* () {
          yield* afterFold(
            (t) => !!t.live?.limit,
            agent({ type: 'limit', label: 'Weekly' }),
          );
          const options = yield* switchTo('codex');
          assert.deepEqual(options.switchFrom, {
            provider: 'claude',
            isLimited: true,
          });
          const { run, row } = yield* start(options);
          assert.equal(asks.length, 1, "Claude can't write it");
          assert.equal(asks[0].provider, 'codex');
          assert.equal(asks[0].resume, undefined);
          assert.match(asks[0].prompt, /a coding thread you are taking over/);
          assert.match(
            asks[0].prompt,
            /User: Add a rate limiter to the API/,
            'the whole transcript',
          );
          assert.match(
            run.context ?? '',
            /## Handoff \(written by you, from the transcript\)\nHandoff by codex/,
          );
          assert.equal(row.handoffBy, 'codex');
        }),
    ).pipe(
      Effect.andThen(
        withThread(
          (ask) => `Handoff by ${ask.provider} on ${ask.model}`,
          ({ agent, switchTo, start, asks, afterFold }) =>
            Effect.gen(function* () {
              yield* afterFold(
                (t) => !!t.live?.limit,
                agent({ type: 'limit', label: 'Weekly' }),
              );
              const options = yield* switchTo('claude', 'claude-sonnet-5-5');
              assert.deepEqual(options.switchFrom, {
                provider: 'claude',
                isLimited: true,
              });
              const { run } = yield* start(options);
              assert.equal(asks.length, 1);
              assert.equal(asks[0].provider, 'claude');
              assert.equal(asks[0].model, 'claude-sonnet-5-5');
              assert.equal(
                asks[0].resume,
                undefined,
                'its own handoff, from the transcript',
              );
              assert.equal(
                run.resume,
                undefined,
                'a fresh session, not the full one',
              );
              assert.match(
                run.context ?? '',
                /continues in a fresh session: the previous one ran out of usage/,
              );
            }),
        ),
      ),
    ),
);

it.live(
  "a thread bigger than the new model's window and an outgoing session out of usage: the handoff is folded part by part, oldest first",
  () => {
    let calls = 0;
    return withThread(
      () => `Handoff after part ${++calls}`,
      ({ agent, say, switchTo, start, asks, afterFold }) =>
        Effect.gen(function* () {
          for (const n of [1, 2, 3]) {
            yield* say(`Part ${n}`);
            yield* agent({
              type: 'message',
              text: `${n}`.repeat(400_000),
              isDelta: false,
            });
          }
          yield* afterFold(
            (t) => !!t.live?.limit,
            agent({ type: 'limit', label: 'Weekly' }),
          );
          const { run } = yield* start(yield* switchTo('codex'));
          assert.ok(asks.length >= 3, `${asks.length} parts`);
          assert.match(asks[0].prompt, /Handoff so far:\n\(none yet\)/);
          assert.match(
            asks[1].prompt,
            /Handoff so far:\nHandoff after part 1/,
            'each part folds into the last',
          );
          assert.ok(asks.every((a) => a.provider === 'codex' && !a.resume));
          assert.match(
            run.context ?? '',
            new RegExp(`Handoff after part ${asks.length}`),
          );
        }),
    );
  },
);

it.live('a pending switch is no new thread', () =>
  withThread(
    () => null,
    ({ switchTo, afterFold, command }) =>
      Effect.gen(function* () {
        yield* switchTo('codex');
        const { thread } = yield* afterFold(
          (t) => t.providers[0] === 'codex',
          command({ type: 'rename', threadId: THREAD, title: 'Rate limiter' }),
        );
        assert.equal(thread.agent, undefined, "Claude's own report goes");
        assert.equal(
          isUnstarted({
            ...thread,
            repo: { path: '/x' } as Thread['repo'],
            live: { ...thread.live!, isDetached: true },
          }),
          false,
        );
      }),
  ),
);
