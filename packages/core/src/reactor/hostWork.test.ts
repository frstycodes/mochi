import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { it } from '@effect/vitest';
import { Effect } from 'effect';
import type { Thread } from '../../../../apps/desktop/src/model.ts';
import { DEFAULT_CONTEXT } from '../../../../apps/desktop/src/store/context.ts';
import type {
  Action,
  State,
} from '../../../../apps/desktop/src/store/types.ts';
import type { GitHub } from '../github/service.ts';
import { Capabilities, hostHandlers } from '../hostServer.ts';
import { autoSimplify, gatherIdle, type HostWork } from './hostWork.ts';

const folder = mkdtempSync(`${tmpdir()}/mochi-hostwork-`);
const thread = {
  id: 't1',
  spaceId: 's',
  status: 'running',
  goal: 'Ship it',
  criteria: [{ id: 'c1', text: 'Tests pass', command: 'pnpm test' }],
  repo: { project: 'app', path: folder, branch: 'main', mode: 'folder' },
  activity: [
    { at: 1, who: 'you', kind: 'message', text: 'Make it pass' },
    { at: 2, who: 'claude', kind: 'message', text: 'one two three four five' },
  ],
  providers: ['claude'],
  live: { isWorking: false, cwd: folder },
} as unknown as Thread;
const state = (prefs: Partial<State['context']['prefs']> = {}) =>
  ({
    threads: [thread],
    context: {
      ...DEFAULT_CONTEXT,
      prefs: { ...DEFAULT_CONTEXT.prefs, ...prefs },
    },
  }) as unknown as State;

/** Core's host work with no desktop client connected: main's `host` is served by nobody. */
const windowless = (applied: Action[], answer: string | null = null) =>
  Effect.gen(function* () {
    const host = hostHandlers(yield* Capabilities, undefined) as Record<
      string,
      (args: ReadonlyArray<unknown>) => Effect.Effect<unknown, unknown>
    >;
    return {
      apply: (action) => Effect.sync(() => void applied.push(action)),
      host: (tag, args) => host[tag]!(args),
      utility: () => Effect.succeed(answer),
      github: {} as GitHub['Service'],
      current: Effect.succeed(state()),
    } satisfies HostWork;
  }).pipe(Effect.provide(Capabilities.layer));

it.effect(
  'idle gathering with no desktop client: the check fails with why, and the idle record still ends',
  () =>
    Effect.gen(function* () {
      const applied: Action[] = [];
      yield* gatherIdle(
        yield* windowless(applied),
        state({ idleChecks: 'always' }),
        thread,
      ).pipe(Effect.timeout('2 seconds'));
      const checks = applied.flatMap((a) =>
        a.type === 'criterion-check' ? [a.result] : [],
      );
      assert.equal(checks[0], 'running');
      assert.deepEqual(checks[1], {
        exitCode: null,
        output: 'No connected client offers host',
        ms: 0,
      });
      assert.equal(applied[0]?.type, 'idle-start');
      assert.deepEqual(applied.at(-1), {
        type: 'idle-update',
        threadId: 't1',
        patch: { isGathering: false },
      });
      assert.ok(
        !applied.some(
          (a) => a.type === 'idle-update' && 'uncommitted' in a.patch,
        ),
        'no git status without a host',
      );
    }),
);

it.effect(
  'auto simplify runs in Core: the model’s version, else a plain cut; a short reply is left alone',
  () =>
    Effect.gen(function* () {
      const applied: Action[] = [];
      const on = state({ simplifyAuto: true, simplifyAutoWords: 3 });
      const reviewed = { ...thread, status: 'review' } as Thread;
      yield* autoSimplify(yield* windowless(applied, 'Short.'), on, reviewed);
      yield* autoSimplify(yield* windowless(applied), on, reviewed);
      assert.deepEqual(
        applied.map((a) => a.type === 'simplified' && a.text),
        ['Short.', '- one two three four five'],
      );
      assert.equal(
        yield* autoSimplify(
          yield* windowless(applied),
          state({ simplifyAuto: true, simplifyAutoWords: 50 }),
          reviewed,
        ),
        'skipped',
      );
    }),
);
