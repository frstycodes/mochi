import { useEffect, useState, type FormEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Archive, ArrowRight, ArrowUpRight, CheckCircle, ClipboardCheck, Clock, CopyStack, MessageQuestion, Send, Settings, ShieldCheck, TaskSquare, type IconComponent } from '@/icons';
import { useContainingToastId } from '@/toast/context';
import { toast } from '@/toast/store';
import { Confirmation, ConfirmationAction, ConfirmationActions, ConfirmationRequest, ConfirmationTitle } from '@/components/ai-elements/confirmation';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { BoundShortcut } from './Shortcut';
import {
  Questionnaire,
  QuestionnaireActions,
  QuestionnaireChoice,
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
import { GitPullRequestIcon } from '@/icons/github';
import { cn } from '@/lib/utils';
import { answerText, isMochiCard, type QueueItem, type QueueKind, type Thread } from './model';
import { duration } from './progress';
import { useReviewEntry } from './review/useReviewMode';
import { snapshot, useHarness, useSpaceQueue, useSpaceThreads, useDispatch } from './store';
import { ProviderMarks, lineColor } from './ui';
import { useShowCard } from './chat/MochiWidget';
import { useSendCiLog } from './notify/useSendCiLog';
import { DeviceIcon } from './remote/DeviceIcon';
import { remoteDecisions } from './remote/mirror';
import { RemoteScope, useMachines } from './remote/useMachines';
import { Seen, useSeen } from './notify/useSeen';
import { isQueueUnread } from './store/seen';
import { UnreadDot } from './ui';
import { isCommand, listenKeydown } from './keymap';

const KIND = {
  approval: { icon: ShieldCheck, label: 'Approval' },
  question: { icon: MessageQuestion, label: 'Question' },
  review: { icon: ClipboardCheck, label: 'Ready for review' },
  ci: { icon: GitPullRequestIcon, label: 'CI failed' },
  collision: { icon: CopyStack, label: 'Same files' },
  run: { icon: Clock, label: 'Scheduled run' },
  setting: { icon: Settings, label: 'Setting' },
} satisfies Record<QueueKind, { icon: IconComponent; label: string }>;

export function QueueView() {
  const items = useSpaceQueue();
  const remote = useMachines().machines.flatMap(({ machine, state }) => (state ? [{ machine, state, items: remoteDecisions(state) }] : [])).filter((m) => m.items.length > 0);
  const isWorking = useSpaceThreads().some((t) => t.status === 'running' && (!t.live || t.live.isWorking));
  const { state } = useHarness();
  const review = useReviewEntry(state.spaceId);
  const [selected, setSelected] = useState(0);
  useSeen({ queueIds: items.map((q) => q.id) }, 'leave');
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
          <span className="hidden items-center gap-1 type-caption text-subtle-foreground md:flex">
            <BoundShortcut command="list-next" />
            <BoundShortcut command="list-previous" />
            move
          </span>
          {review.count > 0 && (
            <Button variant="outline" size="sm" onClick={review.open}>
              <TaskSquare data-icon="inline-start" />
              Review <span className="tabular">{review.count}</span>
            </Button>
          )}
        </div>
        {items.length === 0 && remote.length === 0 && <EmptyQueue isWorking={isWorking} />}
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
        {/* Another computer's agents wait on you too; answering sends it there, and the card leaves when that computer says so. */}
        {remote.map(({ machine, state, items: waiting }) => (
          <section key={machine.id} aria-label={`On ${machine.name}`} className="flex flex-col gap-3">
            <h2 className="flex items-center gap-1.5 type-meta font-medium text-muted-foreground">
              <DeviceIcon kind={machine.kind} className="size-3.5" />
              On {machine.name}
            </h2>
            <RemoteScope machine={machine} state={state}>
              <Seen queueIds={waiting.map((q) => q.id)} when="leave" />
              <ol className="flex flex-col gap-3">
                {waiting.map((item) => (
                  <li key={item.id}>
                    <QueueDecision item={item} showThread />
                  </li>
                ))}
              </ol>
            </RemoteScope>
          </section>
        ))}
      </div>
    </ScrollArea>
  );
}

function useListKeys(count: number, index: number, setSelected: (i: number) => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isCommand(e, 'list-next')) setSelected(Math.min(count - 1, index + 1));
      if (isCommand(e, 'list-previous')) setSelected(Math.max(0, index - 1));
    };
    return listenKeydown(onKey);
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
          <span className={'flex items-center gap-1 font-medium text-foreground'}>
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
        <CardAction className="flex items-center gap-1.5 tabular type-caption text-subtle-foreground">
          {isQueueUnread(item) && <UnreadDot />}
          {age < 1 ? 'just now' : `${duration(age)} ago`}
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {!!item.detail && <p className="type-body text-muted-foreground text-pretty">{item.detail}</p>}
        {isMochiCard(item) && <ShowCard item={item} />}
        {item.kind === 'approval' && !item.tool && <ApprovalRequest item={item} canOpenThread={!!showThread} />}
        {item.kind === 'question' && <QuestionChoices item={item} />}
        {!!item.collision && <SharedFiles files={item.collision.files} />}
      </CardContent>
      {item.kind === 'review' && (
        <CardFooter className="gap-2">
          <ReviewActions item={item} canOpenThread={!!showThread} />
        </CardFooter>
      )}
      {!!item.collision && (
        <CardFooter className="gap-2">
          <CollisionActions item={item} otherId={item.collision.otherThreadId} />
        </CardFooter>
      )}
      {item.kind === 'run' && (
        <CardFooter className="gap-2">
          <RunActions item={item} />
        </CardFooter>
      )}
      {item.kind === 'ci' && (
        <CardFooter className="gap-2">
          <CiActions item={item} />
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
  // Decided inside a toast's widget: the outcome replaces that toast, so the card morphs into it instead of a second toast.
  const toastId = useContainingToastId() ?? undefined;
  return (message: string, run: () => void) => {
    const before = snapshot(state);
    run();
    toast(message, { id: toastId, action: { label: 'Undo', onClick: () => dispatch({ type: 'restore', snapshot: before }) } });
  };
}

/** `canOpenThread`: false inside the thread itself (the composer's tray), where Open thread would go nowhere. */
function ApprovalRequest({ item, canOpenThread }: { item: QueueItem; canOpenThread: boolean }) {
  const dispatch = useDispatch();
  const withUndo = useUndoable();
  return (
    <Confirmation approval={{ id: item.id }} state="approval-requested">
      {/* A described request (a web search) says what it does in the card's title; only raw code needs repeating. */}
      {!!item.code && (
        <ConfirmationTitle className="flex flex-col gap-2">
          <span>The agent wants to run:</span>
          <code className="block overflow-x-auto rounded-md bg-muted px-2.5 py-1.5 font-mono type-caption">{item.code}</code>
        </ConfirmationTitle>
      )}
      <ConfirmationRequest>
        <ConfirmationActions>
          {canOpenThread && (
            <ConfirmationAction variant="outline" onClick={() => dispatch({ type: 'go', view: { kind: 'thread', id: item.threadId } })}>
              Open thread
            </ConfirmationAction>
          )}
          <ConfirmationAction onClick={() => withUndo('Approved', () => dispatch({ type: 'answer', queueId: item.id }))}>Approve and run</ConfirmationAction>
        </ConfirmationActions>
      </ConfirmationRequest>
    </Confirmation>
  );
}

/** Mochi's widgets live in the thread where the agent asked; the Queue lists them and takes you there. */
function ShowCard({ item }: { item: QueueItem }) {
  const show = useShowCard();
  return (
    <div className="flex justify-end">
      <Button size="sm" onClick={() => show(item)}>
        Show in thread
        <ArrowRight data-icon="inline-end" />
      </Button>
    </div>
  );
}

function ReviewActions({ item, canOpenThread }: { item: QueueItem; canOpenThread: boolean }) {
  const dispatch = useDispatch();
  const withUndo = useUndoable();
  return (
    <>
      <Button onClick={() => withUndo('Marked done', () => dispatch({ type: 'answer', queueId: item.id }))}>
        <CheckCircle data-icon="inline-start" />
        Mark done
      </Button>
      {canOpenThread && (
        <Button variant="outline" onClick={() => dispatch({ type: 'go', view: { kind: 'thread', id: item.threadId } })}>
          Open thread
        </Button>
      )}
    </>
  );
}

function SharedFiles({ files }: { files: string[] }) {
  return (
    <p className="type-caption text-subtle-foreground">
      Both edited <code className="rounded-sm bg-muted px-1 font-mono text-muted-foreground">{files.join(', ')}</code>
    </p>
  );
}

/** Never pauses an agent: open the other thread to coordinate, or keep both going. */
function CollisionActions({ item, otherId }: { item: QueueItem; otherId: string }) {
  const { state, dispatch } = useHarness();
  const withUndo = useUndoable();
  const other = state.threads.find((t) => t.id === otherId);
  return (
    <>
      {!!other && <Button onClick={() => dispatch({ type: 'go', view: { kind: 'thread', id: other.id } })}>Open "{other.title}"</Button>}
      <Button variant="outline" onClick={() => withUndo('Kept both', () => dispatch({ type: 'answer', queueId: item.id }))}>
        Keep both
      </Button>
    </>
  );
}

function RunActions({ item }: { item: QueueItem }) {
  const dispatch = useDispatch();
  const withUndo = useUndoable();
  return (
    <>
      <Button onClick={() => dispatch({ type: 'go', view: { kind: 'thread', id: item.threadId } })}>Open thread</Button>
      <Button variant="outline" onClick={() => withUndo('Settled', () => dispatch({ type: 'answer', queueId: item.id }))}>
        <Archive data-icon="inline-start" />
        Settle
      </Button>
    </>
  );
}

function CiActions({ item }: { item: QueueItem }) {
  const sendLog = useSendCiLog(item);
  const withUndo = useUndoable();
  const dispatch = useDispatch();
  const [isSending, setSending] = useState(false);
  const send = async () => {
    setSending(true);
    try {
      await sendLog();
    } catch (error) {
      toast.error("Couldn't fetch the failing log", { description: (error as Error).message });
    } finally {
      setSending(false);
    }
  };
  return (
    <>
      {!!item.ci?.check?.link && (
        <Button onClick={send} disabled={isSending}>
          <Send data-icon="inline-start" />
          {isSending ? 'Fetching log…' : 'Send failing log to agent'}
        </Button>
      )}
      {!!item.ci && (
        <Button variant="outline" onClick={() => window.open(item.ci!.check?.link ?? item.ci!.url, '_blank', 'noopener')}>
          <ArrowUpRight data-icon="inline-start" />
          Open on GitHub
        </Button>
      )}
      <Button variant="outline" onClick={() => withUndo('Settled', () => dispatch({ type: 'answer', queueId: item.id }))}>
        <Archive data-icon="inline-start" />
        Settle
      </Button>
    </>
  );
}

function QuestionChoices({ item }: { item: QueueItem }) {
  const dispatch = useDispatch();
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

function EmptyQueue({ isWorking }: { isWorking: boolean }) {
  return (
    <Empty className="border border-dashed">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <CheckCircle />
        </EmptyMedia>
        <EmptyTitle>Nothing needs you</EmptyTitle>
        <EmptyDescription>{isWorking ? 'Your agents are working. ' : ''}Questions and approvals from your threads show up here, most blocking first.</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
