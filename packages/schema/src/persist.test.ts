import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'vite-plus/test';
import { Schema } from 'effect';
import { Mention } from './model.ts';
import { Checkpoint, Saved, SavedIndex, SavedThread } from './persist.ts';

const recorded = JSON.parse(
  readFileSync(new URL('../fixtures/saved.json', import.meta.url), 'utf8'),
);

test('thread files as the app writes them today read as v1, every field kept but what checkpoints take from the live thread', () => {
  const decode = Schema.decodeUnknownSync(SavedThread);
  const encode = Schema.encodeSync(SavedThread);
  for (const file of recorded.threads) {
    const decoded = decode(file);
    // Decoding drops keys a schema lacks, so equality means no field of the recorded thread went missing.
    assert.deepEqual(decoded, {
      ...file,
      v: 1,
      ...(file.checkpoints && { checkpoints: file.checkpoints.map(slim) }),
    });
    assert.deepEqual(decode(encode(decoded)), decoded);
  }
});

test('the index file reads as v1, with its version field replaced', () => {
  const { version, ...rest } = recorded.index;
  assert.equal(version, 1);
  const decoded = Schema.decodeUnknownSync(SavedIndex)(recorded.index);
  assert.deepEqual(decoded, { ...rest, v: 1 });
  assert.deepEqual(Schema.encodeSync(SavedIndex)(decoded), { ...rest, v: 1 });
});

test('a pre-split save lifts its legacy values: a waiting step is up next, an overlap card is dropped, old controls read as today', () => {
  const saved = Schema.decodeUnknownSync(Saved)(recorded.legacy);
  assert.equal(saved.v, 1);
  assert.equal(saved.threads[0].steps[0].status, 'ready');
  assert.deepEqual(saved.threads[0].controls, {
    model: '',
    effort: 'high',
    speed: '',
    access: 'Manual',
  });
  assert.deepEqual(saved.queue, []);
  assert.deepEqual(
    [saved.checkpoints, saved.checkpointSeq, saved.forks],
    [{}, 0, {}],
  );
});

test('an access value no build wrote reads as Auto, like accessOf, so the save still loads', () => {
  const [file] = recorded.threads;
  const odd = {
    ...file.thread,
    controls: { model: '', effort: '', speed: '', access: 'Yolo' },
  };
  assert.equal(
    Schema.decodeUnknownSync(SavedThread)({ thread: odd }).thread.controls
      ?.access,
    'Auto',
  );
});

test('a v1 file must not carry legacy values, and a later version is refused', () => {
  const [file] = recorded.threads;
  const waiting = {
    ...file.thread,
    steps: [{ ...file.thread.steps[0], status: 'waiting' }],
  };
  assert.throws(() =>
    Schema.decodeUnknownSync(SavedThread)({ v: 1, thread: waiting }),
  );
  assert.throws(() => Schema.decodeUnknownSync(SavedThread)({ ...file, v: 2 }));
  assert.throws(() =>
    Schema.decodeUnknownSync(SavedIndex)({ ...recorded.index, version: 2 }),
  );
});

test('a plugin @-mention round-trips', () => {
  const mention = {
    kind: 'plugin',
    id: 'plugin:emilkowalski',
    title: 'emilkowalski',
  };
  assert.deepEqual(
    Schema.encodeSync(Mention)(Schema.decodeUnknownSync(Mention)(mention)),
    mention,
  );
});

test('a checkpoint saved with its whole thread keeps counts in place of the transcript and subagents', () => {
  const [whole] = recorded.threads.flatMap(
    (file: { checkpoints?: WholeCheckpoint[] }) => file.checkpoints ?? [],
  );
  assert.ok(whole, 'the recorded threads hold a checkpoint');
  const decoded = Schema.decodeUnknownSync(Checkpoint)(whole);
  assert.equal(decoded.activityCount, whole.thread.activity.length);
  assert.ok(!('activity' in decoded.thread));
  assert.deepEqual(Schema.decodeUnknownSync(Checkpoint)(decoded), decoded);
});

interface WholeCheckpoint {
  thread: {
    activity: unknown[];
    subagents?: unknown[];
    agent?: unknown;
    setup?: unknown;
  };
}

const slim = ({
  thread: { activity, subagents, agent: _agent, setup: _setup, ...thread },
  ...rest
}: WholeCheckpoint) => ({
  ...rest,
  activityCount: activity.length,
  subagentCount: subagents?.length ?? 0,
  thread,
});
