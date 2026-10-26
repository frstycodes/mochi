import { useState, type FormEvent } from 'react';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { Trash } from '@/icons';
import { toast } from '@/toast/store';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { host } from '../host';
import type { Trigger } from '../host/types/schedule';
import { firstPrompt, type Thread } from '../model';
import { useHarness } from '../store';
import { triggerInput } from './calls';
import { describeTrigger } from './describe';
import { DEFAULT_FORM, fromWhen, toWhen } from './form';
import { ScheduleFields } from './ScheduleFields';
import { useTrigger } from './useSchedules';

const openStore = createStore<{ threadId: string | null }>(() => ({
  threadId: null,
}));

/** Opens the schedule editor for a thread (thread menu, Settings › Schedules); null closes it. */
export function openSchedule(threadId: string | null) {
  openStore.setState({ threadId });
}

/** Mounted once at the app root. */
export function ScheduleLayer() {
  const threadId = useStore(openStore, (s) => s.threadId);
  const { state } = useHarness();
  const thread = state.threads.find((t) => t.id === threadId);
  const trigger = useTrigger(threadId ?? '');
  if (!thread) return null;
  // Keyed: reopening for another thread starts from that thread's trigger.
  return (
    <ScheduleDialog
      key={thread.id}
      thread={thread}
      trigger={trigger}
      onClose={() => openSchedule(null)}
    />
  );
}

function ScheduleDialog({
  thread,
  trigger,
  onClose,
}: {
  thread: Thread;
  trigger: Trigger | undefined;
  onClose: () => void;
}) {
  const [form, setForm] = useState(() =>
    trigger ? fromWhen(trigger.when, trigger.missed) : DEFAULT_FORM,
  );
  const [name, setName] = useState(trigger?.name ?? thread.title);
  const [prompt, setPrompt] = useState(trigger?.prompt ?? firstPrompt(thread));
  const [error, setError] = useState<string | null>(null);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const result = toWhen(form);
    if ('error' in result) return setError(result.error);
    const input = triggerInput(thread, {
      when: result.when,
      missed: form.missed,
      name: name.trim() || thread.title,
      prompt: prompt.trim() || firstPrompt(thread),
    });
    if (!input)
      return setError(
        "This thread's project folder isn't on this computer, so it can't run here.",
      );
    try {
      await host.schedule.set(input);
      toast.success(`Scheduled: ${describeTrigger(result.when)}`);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const remove = async () => {
    await host.schedule.remove(thread.id);
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={save} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Schedule</DialogTitle>
            <DialogDescription>
              Runs this thread's agent in the background, in its worktree. Each
              finished run lands in the Queue.
            </DialogDescription>
          </DialogHeader>
          <ScheduleFields
            id="schedule"
            form={form}
            onChange={(next) => (setForm(next), setError(null))}
          />
          <Field>
            <FieldLabel htmlFor="schedule-name">Name</FieldLabel>
            <Input
              id="schedule-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={thread.title}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="schedule-prompt">
              Prompt for each run
            </FieldLabel>
            <Textarea
              id="schedule-prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={3}
              className="max-h-48"
            />
          </Field>
          {!!error && (
            <p role="alert" className="type-meta text-destructive">
              {error}
            </p>
          )}
          <DialogFooter className="items-center">
            {!!trigger && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => void remove()}
                className="mr-auto text-destructive"
              >
                <Trash data-icon="inline-start" />
                Remove schedule
              </Button>
            )}
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">Save schedule</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
