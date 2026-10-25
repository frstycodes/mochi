import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import { MAX_DRAFT_BYTES, clearDraft, flushDrafts, getDraft, loadDrafts, newThreadDraftKey, saveDraft, threadDraftKey, type Draft, type DraftStore } from './drafts.ts';

function memoryStore(initial: [string, Draft][] = []) {
  const disk = new Map(initial);
  const store: DraftStore = {
    getAll: async () => [...disk],
    put: async (key, draft) => void disk.set(key, draft),
    delete: async (key) => void disk.delete(key),
  };
  return { disk, store };
}

const image = (bytes: number) => ({ filename: 'shot.png', mediaType: 'image/png', blob: new Blob([new Uint8Array(bytes)]) });

test('a draft is saved, restored after a relaunch, and cleared when sent', async () => {
  const first = memoryStore();
  await loadDrafts(first.store);
  const key = threadDraftKey('t1');
  saveDraft(key, { text: 'fix /review the login', files: [image(10)], extra: { mentions: [{ kind: 'thread', id: 't2', title: 'Auth' }] } });
  assert.equal(getDraft(key)?.text, 'fix /review the login', 'memory has it at once, for switching threads');
  assert.equal(first.disk.size, 0, 'the write is debounced');
  flushDrafts();
  await Promise.resolve();
  assert.equal(first.disk.get(key)?.files[0].blob.size, 10);

  const relaunch = memoryStore([...first.disk]);
  await loadDrafts(relaunch.store);
  assert.deepEqual(getDraft(key)?.extra, { mentions: [{ kind: 'thread', id: 't2', title: 'Auth' }] });

  clearDraft(key);
  assert.equal(getDraft(key), undefined);
  flushDrafts();
  await Promise.resolve();
  assert.equal(relaunch.disk.has(key), false, 'sending removes it from disk');
});

test('an emptied composer drops its draft, attachments past the cap are not kept, deleted threads lose theirs', async () => {
  const { disk, store } = memoryStore();
  await loadDrafts(store);
  const key = newThreadDraftKey('work');
  saveDraft(key, { text: 'hi', files: [] });
  saveDraft(key, { text: '', files: [] });
  assert.equal(getDraft(key), undefined);

  saveDraft(key, { text: 'two shots', files: [image(MAX_DRAFT_BYTES - 5), image(10)] });
  assert.equal(getDraft(key)?.files.length, 1);

  saveDraft(threadDraftKey('gone'), { text: 'x', files: [] });
  saveDraft(threadDraftKey('kept'), { text: 'y', files: [] });
  clearDraft(threadDraftKey('gone'));
  flushDrafts();
  await Promise.resolve();
  assert.deepEqual([...disk.keys()].sort(), [key, threadDraftKey('kept')].sort());
});
