import { useEffect, useEffectEvent } from 'react';
import { usePromptInputController } from '@/components/ai-elements/prompt-input';

interface Draft {
  threadId: string;
  text?: string;
  files?: File[];
}

const listeners = new Set<(draft: Draft) => void>();

/** Adds text and attachments to a thread's composer. Drops them if that thread's composer isn't mounted. */
export function sendToComposer(draft: Draft) {
  listeners.forEach((listener) => listener(draft));
  return listeners.size > 0;
}

/** Mount inside a thread's PromptInputProvider so the side pane can reach its composer. */
export function ComposerInbox({ threadId }: { threadId: string }) {
  const { attachments, textInput } = usePromptInputController();
  const receive = useEffectEvent((draft: Draft) => {
    if (draft.threadId !== threadId) return;
    if (draft.files?.length) attachments.add(draft.files);
    if (draft.text) textInput.setInput(textInput.value ? `${textInput.value}\n\n${draft.text}` : draft.text);
  });

  useEffect(() => {
    const listener = (draft: Draft) => receive(draft);
    listeners.add(listener);
    return () => void listeners.delete(listener);
  }, []);

  return null;
}

export async function dataUrlToFile(dataUrl: string, name: string) {
  const blob = await (await fetch(dataUrl)).blob();
  return new File([blob], name, { type: blob.type });
}
