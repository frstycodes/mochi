import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'vite-plus/test';
import { copyTranscript, transcriptFolder } from './move.ts';

const SESSION = '03773868-7457-443a-b076-64735ee88874';
const FROM = '/Users/me/.harness/chats/new-12';
const TO = '/Users/me/.mochi/worktrees/app.v2/new-12';

test("a folder's transcripts live under its path with every non-alphanumeric as -", () => {
  assert.equal(
    transcriptFolder('/cfg', TO),
    join('/cfg', 'projects', '-Users-me--mochi-worktrees-app-v2-new-12'),
  );
});

test('the transcript and its subagents are copied under the new folder, and the originals stay', async () => {
  const config = await mkdtemp(join(tmpdir(), 'mochi-claude-move-'));
  const source = transcriptFolder(config, FROM);
  await mkdir(join(source, SESSION, 'subagents'), { recursive: true });
  await writeFile(join(source, `${SESSION}.jsonl`), '{"uuid":"a"}\n');
  await writeFile(join(source, SESSION, 'subagents', 'agent-1.jsonl'), 'x\n');

  assert.equal(await copyTranscript(config, SESSION, TO), true);

  const dest = transcriptFolder(config, TO);
  assert.equal(
    await readFile(join(dest, `${SESSION}.jsonl`), 'utf8'),
    '{"uuid":"a"}\n',
  );
  assert.equal(
    await readFile(join(dest, SESSION, 'subagents', 'agent-1.jsonl'), 'utf8'),
    'x\n',
  );
  assert.equal(
    await readFile(join(source, `${SESSION}.jsonl`), 'utf8'),
    '{"uuid":"a"}\n',
  );
});

test('a session the account has no transcript of copies nothing', async () => {
  const config = await mkdtemp(join(tmpdir(), 'mochi-claude-move-'));
  assert.equal(await copyTranscript(config, SESSION, TO), false);
});
