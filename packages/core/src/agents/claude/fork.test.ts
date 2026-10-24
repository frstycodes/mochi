import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'vite-plus/test';
import { forkPoint, takeForkAt, transcriptUuids } from './fork.ts';

// A real Claude Code 2.1.296 transcript: `aaaaaaaa…` was yielded, then interrupted before Claude Code read it, so only its
// queue entry was written; `bbbbbbbb…`, yielded mid-turn, was written once the interrupt ended the turn.
const SESSION = '03773868-7457-443a-b076-64735ee88874';
const UNWRITTEN = 'aaaaaaaa-0000-4000-8000-000000000001';
const WRITTEN = 'bbbbbbbb-0000-4000-8000-000000000002';
const EARLIER = 'ca8de70a-dbfd-4708-8e17-b115a2ce8ccb';
// The forkAt of the user's report: never in the transcript.
const STALE = 'a6962bb2-8bf0-4def-9ddb-7757556ab5df';

async function configDir() {
  const dir = await mkdtemp(join(tmpdir(), 'mochi-claude-config-'));
  await mkdir(join(dir, 'projects', '-tmp-proj'), { recursive: true });
  await copyFile(new URL('./fixtures/interrupted.jsonl', import.meta.url), join(dir, 'projects', '-tmp-proj', `${SESSION}.jsonl`));
  return dir;
}

test("the transcript's entries are what resumeSessionAt can name; a message interrupted before Claude Code read it is not one", async () => {
  const uuids = await transcriptUuids(await configDir(), SESSION);
  assert.ok(uuids.has(WRITTEN) && uuids.has(EARLIER));
  assert.equal(uuids.has(UNWRITTEN), false);
  assert.equal((await transcriptUuids(await configDir(), 'no-such-session')).size, 0);
});

test('the rewind point steps back over our own unwritten messages, and is null when nothing before is in the transcript', async () => {
  const uuids = await transcriptUuids(await configDir(), SESSION);
  const sent = [
    { uuid: UNWRITTEN, after: EARLIER },
    { uuid: 'dropped', after: UNWRITTEN },
  ];
  assert.equal(forkPoint(sent, 1, uuids), EARLIER, 'the unwritten message never reached the agent, so forking before it drops nothing it saw');
  assert.equal(forkPoint([{ uuid: WRITTEN, after: EARLIER }, { uuid: 'dropped', after: WRITTEN }], 1, uuids), WRITTEN);
  assert.equal(forkPoint([{ uuid: 'dropped', after: STALE }], 0, uuids), null, 'an unknown entry that is not ours: start fresh with the transcript');
  assert.equal(forkPoint([{ uuid: 'dropped', after: null }], 0, uuids), null);
});

test('rewind → stop → send → send: the fork is made by the first launch only, so a refused fork is never replayed', async () => {
  const session = { options: { resume: SESSION, forkAt: WRITTEN }, sessionId: SESSION, account: { configDir: await configDir() } };
  assert.deepEqual(await takeForkAt(session), { forkAt: WRITTEN });
  // The fork failed before init, so the session id is unchanged: the next send's relaunch resumes the whole session.
  assert.equal(session.options.forkAt, undefined);
  assert.deepEqual(await takeForkAt(session), {});
});

test("a forkAt the session doesn't have (the reported a6962bb2…) is dropped before Claude Code sees it, once", async () => {
  const session = { options: { resume: SESSION, forkAt: STALE }, sessionId: SESSION, account: { configDir: await configDir() } };
  assert.deepEqual(await takeForkAt(session), { isMissing: true });
  assert.deepEqual(await takeForkAt(session), {});
});

test('lost process → send: a relaunch on the fork it already made resumes the fork, never forks again', async () => {
  const session = { options: { resume: SESSION, forkAt: WRITTEN }, sessionId: 'the-fork-id', account: { configDir: await configDir() } };
  assert.deepEqual(await takeForkAt(session), {});
  assert.equal(session.options.forkAt, undefined);
});
