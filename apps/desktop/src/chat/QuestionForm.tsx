import { useState, type KeyboardEvent } from 'react';
import { ChevronLeft, ChevronRight } from '@/icons';
import { Button } from '@/components/ui/button';
import { CheckboxMark } from '@/components/ui/checkbox';
import { RadioMark } from '@/components/ui/radio-group';
import { cn } from '@/lib/utils';
import type { AgentQuestion } from '../host/types/agent';
import { IS_MAC } from '../keys';
import { Shortcut } from '../Shortcut';
import {
  clearAt,
  finalAnswers,
  isAnswered,
  pick,
  stepAfter,
} from './questionAnswers';

/**
 * The agent's questions, one at a time: the question, its options as compact rows, "Other" typed in place. The pager sits at
 * the bottom left so its arrows never move as you page; Skip and Next sit on the right. Skip moves on without answering (the
 * last one sends), Next needs an answer. Number keys pick and ⌘↵ goes forward while focus is inside.
 */
export function QuestionForm({
  questions,
  hideTitle,
  isNested,
  onSend,
}: {
  questions: AgentQuestion[];
  /** Inside a card that has its own border (the Queue): no frame of its own, each option a box of its own. */
  isNested?: boolean;
  /** One question whose text the surrounding card already shows as its title. */
  hideTitle?: boolean;
  onSend: (answers: string[][]) => void;
}) {
  const [at, setAt] = useState(0);
  const [answers, setAnswers] = useState<string[][]>(() =>
    questions.map(() => []),
  );
  const [other, setOther] = useState<string[]>(() => questions.map(() => ''));
  const [isTyping, setTyping] = useState(false);
  const q = questions[at];
  const isLast = at === questions.length - 1;
  const isPaged = questions.length > 1;
  const canNext = isAnswered(answers, other, at);

  const move = (isSkip: boolean) => {
    const picked = isSkip ? clearAt(answers, at, []) : answers;
    const typed = isSkip ? clearAt(other, at, '') : other;
    const step = stepAfter(at, questions.length);
    if (step === 'send') return onSend(finalAnswers(picked, typed));
    setAnswers(picked);
    setOther(typed);
    setTyping(false);
    setAt(step);
  };
  const choose = (option: string) => {
    setAnswers((was) => pick(was, at, option, q.multiSelect));
    // A single choice and typed text are one answer: picking clears what was typed.
    if (!q.multiSelect) setOther((o) => o.map((x, i) => (i === at ? '' : x)));
  };
  const onKeyDown = (e: KeyboardEvent<HTMLFormElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      if (canNext) move(false);
      return;
    }
    if (isTyping) return;
    const n = Number(e.key);
    if (n >= 1 && n <= q.options.length) choose(q.options[n - 1]);
  };

  return (
    <form
      onKeyDown={onKeyDown}
      onSubmit={(e) => {
        e.preventDefault();
        if (canNext) move(false);
      }}
      // In the chat: divided sections in one frame, like Claude's, the question on a muted strip and hairline dividers
      // between (dividers, not a fill showing through gaps: the border colour is translucent, so a fill under the outer
      // border draws it twice as strong). In a card: the card is the frame, so the question is plain text and each option
      // is its own box.
      className={cn(
        'group/form flex flex-col',
        isNested ? 'gap-3' : 'divide-y overflow-hidden rounded-xl border',
      )}
    >
      {(isPaged || !hideTitle) && (
        <p
          className={cn(
            'type-body font-medium text-pretty [overflow-wrap:anywhere]',
            !isNested && 'bg-muted px-4 py-3.5',
          )}
        >
          {q.text}
        </p>
      )}
      <ul
        aria-label={q.multiSelect ? 'Pick any that apply' : 'Pick one'}
        // In the chat, one divided list in the frame; in the Queue's card, each option is its own box, a picked one firmer.
        className={cn(
          'flex flex-col',
          isNested
            ? 'gap-1.5 [&>li]:rounded-lg [&>li]:border [&>li:has([aria-checked=true])]:border-foreground/25 [&>li:has([aria-checked=true])]:bg-accent/40'
            : 'divide-y',
        )}
      >
        {q.options.map((option, i) => (
          <li key={option}>
            <OptionRow
              isChecked={answers[at].includes(option)}
              isMulti={q.multiSelect}
              shortcut={i + 1}
              description={q.descriptions?.[i]}
              preview={q.previews?.[i]}
              onPick={() => choose(option)}
            >
              {option}
            </OptionRow>
          </li>
        ))}
        <li>
          <OtherRow
            value={other[at]}
            isTyping={isTyping}
            isMulti={q.multiSelect}
            onStart={() => setTyping(true)}
            onChange={(v) => {
              setOther((o) => o.map((x, i) => (i === at ? v : x)));
              if (!q.multiSelect && v.trim())
                setAnswers((a) => a.map((x, i) => (i === at ? [] : x)));
            }}
            onDone={() => setTyping(false)}
          />
        </li>
      </ul>
      <div className={cn('flex items-center gap-2', !isNested && 'px-4 py-3')}>
        {isPaged && (
          <Pager
            at={at}
            total={questions.length}
            onAt={(i) => (setTyping(false), setAt(i))}
          />
        )}
        <div className="ms-auto flex items-center gap-1.5">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="type-meta"
            onClick={() => move(true)}
          >
            Skip
          </Button>
          <Button
            type="submit"
            size="sm"
            className="type-meta"
            disabled={!canNext}
            aria-keyshortcuts={IS_MAC ? 'Meta+Enter' : 'Control+Enter'}
          >
            {isLast ? (isPaged ? 'Send answers' : 'Send answer') : 'Next'}
            <span aria-hidden className="contents">
              <Shortcut
                keys={['mod', 'Enter']}
                className="ml-0.5 opacity-70 [&_[data-slot=kbd]]:bg-primary-foreground/15 [&_[data-slot=kbd]]:text-primary-foreground"
              />
            </span>
          </Button>
        </div>
      </div>
    </form>
  );
}

// A section, not a floating row: no fill on hover (it would run into the frame); the mark shows the pick.
const ROW =
  'flex min-h-12 w-full cursor-default items-center gap-3 px-4 py-3.5 text-left type-body text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2';

/** An option: its label, the agent's line about it under that, and once picked, its preview (a mockup or code). */
function OptionRow({
  isChecked,
  isMulti,
  shortcut,
  description,
  preview,
  onPick,
  children,
}: {
  isChecked: boolean;
  isMulti: boolean;
  shortcut: number;
  description?: string;
  preview?: string;
  onPick: () => void;
  children: string;
}) {
  const Mark = isMulti ? CheckboxMark : RadioMark;
  return (
    <div className="flex flex-col">
      <button
        type="button"
        role={isMulti ? 'checkbox' : 'radio'}
        aria-checked={isChecked}
        onClick={onPick}
        className={cn(ROW, 'items-start')}
      >
        {/* On the label's first line, however many lines follow. */}
        <span className="flex h-5 shrink-0 items-center">
          <Mark checked={isChecked} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-pretty [overflow-wrap:anywhere]">
            {children}
          </span>
          {!!description && (
            <span className="type-meta text-pretty text-muted-foreground [overflow-wrap:anywhere]">
              {description}
            </span>
          )}
        </span>
        {/* Number keys only work with focus inside the form, so their hint only shows then. */}
        <kbd className="hidden size-5 shrink-0 items-center justify-center rounded-md border font-sans text-[0.625rem] text-muted-foreground group-focus-within/form:inline-flex">
          {shortcut}
        </kbd>
      </button>
      {/* Outside the button: a preview is a block of code, not part of the label. Lined up with the label. */}
      {isChecked && !!preview && (
        <pre className="mx-4 mb-3.5 ms-[2.75rem] overflow-x-auto rounded-md border bg-muted/40 px-2.5 py-2 font-mono type-caption leading-5 text-foreground/85">
          {preview}
        </pre>
      )}
    </div>
  );
}

/** "Other": typed in place, like a rename. Enter or clicking away keeps it; Esc clears it. */
function OtherRow({
  value,
  isTyping,
  isMulti,
  onStart,
  onChange,
  onDone,
}: {
  value: string;
  isTyping: boolean;
  isMulti: boolean;
  onStart: () => void;
  onChange: (v: string) => void;
  onDone: () => void;
}) {
  const hasText = !!value.trim();
  const Mark = isMulti ? CheckboxMark : RadioMark;
  if (isTyping)
    return (
      <div className={cn(ROW, 'cursor-text')}>
        <Mark checked={hasText} className="shrink-0" />
        <input
          aria-label="Your own answer"
          autoFocus
          value={value}
          placeholder="Type your answer"
          onChange={(e) => onChange(e.target.value)}
          onBlur={onDone}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              onChange('');
              onDone();
            }
            if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) {
              e.preventDefault();
              onDone();
            }
          }}
          className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
        />
      </div>
    );
  return (
    <button
      type="button"
      onClick={onStart}
      className={cn(ROW, 'cursor-text', !hasText && 'text-muted-foreground')}
    >
      <Mark checked={hasText} className="shrink-0" />
      <span className="min-w-0 flex-1 truncate">
        {hasText ? value : 'Other'}
      </span>
    </button>
  );
}

/** Bottom left, so the arrows stay put while you page. */
function Pager({
  at,
  total,
  onAt,
}: {
  at: number;
  total: number;
  onAt: (i: number) => void;
}) {
  return (
    <div className="flex items-center gap-0.5 type-meta text-muted-foreground">
      <Button
        type="button"
        size="icon-xs"
        variant="ghost"
        aria-label="Previous question"
        disabled={at === 0}
        onClick={() => onAt(at - 1)}
      >
        <ChevronLeft />
      </Button>
      <span className="min-w-[6ch] text-center tabular-nums">{`${at + 1} of ${total}`}</span>
      <Button
        type="button"
        size="icon-xs"
        variant="ghost"
        aria-label="Next question"
        disabled={at === total - 1}
        onClick={() => onAt(at + 1)}
      >
        <ChevronRight />
      </Button>
    </div>
  );
}
