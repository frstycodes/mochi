import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import { moveSubThreadNotes } from './migrations.ts';

test("5_sub_thread_reports moves sub-thread notes into the transcript and keeps Codex's", () => {
  const thread = {
    activity: [{ at: 1, who: 'you', kind: 'message', text: 'split it' }],
    live: {
      isWorking: false,
      notes: [
        'Keep the pins.',
        '[Sub-thread "Piece (A)" (new-2) reported: blocked]\nNeed the key.',
        '[Sub-thread "Piece B" (new-3) ended a turn: done]',
        '[Sub-thread "Piece B" (new-3) PR #12: merged]',
        '[Reply from thread "Elsewhere" (new-4) ended a turn: done]\nThe limits table.',
      ],
    },
  };
  const moved = moveSubThreadNotes(thread, 9)!;
  assert.deepEqual(moved.live, { isWorking: false, notes: ['Keep the pins.'] });
  assert.deepEqual(
    moved.activity
      .slice(1)
      .map((e) => [
        (e as { text: string }).text,
        (e as { subReport: unknown }).subReport,
      ]),
    [
      [
        'Need the key.',
        {
          threadId: 'new-2',
          title: 'Piece (A)',
          status: 'blocked',
          isUrgent: true,
        },
      ],
      ['', { threadId: 'new-3', title: 'Piece B', status: 'done' }],
      ['', { threadId: 'new-3', title: 'Piece B', status: 'PR #12: merged' }],
      [
        'The limits table.',
        {
          threadId: 'new-4',
          title: 'Elsewhere',
          status: 'done',
          isReply: true,
        },
      ],
    ],
  );
  assert.equal(
    moveSubThreadNotes({ live: { notes: ['Keep the pins.'] } }, 9),
    undefined,
  );
  assert.equal(moveSubThreadNotes({}, 9), undefined);
});
