import assert from 'node:assert/strict';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, it, vi } from '@effect/vitest';
import { Effect, Layer } from 'effect';
import type { SqlClient } from 'effect/sql';
import { backupNow, BACKUPS_KEPT, listBackups } from './backup.ts';
import { Store } from './store.ts';

const T0 = Date.UTC(2026, 0, 1);

const withStore = <A>(
  filename: string,
  body: Effect.Effect<A, unknown, Store | SqlClient.SqlClient>,
) =>
  Effect.scoped(
    Effect.provide(body, Store.layer(filename).pipe(Layer.orDie)),
  ) as Effect.Effect<A>;

afterEach(() => {
  vi.useRealTimers();
});

it.effect(
  'a corrupt database is kept aside and the latest good backup is restored with its data',
  () =>
    Effect.gen(function* () {
      const dir = mkdtempSync(join(tmpdir(), 'mochi-backup-'));
      const filename = join(dir, 'mochi.db');
      yield* withStore(
        filename,
        Effect.gen(function* () {
          const store = yield* Store;
          yield* store.setDoc('settings', 'agent', { model: 'opus' });
          yield* backupNow(filename);
        }),
      );
      const garbage = 'not a database'.repeat(100);
      writeFileSync(filename, garbage);

      const settings = yield* withStore(
        filename,
        Effect.gen(function* () {
          return yield* (yield* Store).getDoc('settings', 'agent');
        }),
      );

      assert.deepEqual(settings, { model: 'opus' });
      const kept = readdirSync(dir).filter((name) =>
        name.startsWith('mochi.db.corrupt-'),
      );
      assert.equal(kept.length, 1);
      assert.equal(readFileSync(join(dir, kept[0]!), 'utf8'), garbage);
    }),
);

it.effect('rotation keeps the newest 7 backups', () =>
  Effect.gen(function* () {
    // A backup is named by its time to the millisecond; a second between them keeps every name distinct.
    vi.useFakeTimers({ toFake: ['Date'] });
    const dir = mkdtempSync(join(tmpdir(), 'mochi-backup-'));
    const filename = join(dir, 'mochi.db');
    const names = yield* withStore(
      filename,
      Effect.gen(function* () {
        for (let i = 0; i < BACKUPS_KEPT + 3; i++) {
          vi.setSystemTime(T0 + i * 1000);
          yield* backupNow(filename);
        }
        return listBackups(filename);
      }),
    );
    assert.equal(names.length, BACKUPS_KEPT);
    assert.ok(names.every((name) => existsSync(name)));
  }),
);
