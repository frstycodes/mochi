import { useId, useState, type KeyboardEvent } from 'react';
import { MessageQuestion } from 'reicon-react';
import { usePromptInputController } from '@/components/ai-elements/prompt-input';
import { slashMatches, type SlashCommand } from './slash';

/** Above the thread composer while its text is `/` and part of a command name. */
export function SlashMenu({ menu }: { menu: ReturnType<typeof useSlashMenu> }) {
  if (!menu.isOpen) return null;
  return (
    <div id={menu.listId} role="listbox" aria-label="Commands" className="absolute inset-x-0 bottom-full z-10 mb-2 flex flex-col gap-0.5 rounded-xl bg-popover p-1 shadow-popover">
      {menu.matches.map((command, i) => (
        <div
          key={command.name}
          id={`${menu.listId}-${command.name}`}
          role="option"
          aria-selected={i === menu.active}
          onPointerDown={(e) => e.preventDefault()}
          onClick={() => menu.choose(command)}
          className="flex h-8 cursor-default items-center gap-2 rounded-md px-2 type-body hover:bg-accent/60 aria-selected:bg-accent"
        >
          <MessageQuestion className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="shrink-0 font-medium">{command.usage}</span>
          <span className="min-w-0 truncate text-muted-foreground">{command.description}</span>
        </div>
      ))}
    </div>
  );
}

/** The menu's state and the textarea props that drive it: arrows move, Enter or Tab completes, Esc closes until the text changes. Needs the composer's `PromptInputProvider`. */
export function useSlashMenu() {
  const listId = useId();
  const { textInput } = usePromptInputController();
  const [active, setActive] = useState(0);
  const [dismissedAt, setDismissedAt] = useState<string>();
  const matches = slashMatches(textInput.value);
  const isOpen = matches.length > 0 && dismissedAt !== textInput.value;
  const current = matches[Math.min(active, matches.length - 1)];
  const choose = (command: SlashCommand) => textInput.setInput(`/${command.name} `);

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!isOpen) return;
    const step = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
    if (step) setActive((i) => (i + step + matches.length) % matches.length);
    else if (e.key === 'Enter' || e.key === 'Tab') choose(current);
    else if (e.key === 'Escape') setDismissedAt(textInput.value);
    else return setActive(0);
    e.preventDefault();
    e.stopPropagation();
  };

  const textareaProps = {
    onKeyDown,
    'aria-autocomplete': 'list' as const,
    'aria-controls': isOpen ? listId : undefined,
    'aria-activedescendant': isOpen ? `${listId}-${current.name}` : undefined,
  };
  return { listId, matches, active, isOpen, choose, textareaProps };
}
