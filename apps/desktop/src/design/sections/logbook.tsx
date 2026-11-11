import {
  PaneSection,
  PaneSectionHeader,
  PaneSectionTitle,
} from '../../pane/PaneList';
import {
  LOGBOOK_KINDS,
  LOGBOOK_LABELS,
  LogbookRows,
  type Logbook,
} from '../../logbook/LogbookRows';
import { Block } from '../layout';

/** The Logbook's three row kinds on demo data, as the pane tab and the page draw them. */
export function LogbookBlock() {
  return (
    <Block
      title="Logbook"
      use="What a thread is worth coming back for. Answers are questions the agent recorded (record_answer) or replies you saved; decisions and assumptions come from each turn's wrap-up; Later is suggested work that never started. A row opens the thread at the reply it came from. Only answers can be removed."
      wide
    >
      <div className="flex max-w-140 flex-col gap-5">
        {LOGBOOK_KINDS.map((kind) => (
          <PaneSection key={kind}>
            <PaneSectionHeader>
              <PaneSectionTitle count={DEMO[kind].length}>
                {LOGBOOK_LABELS[kind]}
              </PaneSectionTitle>
            </PaneSectionHeader>
            <LogbookRows
              kind={kind}
              log={DEMO}
              now={NOW}
              onOpen={() => {}}
              onRemove={() => {}}
            />
          </PaneSection>
        ))}
      </div>
    </Block>
  );
}

const NOW = 10_000;

const DEMO: Logbook = {
  answers: [
    {
      key: 'a1',
      question: 'Why do sub-threads report instead of messaging their parent?',
      summary:
        'A report carries a status the parent can wait on: done waits until every sub-thread is idle, while blocked or failed wakes it at once. A plain message has no status, so the parent could not tell when to resume.',
      at: NOW - 60 * 26,
      index: 0,
      isSaved: false,
    },
    {
      key: 'a2',
      question:
        'How do I run a single core test without building the whole workspace first, and which runner does the desktop app use for the same thing?',
      summary: 'npx vitest run <path> from packages/core.',
      at: NOW - 3,
      index: 0,
      isSaved: true,
    },
  ],
  decisions: [
    {
      key: 'd1',
      kind: 'decision',
      text: 'Derived the Logbook from the transcript instead of storing a second copy, so a rewind keeps both in step.',
      isCorrected: false,
      at: NOW - 60 * 5,
      index: 0,
    },
    {
      key: 'd2',
      kind: 'assumption',
      text: 'Timestamps are local time',
      isCorrected: true,
      at: NOW - 12,
      index: 0,
    },
  ],
  proposals: [
    {
      key: 'p2',
      title: 'Drop the legacy session table',
      brief: 'Remove sessions_v1 once the backfill has run in production.',
      state: 'expired',
      at: NOW - 60 * 24 * 9,
      index: 0,
    },
    {
      key: 'p3',
      title: 'Add a retry to the flaky upload test',
      brief: 'Wrap the upload assertion in a poll.',
      reason: 'Fixed in this thread instead',
      state: 'dismissed',
      at: NOW - 60 * 24 * 2,
      index: 0,
    },
    {
      key: 'p1',
      title: 'Share the token bucket across workers',
      brief:
        'src/limits/bucket.ts keeps one bucket per process, so 4 workers allow 4× the limit. Move the bucket into Redis behind the same take() signature.',
      state: 'pending',
      at: NOW - 45,
      index: 0,
    },
  ],
};
