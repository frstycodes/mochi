import assert from 'node:assert/strict';
import { onTestFinished, test, vi } from 'vite-plus/test';
import { EXIT_MS, getToasts, toast } from './store.ts';

test('toasts stack newest first, repeat into a count, update in place, and leave on dismiss', () => {
  vi.useFakeTimers();
  onTestFinished(() => void vi.useRealTimers());
  toast('Saved');
  toast.error('Push failed', { description: 'rejected' });
  assert.deepEqual(
    getToasts().map((t) => t.title),
    ['Push failed', 'Saved'],
  );

  toast.error('Push failed', { description: 'rejected' });
  assert.equal(getToasts().length, 2, 'an identical toast does not stack a copy');
  assert.equal(getToasts()[0].count, 2);
  assert.equal(getToasts()[0].version, 1, 'the repeat restarts the countdown');

  const id = toast.loading('Pushing');
  assert.equal(getToasts()[0].duration, Infinity);
  toast.success('Pushed', { id });
  const pushed = getToasts().find((t) => t.id === id);
  assert.equal(pushed?.type, 'success');
  assert.equal(pushed?.count, 1, 'an update with new content is not a repeat');
  assert.equal(getToasts().length, 3);

  toast.dismiss(id);
  assert.equal(getToasts().find((t) => t.id === id)?.isLeaving, true, 'stays mounted for the exit');
  toast('Pushed again', { id });
  vi.advanceTimersByTime(EXIT_MS);
  assert.equal(getToasts().find((t) => t.id === id)?.title, 'Pushed again', 'a toast reshown mid-exit survives the old removal');

  toast.dismiss();
  vi.advanceTimersByTime(EXIT_MS);
  assert.equal(getToasts().length, 0);
});

test('a promise toast turns into its outcome', async () => {
  await toast.promise(Promise.resolve(3), { loading: 'Counting', success: (n) => `Counted ${n}`, error: 'Failed' });
  assert.equal(getToasts()[0].title, 'Counted 3');
  await assert.rejects(toast.promise(Promise.reject(new Error('nope')), { loading: 'Counting', success: 'Done', error: (e) => (e as Error).message }));
  assert.equal(getToasts()[0].title, 'nope');
  assert.equal(getToasts()[0].type, 'error');
});
