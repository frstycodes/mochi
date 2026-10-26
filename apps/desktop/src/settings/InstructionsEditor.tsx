import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/toast/store';
import { host } from '../host';
import { queryKeys } from '../queryKeys';
import { ipcMessage } from './AgentSettings';

/** Edits one instruction file in place; `onClose` runs after Save and Cancel. */
export function InstructionsEditor({
  spaceId,
  name,
  onClose,
}: {
  spaceId: string;
  name: string;
  onClose: () => void;
}) {
  const textQuery = useQuery({
    queryKey: queryKeys.profile.instructions(spaceId, name),
    queryFn: () => host.settings.readInstructions(spaceId, name),
    staleTime: 0,
    gcTime: 0,
  });
  if (textQuery.isError)
    return (
      <p role="alert" className="type-meta text-destructive">
        Couldn’t read {name}: {ipcMessage(textQuery.error)}
      </p>
    );
  if (textQuery.data === undefined) return <Spinner className="size-4" />;
  return (
    <MochiInstructionsForm
      spaceId={spaceId}
      name={name}
      initial={textQuery.data}
      onClose={onClose}
    />
  );
}

function MochiInstructionsForm({
  spaceId,
  name,
  initial,
  onClose,
}: {
  spaceId: string;
  name: string;
  initial: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const saveMutation = useMutation({
    mutationFn: (text: string) =>
      host.settings.writeInstructions(spaceId, name, text),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.profile.folder(spaceId),
      });
      toast.success(`Saved ${name}`);
      onClose();
    },
    onError: (error) =>
      toast.error(`Couldn’t save ${name}`, { description: ipcMessage(error) }),
  });
  return (
    <InstructionsTextEditor
      name={name}
      initial={initial}
      isSaving={saveMutation.isPending}
      saveLabel={`Save ${name}`}
      onSave={saveMutation.mutate}
      onClose={onClose}
    />
  );
}

/** A Markdown text box with Save and Cancel; the caller decides what saving does. */
export function InstructionsTextEditor({
  name,
  initial,
  isSaving,
  saveLabel,
  onSave,
  onClose,
}: {
  name: string;
  initial: string;
  isSaving: boolean;
  saveLabel: string;
  onSave: (text: string) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const isDirty = draft !== initial;
  const save = () => onSave(draft);

  return (
    <div className="flex flex-col gap-2">
      <Textarea
        autoFocus
        aria-label={`Contents of ${name}`}
        value={draft}
        spellCheck={false}
        placeholder="Write instructions in Markdown."
        className="min-h-40 max-h-96 font-mono"
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onClose();
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            if (isDirty && !isSaving) save();
          }
        }}
      />
      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button size="sm" disabled={!isDirty || isSaving} onClick={save}>
          {isSaving && <Spinner data-icon="inline-start" />}
          {saveLabel}
        </Button>
      </div>
    </div>
  );
}
