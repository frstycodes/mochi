import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  PromptInputProvider,
  usePromptInputController,
} from '@/components/ai-elements/prompt-input';
import type { Assumption, Thread } from '../../model';
import { AssumptionList, splitAssumptions } from '../../goals/Assumptions';
import { changeDraft } from '../../goals/ledger';
import { TurnSpine, type SpineNode } from '../../goals/Spine';
import {
  NextMoveActions,
  NextMoveAsk,
  NextMoveCard,
  NextMoveContent,
  NextMoveSummary,
} from '../../goals/NextMove';
import { VizThreadProvider } from '../../viz/WidgetVisual';
import { Block } from '../layout';

/** The report card's Assumptions section, clickable: Accept and Change act on local state, Change also shows its draft. Mock data. */
export function AssumptionsBlock({ rl }: { rl: Thread }) {
  return (
    <Block
      title="Turn spine"
      use="After the summary, before the question: the turn's plan as a rail. The label indexes it (N to check · pivots · decisions). Each step folds to one row saying what it holds; steps with something to check, and pivots, start open. Decisions (dot) and assumptions (amber wash, Accept or Change) hang off their step; a pivot is a rail node with its reason, the steps it dropped forking off below it, dashed. Earlier turns' open assumptions stay under Still open. Second card: a turn with no plan falls back to rows."
      wide
    >
      <VizThreadProvider value={rl.id}>
        <PromptInputProvider>
          <AssumptionsMock rl={rl} />
        </PromptInputProvider>
      </VizThreadProvider>
    </Block>
  );
}

function AssumptionsMock({ rl }: { rl: Thread }) {
  const [assumptions, setAssumptions] = useState(ASSUMPTIONS);
  const { textInput } = usePromptInputController();
  const set = (a: Assumption, state: Assumption['state']) =>
    setAssumptions((all) =>
      all.map((x) => (x.id === a.id ? { ...x, state } : x)),
    );
  const thread: Thread = {
    ...rl,
    assumptions,
    report: { ...REPORT, at: rl.activity.at(-1)?.at ?? 0 },
  };
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Button
          size="xs"
          variant="outline"
          onClick={() => {
            setAssumptions(ASSUMPTIONS);
            textInput.setInput('');
          }}
        >
          Reset
        </Button>
        {!!textInput.value && (
          <span className="min-w-0 truncate type-caption text-muted-foreground">
            {`Message box: ${textInput.value}`}
          </span>
        )}
      </div>
      <NextMoveCard>
        <NextMoveContent>
          <NextMoveSummary>{REPORT.summary}</NextMoveSummary>
          <TurnSpine
            assumptions={assumptions}
            nodes={SPINE}
            onSet={set}
            onChange={(a) => {
              textInput.setInput(changeDraft(a));
              set(a, 'changed');
            }}
          />
          <AssumptionList
            earlier={splitAssumptions(thread).earlier}
            onSet={set}
            onChange={(a) => {
              textInput.setInput(changeDraft(a));
              set(a, 'changed');
            }}
          />
          <NextMoveAsk question={REPORT.question!}>
            <NextMoveActions labels={['Commit', 'Not yet']} onPick={() => {}} />
          </NextMoveAsk>
        </NextMoveContent>
      </NextMoveCard>
      <NextMoveCard>
        <NextMoveContent>
          <NextMoveSummary>
            Renamed the export to match the billing system's column names.
          </NextMoveSummary>
          <AssumptionList
            {...splitAssumptions({
              ...thread,
              assumptions: assumptions.filter(
                (a) => a.id === 'a1' || a.id === 'a5',
              ),
            })}
            onSet={set}
            onChange={(a) => {
              textInput.setInput(changeDraft(a));
              set(a, 'changed');
            }}
          />
        </NextMoveContent>
      </NextMoveCard>
    </div>
  );
}

const SPINE: SpineNode[] = [
  {
    kind: 'step',
    title: 'Read the billing export format',
    status: 'done',
    items: [{ kind: 'assumption', id: 'a1' }],
  },
  {
    kind: 'step',
    title: 'Reproduce the crash on the sample export',
    status: 'done',
  },
  {
    kind: 'pivot',
    dropped: ['Patch the CSV parser'],
    why: 'The crash is in the tokenizer: quoted commas split fields before the parser sees them',
  },
  {
    kind: 'step',
    title: 'Fix quoted fields in the tokenizer',
    status: 'done',
    items: [
      {
        kind: 'decision',
        text: "Kept the tokenizer's public API instead of renaming it, so the two other importers keep working",
      },
      { kind: 'assumption', id: 'a4' },
    ],
  },
  {
    kind: 'step',
    title: 'Write invoice lines',
    status: 'done',
    items: [
      { kind: 'assumption', id: 'a2' },
      { kind: 'assumption', id: 'a3' },
    ],
  },
  { kind: 'step', title: "Backfill last month's exports", status: 'pending' },
];

const REPORT = {
  turn: 4,
  by: 'claude',
  summary:
    'The importer now reads CSV exports from the billing system and writes one row per invoice line, skipping rows with no amount.',
  decisions: ['Parsed with the existing csv helper'],
  left: [],
  question: 'Commit the importer and its tests?',
} satisfies Omit<Thread['report'] & {}, 'at'>;

const ASSUMPTIONS: Assumption[] = [
  {
    id: 'a1',
    turn: 4,
    state: 'open',
    text: 'Assumed invoice timestamps are UTC',
  },
  {
    id: 'a2',
    turn: 4,
    state: 'open',
    text: 'Assumed an empty file imports nothing and succeeds, rather than failing',
  },
  {
    id: 'a3',
    turn: 4,
    state: 'accepted',
    text: 'Assumed amounts are in cents, as in the existing invoices table',
  },
  {
    id: 'a4',
    turn: 4,
    state: 'open',
    text: 'Assumed duplicate invoice numbers within one export are the same invoice reissued, so the later row replaces the earlier one instead of both being kept as two',
  },
  {
    id: 'a5',
    turn: 2,
    state: 'open',
    text: 'Assumed the importer runs nightly from cron, not on upload',
  },
];
