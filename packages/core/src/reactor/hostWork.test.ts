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
import { autoSimplify, type HostWork } from './hostWork.ts';

const folder = mkdtempSync(`${tmpdir()}/mochi-hostwork-`);
const thread = {
  id: 't1',
  spaceId: 's',
  status: 'running',
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

/** Core's host work, recording what it applies; the utility model answers `answer`. */
const windowless = (applied: Action[], answer: string | null = null) =>
  Effect.succeed({
    apply: (action) => Effect.sync(() => void applied.push(action)),
    utility: () => Effect.succeed(answer),
    github: {} as GitHub['Service'],
    current: Effect.succeed(state()),
  } satisfies HostWork);

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
