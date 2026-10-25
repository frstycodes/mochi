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
} from '../../../../apps/desktop/src/host/types/agent.ts';
import type { Thread } from '../../../../apps/desktop/src/model.ts';
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
import { UtilityQueue } from '../utility/queue.ts';
import { ThreadContext } from './context.ts';
import type { HistoryArgs } from './history.ts';
import { launchSession } from './launch.ts';

const THREAD = 'new-1';
const BRIEF = {
  goal: 'Rate-limit the public API, tests green',
  decisions: ['Token bucket in src/limit.ts: bursts are fine'],
  ruledOut: ['A Redis limiter: no Redis in dev'],
  state: 'src/limit.ts added, limit.test.ts fails on refill',
  open: ['Fix the refill math'],
  preferences: ['No new dependencies'],
  chapters: [{ fromSeq: 1, toSeq: 9, line: 'added the limiter, tests red' }],
};

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

it.live(
  'a thread switches from Claude to Codex and back: Codex starts from the brief and the thread so far, Claude resumes its own session with only what it missed',
  () => {
    const dir = repo();
    const prompts: string[] = [];
    const ask = (_spaceId: string, prompt: string) =>
      Effect.sync(() => (prompts.push(prompt), JSON.stringify(BRIEF)));
    const layer = ThreadContext.layer(ask).pipe(
      Layer.provideMerge(Projection.layer(undefined)),
      Layer.provideMerge(Store.layer(join(dir, '.mochi.db'))),
      Layer.provideMerge(
        Layer.mergeAll(
          UtilityQueue.layer,
          Run.layer.pipe(Layer.provide(NodeServices.layer)),
        ),
      ),
      Layer.orDie,
    );
    return Effect.gen(function* () {
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
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => useEventLog(() => {})),
      );
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
      const afterFold = <A, E>(
        isReady: (t: Thread) => boolean,
        during: Effect.Effect<A, E>,
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

      // Claude's part of the thread: a long test run that failed, and enough turns for a brief.
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
      yield* agent({
        type: 'message',
        text: ' in src/limit.ts.',
        isDelta: true,
      });
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
      yield* agent({
        type: 'plan',
        items: [
          { title: 'Add the limiter', status: 'done' },
          { title: 'Fix the refill', status: 'pending' },
        ],
      });
      yield* say('No new dependencies, please');
      yield* agent({ type: 'message', text: 'Understood.', isDelta: false });
      const { value: turnEnd } = yield* afterFold(
        (t) => t.live?.turnEnd === 'done',
        agent({ type: 'turn-end', status: 'done' }),
      );
      yield* context.updateBrief(THREAD);
      assert.equal(prompts.length, 1, 'one brief job for the turn');
      assert.match(prompts[0], /\] User: Add a rate limiter to the API/);
      assert.match(
        prompts[0],
        /\] Agent: Adding a token bucket in src\/limit\.ts\./,
      );
      const brief = yield* context.briefOf(THREAD);
      assert.deepEqual(brief, { throughSeq: turnEnd.sequence, brief: BRIEF });

      // The switch waits for your next message, which goes to Codex with the model you picked.
      const pending = yield* afterFold(
        (t) => t.providers[0] === 'codex',
        command({
          type: 'provider-switch',
          threadId: THREAD,
          to: 'codex',
          model: 'gpt-6',
        }),
      );
      assert.equal(pending.thread.activity.at(-1)?.handoff?.status, 'pending');
      assert.equal(
        pending.thread.activity.at(-1)?.handoff?.fromModel,
        '',
        "Claude's default",
      );
      assert.equal(pending.thread.agent, undefined, "Claude's own report goes");
      assert.equal(
        isUnstarted({
          ...pending.thread,
          repo: { path: dir } as Thread['repo'],
          live: { ...pending.thread.live!, isDetached: true },
        }),
        false,
        'a pending switch is no new thread',
      );
      const send: Action = {
        type: 'send',
        threadId: THREAD,
        text: 'Fix the refill math',
        reason: '',
      };
      const [start] = agentCalls(pending.state, send, () =>
        project(pending.state, send),
      );
      assert.ok(start?.method === 'start');
      assert.equal(start.options.provider, 'codex');
      assert.equal(start.options.switchFrom, 'claude');
      assert.equal(
        start.options.resume,
        undefined,
        'no Claude session for Codex',
      );
      assert.equal(start.options.model, 'gpt-6');
      assert.equal(
        start.options.prompt,
        'Fix the refill math',
        'your words, as typed',
      );

      const codexStarts: AgentRunOptions[] = [];
      const run = (options: typeof start.options): AgentRunOptions => ({
        provider: options.provider,
        spaceId: options.spaceId,
        prompt: options.prompt,
        model: options.model,
        cwd: dir,
      });
      const switched = yield* afterFold(
        (t) => t.activity.at(-1)?.handoff?.status === 'started',
        Effect.promise(() =>
          launchSession(
            context,
            fakeAdapter(codexStarts),
            THREAD,
            run(start.options),
            start.options.switchFrom,
          ),
        ),
      );
      const [codex] = codexStarts;
      assert.equal(codex.resume, undefined);
      assert.equal(codex.prompt, 'Fix the refill math');
      const sent = codex.context ?? '';
      assert.match(sent, /continues with you/);
      assert.match(
        sent,
        /\*\*Goal:\*\* Rate-limit the public API/,
        'the brief',
      );
      assert.match(sent, /A Redis limiter: no Redis in dev/);
      assert.match(
        sent,
        /User: No new dependencies, please/,
        'the latest turns',
      );
      assert.match(
        sent,
        /\[… [\d,]+ lines, thread_history get seq=\d+\]/,
        'the long output cut',
      );
      assert.match(sent, /FAIL limit\.test\.ts refill/, 'its tail kept');
      assert.match(sent, /Branch main at \w+ add limiter/, 'the worktree now');
      assert.match(sent, /M limit\.ts/);

      // The thread records exactly what Codex got.
      const row = switched.thread.activity.at(-1)!.handoff!;
      assert.equal(row.prompt, sent);
      assert.equal(row.model, 'gpt-6');
      assert.equal(row.fromModel, '', 'kept from the pending row');
      assert.match(
        row.contents ?? '',
        /^brief, 2 recent turns, [\d.]+k tokens$/,
      );

      // What the package cut, Codex gets back from the event log.
      const ask_ = (args: HistoryArgs) =>
        Effect.map(context.history(THREAD, args), (r) =>
          r.content.map((c) => (c.type === 'text' ? c.text : '')).join(''),
        );
      const pointer = Number(/thread_history get seq=(\d+)/.exec(sent)![1]);
      const full = yield* ask_({ op: 'get', seq: pointer });
      assert.equal(full.match(/^ok$/gm)?.length, 4000, 'the whole output');
      assert.equal(yield* ask_({ op: 'get', toolCallId: 't1' }), full);
      assert.match(
        yield* ask_({ op: 'outline' }),
        /Goal: Rate-limit the public API, tests green\n1–9 · added the limiter, tests red/,
      );
      const hits = yield* ask_({ op: 'search', query: 'no new dependencies' });
      assert.match(hits, /^\[\d+\] you: …No new dependencies, please…$/);
      const first = yield* ask_({ op: 'read', fromSeq: 0, toSeq: pointer - 1 });
      assert.match(first, /User: Add a rate limiter to the API/);
      assert.doesNotMatch(
        first,
        /pnpm test|Run the tests/,
        'the range ends before the tool',
      );

      // Codex's part, then back to Claude: its own session resumes with what it missed, not the thread again.
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
      yield* afterFold(
        (t) => t.providers[0] === 'claude',
        command({ type: 'provider-switch', threadId: THREAD, to: 'claude' }),
      );

      const claudeStarts: AgentRunOptions[] = [];
      const claude = fakeAdapter(claudeStarts);
      const back = {
        provider: 'claude' as const,
        spaceId: 's',
        prompt: 'Ship it',
        cwd: dir,
      };
      yield* Effect.promise(() =>
        launchSession(context, claude, THREAD, back, 'codex'),
      );
      const [resumed] = claudeStarts;
      assert.equal(resumed.resume, 'claude-1');
      const delta = resumed.context ?? '';
      assert.match(delta, /You are back on this thread after it ran on Codex/);
      assert.match(delta, /Agent: Refill fixed, tests green\./);
      assert.doesNotMatch(
        delta,
        /Add a rate limiter/,
        'Claude saw that already',
      );
      assert.doesNotMatch(delta, /## Brief/, 'all it missed fits');

      // A later launch of that session (a Core restart) gets the same package again.
      yield* Effect.promise(() =>
        launchSession(context, claude, THREAD, back, undefined),
      );
      assert.equal(claudeStarts[1].context, delta);
    }).pipe(Effect.scoped, Effect.provide(layer));
  },
);
