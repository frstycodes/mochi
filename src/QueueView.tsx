import { useEffect, useState, type FormEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { BranchDown, BranchUp, CheckCircle, MessageQuestion, Setting2, ShieldCheck, TaskSquare, type IconComponent } from 'reicon-react';
import { toast } from 'sonner';
import { Confirmation, ConfirmationAction, ConfirmationActions, ConfirmationRequest, ConfirmationTitle } from '@/components/ai-elements/confirmation';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldLabel } from '@/components/ui/field';
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Kbd, KbdGroup } from '@/components/ui/kbd';
import {
  Questionnaire,
  QuestionnaireActions,
  QuestionnaireChoice,
  QuestionnaireChoiceDescription,
  QuestionnaireChoices,
  QuestionnaireDescription,
  QuestionnaireError,
  QuestionnaireInput,
  QuestionnaireItem,
  QuestionnaireNext,
  QuestionnairePrevious,
  QuestionnaireProgress,
  QuestionnaireSubmit,
  QuestionnaireTitle,
} from '@/components/ui/questionnaire';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { answerText, type QueueItem, type QueueKind, type Thread } from './model';
import { duration } from './progress';
import { useReviewEntry } from './review/useReviewMode';
import { snapshot, useHarness, useSpaceQueue, useSpaceThreads, type OverlapMode } from './store';
import { ProviderMarks, lineColor } from './ui';
import { decideTool } from './runtime/tools';
import { InlineSetting } from './settings/InlineSetting';

const KIND = {
  approval: { icon: ShieldCheck, label: 'Approval' },
  question: { icon: MessageQuestion, label: 'Question' },
  review: { icon: BranchUp, label: 'Review' },
  ci: { icon: BranchUp, label: 'CI failed' },
  overlap: { icon: BranchDown, label: 'Overlap' },
  setting: { icon: Setting2, label: 'Setting' },
} satisfies Record<QueueKind, { icon: IconComponent; label: string }>;

export function QueueView() {
  const items = useSpaceQueue();
  const isWorking = useSpaceThreads().some((t) => t.status === 'running' && (!t.live || t.live.isWorking));
  const { state } = useHarness();
  const review = useReviewEntry(state.spaceId);
  const [selected, setSelected] = useState(0);
  const index = Math.min(selected, Math.max(0, items.length - 1));
  useListKeys(items.length, index, setSelected);

  return (
    <ScrollArea className="h-full">
      <div className="mx-auto flex max-w-[720px] flex-col gap-5 px-4 pt-6 pb-16 md:px-6 md:pt-10">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="type-heading">Queue</h1>
            <p className="type-meta text-muted-foreground">Decisions your agents are waiting on, most blocking first.</p>
          </div>
          <KbdGroup className="hidden type-caption text-subtle-foreground md:flex">
            <Kbd>J</Kbd>
            <Kbd>K</Kbd>
            move
          </KbdGroup>
          {review.count > 0 && (
            <Button variant="outline" size="sm" onClick={review.open}>
              <TaskSquare data-icon="inline-start" />
              Review <span className="tabular">{review.count}</span>
            </Button>
          )}
        </div>
        {items.length === 0 && <EmptyQueue isWorking={isWorking} />}
        <ol className="flex flex-col gap-3">
          <AnimatePresence initial={false}>
            {items.map((item, i) => (
              <motion.li
                key={item.id}
                layout="position"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: 24, transition: { duration: 0.15 } }}
                transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
                onPointerDown={() => setSelected(i)}
              >
                <QueueDecision item={item} isSelected={i === index} showThread />
              </motion.li>
            ))}
          </AnimatePresence>
        </ol>
      </div>
    </ScrollArea>
  );
}

function useListKeys(count: number, index: number, setSelected: (i: number) => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && e.target.closest('input, textarea')) return;
      if (e.key === 'j') setSelected(Math.min(count - 1, index + 1));
      if (e.key === 'k') setSelected(Math.max(0, index - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [count, index, setSelected]);
}

export function QueueDecision({ item, isSelected, showThread, className }: { item: QueueItem; isSelected?: boolean; showThread?: boolean; className?: string }) {
  const { state, dispatch } = useHarness();
  const thread = state.threads.find((t) => t.id === item.threadId)!;
  const { icon: Icon, label } = KIND[item.kind];
  const age = state.now - item.createdAt;

  return (
    <Card size="sm" className={cn(isSelected && 'ring-ring', className)}>
      <CardHeader>
        <CardDescription className="flex flex-wrap items-center gap-x-2 gap-y-1 type-caption">
          <span className={cn('flex items-center gap-1 font-medium', item.kind === 'overlap' ? 'text-warning' : 'text-foreground')}>
            <Icon className="size-3.5" />
            {label}
          </span>
          {showThread && <ThreadLink thread={thread} onOpen={() => dispatch({ type: 'go', view: { kind: 'thread', id: thread.id } })} />}
          {item.blocks.steps > 0 && (
            <span className="tabular">
              Blocks {item.blocks.steps} {item.blocks.steps === 1 ? 'step' : 'steps'}
              {item.blocks.threads > 1 && ` in ${item.blocks.threads} threads`}
            </span>
          )}
        </CardDescription>
        <CardTitle>{item.title}</CardTitle>
        <CardAction className="tabular type-caption text-subtle-foreground">{age < 1 ? 'just now' : `${duration(age)} ago`}</CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {!!item.detail && <p className="type-body text-muted-foreground text-pretty">{item.detail}</p>}
        {item.kind === 'approval' && (item.tool ? <ToolApproval item={item} tool={item.tool} /> : <ApprovalRequest item={item} />)}
        {!!item.setting && <SettingCard item={item} setting={item.setting} />}
        {item.kind === 'question' && <QuestionChoices item={item} />}
        {item.kind === 'overlap' && <OverlapChoices item={item} />}
      </CardContent>
      {item.kind === 'review' && (
        <CardFooter className="gap-2">
          <ReviewActions item={item} />
        </CardFooter>
      )}
    </Card>
  );
}

function ThreadLink({ thread, onOpen }: { thread: Thread; onOpen: () => void }) {
  return (
    <Button variant="ghost" size="xs" onClick={onOpen} className="min-w-0 text-muted-foreground">
      <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: lineColor(thread.line) }} />
      <span className="truncate">{thread.title}</span>
      <ProviderMarks providers={thread.providers} size={12} />
    </Button>
  );
}

export function useUndoable() {
  const { state, dispatch } = useHarness();
  return (message: string, run: () => void) => {
    const before = snapshot(state);
    run();
    toast(message, { action: { label: 'Undo', onClick: () => dispatch({ type: 'restore', snapshot: before }) } });
  };
}

function ApprovalRequest({ item }: { item: QueueItem }) {
  const { dispatch } = useHarness();
  const withUndo = useUndoable();
  return (
    <Confirmation approval={{ id: item.id }} state="approval-requested">
      <ConfirmationTitle className="flex flex-col gap-2">
        <span>The agent wants to run:</span>
        {!!item.code && <code className="block overflow-x-auto rounded-md bg-muted px-2.5 py-1.5 font-mono type-caption">{item.code}</code>}
      </ConfirmationTitle>
      <ConfirmationRequest>
        <ConfirmationActions>
          <ConfirmationAction variant="outline" onClick={() => dispatch({ type: 'go', view: { kind: 'thread', id: item.threadId } })}>
            Open thread
          </ConfirmationAction>
          <ConfirmationAction onClick={() => withUndo('Approved', () => dispatch({ type: 'answer', queueId: item.id }))}>Approve and run</ConfirmationAction>
        </ConfirmationActions>
      </ConfirmationRequest>
    </Confirmation>
  );
}

/** A consequential Mochi tool call: nothing runs until Approve; options are checkboxes, off unless you tick them. */
function ToolApproval({ item, tool }: { item: QueueItem; tool: NonNullable<QueueItem['tool']> }) {
  const [options, setOptions] = useState<string[]>([]);
  const toggle = (id: string, on: boolean) => setOptions((o) => (on ? [...o, id] : o.filter((x) => x !== id)));
  return (
    <div className="flex flex-col gap-3">
      {!!item.code && <pre className="max-h-48 overflow-auto rounded-md bg-muted px-2.5 py-1.5 font-mono type-caption whitespace-pre-wrap">{item.code}</pre>}
      {tool.options?.map((o) => (
        <Field key={o.id} orientation="horizontal">
          <Checkbox id={`${item.id}-${o.id}`} checked={options.includes(o.id)} onCheckedChange={(on) => toggle(o.id, on === true)} />
          <FieldLabel htmlFor={`${item.id}-${o.id}`} className="font-normal">
            {o.label}
          </FieldLabel>
        </Field>
      ))}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" size="sm" onClick={() => decideTool(tool.callId, { isApproved: false })}>
          Deny
        </Button>
        <Button size="sm" onClick={() => decideTool(tool.callId, { isApproved: true, options })}>
          Approve
        </Button>
      </div>
    </div>
  );
}

function SettingCard({ item, setting }: { item: QueueItem; setting: NonNullable<QueueItem['setting']> }) {
  const { dispatch } = useHarness();
  return (
    <InlineSetting id={setting.id} suggested={setting.suggested}>
      <Button variant="outline" size="sm" onClick={() => dispatch({ type: 'queue-dismiss', queueId: item.id })}>
        Done
      </Button>
    </InlineSetting>
  );
}

function ReviewActions({ item }: { item: QueueItem }) {
  const { dispatch } = useHarness();
  const withUndo = useUndoable();
  return (
    <>
      <Button onClick={() => withUndo('Merged', () => dispatch({ type: 'answer', queueId: item.id }))}>
        <CheckCircle data-icon="inline-start" />
        Approve and merge
      </Button>
      <Button variant="outline" onClick={() => dispatch({ type: 'go', view: { kind: 'thread', id: item.threadId } })}>
        Open thread
      </Button>
    </>
  );
}

function choiceFrom(e: FormEvent<HTMLFormElement>) {
  e.preventDefault();
  return new FormData(e.currentTarget).get('choice')?.toString();
}

function QuestionChoices({ item }: { item: QueueItem }) {
  const { dispatch } = useHarness();
  const withUndo = useUndoable();
  const questions = item.questions ?? [];
  const isWizard = questions.length > 1;
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const answers = answersFrom(new FormData(e.currentTarget), questions.length);
    withUndo(`Answered: ${answerText(answers)}`, () => dispatch({ type: 'answer', queueId: item.id, answers }));
  };
  return (
    <Questionnaire items={questions.map((q, i) => ({ name: `q${i}`, required: true, choices: q.options.map((value) => ({ value })) }))} shortcuts="numbers" onSubmit={submit}>
      {isWizard && <QuestionnaireProgress />}
      {questions.map((q, i) => (
        <QuestionnaireItem key={i} name={`q${i}`} multiple={q.multiSelect} required className="gap-3">
          {isWizard && <QuestionnaireTitle className="mb-1 text-sm [&:not(:has(~[data-slot=questionnaire-description]))]:mb-3">{q.text}</QuestionnaireTitle>}
          {q.multiSelect && <QuestionnaireDescription className="type-meta">Pick any that apply.</QuestionnaireDescription>}
          <QuestionnaireChoices>
            {q.options.map((label) => (
              <QuestionnaireChoice key={label} value={label}>
                {label}
              </QuestionnaireChoice>
            ))}
          </QuestionnaireChoices>
          <QuestionnaireInput aria-label="Your own answer" placeholder={q.options.length ? 'Or type your own answer' : 'Type your answer'} />
          <QuestionnaireError className="mt-0 type-meta">Pick an answer or type your own.</QuestionnaireError>
        </QuestionnaireItem>
      ))}
      <QuestionnaireActions>
        <QuestionnairePrevious size="sm" />
        <QuestionnaireNext size="sm" />
        <QuestionnaireSubmit size="sm">{isWizard ? 'Send answers' : 'Send answer'}</QuestionnaireSubmit>
      </QuestionnaireActions>
    </Questionnaire>
  );
}

/** Each question's checked labels plus its typed answer; the typed one only counts once selected, which the questionnaire tracks by naming its input. */
function answersFrom(form: FormData, count: number) {
  return Array.from({ length: count }, (_, i) => [...new Set(form.getAll(`q${i}`).map((v) => v.toString().trim()).filter(Boolean))]);
}

const OVERLAP_CHOICES = [
  { mode: 'link', title: 'Link', body: 'Claude keeps building it. This thread waits for that step and carries on with its other steps.', toast: 'Linked. The Redis client arrives here when it lands.' },
  { mode: 'extract', title: 'Extract', body: 'Move it into its own small thread with a fresh agent. Both threads depend on it.', toast: 'Extracted into "Redis client (shared)". Claude\'s progress carried over.' },
  { mode: 'race', title: 'Race', body: 'Both build it. The first to finish wins, the other is dropped as superseded.', toast: 'Racing. The loser is dropped automatically.' },
  { mode: 'related', title: 'Keep both', body: 'They are different enough. Mark them related and let merge rehearsal watch the shared file.', toast: 'Marked related. Both keep their own step.' },
] satisfies { mode: OverlapMode; title: string; body: string; toast: string }[];

function OverlapChoices({ item }: { item: QueueItem }) {
  const { dispatch } = useHarness();
  const withUndo = useUndoable();
  const submit = (e: FormEvent<HTMLFormElement>) => {
    const picked = OVERLAP_CHOICES.find((c) => c.mode === choiceFrom(e));
    if (!picked) return;
    withUndo(picked.toast, () => dispatch({ type: 'overlap', queueId: item.id, mode: picked.mode }));
  };
  return (
    <Questionnaire
      items={[{ name: 'choice', required: true, choices: OVERLAP_CHOICES.map((c) => ({ value: c.mode })) }]}
      defaultItem="choice"
      shortcuts="numbers"
      onSubmit={submit}
    >
      <QuestionnaireItem name="choice" required>
        {!!item.overlap && (
          <p className="type-caption text-subtle-foreground">
            Both touch <code className="rounded-sm bg-muted px-1 font-mono text-muted-foreground">{item.overlap.sharedFiles.join(', ')}</code>
          </p>
        )}
        <QuestionnaireChoices>
          {OVERLAP_CHOICES.map((c, i) => (
            <QuestionnaireChoice key={c.mode} value={c.mode}>
              <span className="font-medium">
                {c.title}
                {i === 0 && <span className="ml-2 type-caption font-normal text-subtle-foreground">Suggested</span>}
              </span>
              <QuestionnaireChoiceDescription>{c.body}</QuestionnaireChoiceDescription>
            </QuestionnaireChoice>
          ))}
        </QuestionnaireChoices>
      </QuestionnaireItem>
      <QuestionnaireActions>
        <QuestionnaireSubmit size="sm">Apply</QuestionnaireSubmit>
      </QuestionnaireActions>
    </Questionnaire>
  );
}

function EmptyQueue({ isWorking }: { isWorking: boolean }) {
  return (
    <Empty className="border border-dashed">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <CheckCircle />
        </EmptyMedia>
        <EmptyTitle>Nothing needs you</EmptyTitle>
        <EmptyDescription>{isWorking ? 'Your agents are working. ' : ''}Questions, approvals and overlaps from your threads show up here, most blocking first.</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
