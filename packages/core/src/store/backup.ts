import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Effect, Layer, Schedule } from 'effect';
import { SqlClient } from 'effect/sql';

export const BACKUPS_KEPT = 7;
const DAY_MS = 24 * 60 * 60 * 1000;
// A tick lands a day after the last backup, give or take scheduling jitter.
const DUE_AFTER_MS = DAY_MS - 60 * 60 * 1000;

const backupDir = (filename: string) => join(dirname(filename), 'backups');
const stamp = () => new Date().toISOString().replaceAll(':', '-');

/** Backups, newest first. The ISO stamp in the name sorts as time. */
export const listBackups = (filename: string) =>
  existsSync(backupDir(filename))
    ? readdirSync(backupDir(filename))
        .filter((name) => name.startsWith('mochi-') && name.endsWith('.db'))
        .toSorted()
        .toReversed()
        .map((name) => join(backupDir(filename), name))
    : [];

/** `PRAGMA quick_check` on its own connection; an unopenable file counts as bad. */
export const isHealthy = (file: string) => {
  try {
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      return (
        (
          db.prepare('PRAGMA quick_check').get() as
            | { quick_check?: string }
            | undefined
        )?.quick_check === 'ok'
      );
    } finally {
      db.close();
    }
  } catch {
    return false;
  }
};

/**
 * Online backup with `VACUUM INTO`: the vendored client does not expose `node:sqlite`'s `backup()`. Written under a temp
 * name and renamed, so a crash never leaves a half file that looks like a backup. Keeps the newest `BACKUPS_KEPT`.
 */
export const backupNow = (filename: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    mkdirSync(backupDir(filename), { recursive: true });
    const target = join(backupDir(filename), `mochi-${stamp()}.db`);
    const partial = `${target}.partial`;
    rmSync(partial, { force: true });
    yield* sql`VACUUM INTO ${partial}`;
    renameSync(partial, target);
    for (const old of listBackups(filename).slice(BACKUPS_KEPT))
      rmSync(old, { force: true });
    yield* Effect.logInfo(`Backed up the database to ${target}`).pipe(
      Effect.annotateLogs({ source: 'core' }),
    );
    return target;
  });

const isDue = (filename: string) => {
  const [latest] = listBackups(filename);
  return !latest || Date.now() - statSync(latest).mtimeMs >= DUE_AFTER_MS;
};

/** Backs up when the newest backup is a day old, at startup and then every day. Needs the `SqlClient`. */
export const backupSchedule = (filename: string) =>
  Layer.effectDiscard(
    Effect.forkScoped(
      Effect.suspend(() =>
        isDue(filename) ? backupNow(filename) : Effect.void,
      ).pipe(
        Effect.catch((error) =>
          Effect.logWarning(`Backup failed: ${error.message}`).pipe(
            Effect.annotateLogs({ source: 'core' }),
          ),
        ),
        Effect.repeat(Schedule.spaced('1 day')),
      ),
    ),
  );

/**
 * Startup check, before the database is opened. A database that fails `quick_check` is renamed `.corrupt-<timestamp>`
 * (with its `-wal` and `-shm`, which would otherwise be replayed onto the restored file) and the newest healthy backup
 * is copied in its place. The bad file is never deleted. With no healthy backup it is still moved aside, so Core starts
 * on an empty database rather than on a corrupt one.
 */
export const restoreIfCorrupt = (filename: string) =>
  Effect.gen(function* () {
    if (!existsSync(filename) || isHealthy(filename)) return;
    const kept = `${filename}.corrupt-${stamp()}`;
    for (const suffix of ['', '-wal', '-shm'])
      if (existsSync(filename + suffix))
        renameSync(filename + suffix, kept + suffix);
    const good = listBackups(filename).find(isHealthy);
    if (good) copyFileSync(good, filename);
    const outcome = good
      ? `restored ${basename(good)}`
      : 'no healthy backup, starting empty';
    yield* Effect.logError(
      `${basename(filename)} failed quick_check; kept as ${basename(kept)}, ${outcome}`,
    ).pipe(Effect.annotateLogs({ source: 'core' }));
  });

export const restoreLayer = (filename: string) =>
  Layer.effectDiscard(restoreIfCorrupt(filename));
