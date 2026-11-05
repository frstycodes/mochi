import { useState, type KeyboardEvent } from 'react';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { Assumption, Thread } from '../model';
import { useDispatch } from '../store';

/**
 * The box's "Assumed" rows. Change, or clicking the sentence, makes the sentence itself editable where it sits, like renaming a
 * file: same type and place, text selected, no field, buttons or hints. Enter or clicking away keeps a real change; Esc, or leaving
 * it as it was, puts it back. Your next message carries what you changed (`withCorrections`).
 */
export function AssumedSection({
  thread,
  assumptions,
  isReadOnly,
}: {
  thread: Thread;
  assumptions: Assumption[];
  isReadOnly?: boolean;
}) {
  const dispatch = useDispatch();
  const [editingId, setEditingId] = useState<string | null>(null);
  if (!assumptions.length) return null;
  const correct = (a: Assumption, correction?: string) =>
    dispatch({
      type: 'assumption-correct',
      threadId: thread.id,
      id: a.id,
      correction,
    });
  return (
    <section aria-label="Assumptions" className="flex flex-col gap-0.5">
      <p className="type-caption text-subtle-foreground">Assumed</p>
      <ul className="flex flex-col">
        {assumptions.map((a) => (
          <li key={a.id}>
            <AssumptionItem
              assumption={a}
              isEditing={editingId === a.id}
              isReadOnly={isReadOnly}
              onEdit={() => setEditingId(a.id)}
              onDone={(text) => {
                setEditingId(null);
                if (text !== undefined) correct(a, text);
              }}
              onUndo={() => correct(a)}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

function AssumptionItem({
  assumption: a,
  isEditing,
  isReadOnly,
  onEdit,
  onDone,
  onUndo,
}: {
  assumption: Assumption;
  isEditing: boolean;
  isReadOnly?: boolean;
  onEdit: () => void;
  /** The new wording when it differs from the agent's, else none: the row goes back as it was. */
  onDone: (text?: string) => void;
  onUndo: () => void;
}) {
  const isChanged = a.state === 'changed';
  const shown = (isChanged && a.correction) || a.text;
  const [draft, setDraft] = useState(shown);
  const commit = () => {
    const text = draft.trim();
    // Back to the agent's own words reopens it (`corrected`).
    onDone(text && text !== shown ? text : undefined);
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      return onDone();
    }
    if (e.key !== 'Enter' || e.shiftKey) return;
    e.preventDefault();
    commit();
  };
  const edit = () => {
    setDraft(shown);
    onEdit();
  };
  return (
    <div className="group/row flex min-h-7 min-w-0 items-start gap-2.5 py-1 type-body">
      <AssumptionDot state={isEditing ? 'changed' : a.state} />
      <div className="flex min-w-0 flex-1">
        {isEditing ? (
          <textarea
            aria-label={`Change the assumption${a.step ? ` on step ${a.step}` : ''}`}
            autoFocus
            onFocus={(e) => e.currentTarget.select()}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKey}
            onBlur={commit}
            rows={1}
            // Same metrics as the sentence it replaces; only a faint fill and the caret say it's editable.
            className="-mx-1 field-sizing-content max-w-[calc(100%+0.5rem)] min-w-16 resize-none rounded-sm bg-foreground/6 px-1 text-foreground outline-none"
          />
        ) : (
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  disabled={isReadOnly}
                  onClick={edit}
                  className={cn(
                    'cursor-text rounded-sm text-left text-pretty [overflow-wrap:anywhere] focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-default',
                    isChanged ? 'text-foreground' : 'text-foreground/85',
                  )}
                />
              }
            >
              {shown}
            </TooltipTrigger>
            {(!!a.step || isChanged) && (
              <TooltipContent className="flex flex-col gap-0.5">
                {!!a.step && (
                  <span>
                    {`Step ${a.step}${a.stepTitle ? ` · ${a.stepTitle}` : ''}`}
                  </span>
                )}
                {isChanged && (
                  <span className="line-through opacity-70">{a.text}</span>
                )}
              </TooltipContent>
            )}
          </Tooltip>
        )}
      </div>
      {!isReadOnly && (
        <Button
          size="xs"
          variant="ghost"
          // Shown on the row's hover or its own focus; the slot stays reserved, so the text never reflows.
          className={cn(
            'shrink-0 text-muted-foreground opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100',
            isEditing && 'invisible',
          )}
          onClick={isChanged ? onUndo : edit}
        >
          {isChanged ? 'Undo' : 'Change'}
        </Button>
      )}
    </div>
  );
}

/** Amber while it waits on you, the text colour once you changed it, muted once accepted. */
export function AssumptionDot({ state }: { state: Assumption['state'] }) {
  return (
    <span className="flex h-5 w-3.5 shrink-0 items-center justify-center">
      <span
        aria-hidden
        className={cn(
          'size-1.5 rounded-full',
          state === 'open' && 'bg-warning',
          state === 'accepted' && 'bg-subtle-foreground',
          state === 'changed' && 'bg-foreground',
        )}
      />
    </span>
  );
}
