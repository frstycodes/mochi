import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { MessageQuestion } from 'reicon-react';
import { usePromptInputController } from '@/components/ai-elements/prompt-input';
import { revealIn } from '@/lib/revealIn';
import { host } from '../host';
import type { AgentCommand, AgentInfo, Provider } from '../model';
import { HARNESSES } from '../settings/harnesses';
import { ProviderMark } from '../ui';
import { slashItems, slashMatches, type SlashItem } from './slash';

/** Above the composer while its text is `/` and part of a name: Mochi's commands, then the harness's skills and commands. */
export function SlashMenu({ menu }: { menu: ReturnType<typeof useSlashMenu> }) {
  const list = useRef<HTMLDivElement>(null);
  const current = menu.isOpen ? menu.matches[menu.active] : undefined;
  useEffect(() => {
    const row = current && list.current?.querySelector(`[data-name="${CSS.escape(current.name)}"]`);
    if (row) revealIn(list.current!, row);
  }, [current]);
  if (!menu.isOpen) return null;
  const groups = [menu.matches.filter((m) => m.source === 'mochi'), menu.matches.filter((m) => m.source !== 'mochi')].filter((g) => g.length);
  return (
    <div ref={list} id={menu.listId} role="listbox" aria-label="Commands and skills" className="absolute inset-x-0 bottom-full z-10 mb-2 flex max-h-80 flex-col gap-0.5 overflow-y-auto rounded-xl bg-popover p-1 shadow-popover">
      {groups.map((group) => (
        <div key={group[0].source} role="group" aria-label={groupName(group[0].source)} className="flex flex-col gap-0.5">
          <div aria-hidden className="px-2 pt-1.5 pb-0.5 type-caption text-subtle-foreground">
            {groupName(group[0].source)}
          </div>
          {group.map((item) => (
            <div
              key={item.name}
              data-name={item.name}
              id={optionId(menu.listId, item)}
              role="option"
              aria-selected={item === current}
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => menu.choose(item)}
              className="flex h-8 shrink-0 cursor-default items-center gap-2 rounded-md px-2 type-body hover:bg-accent/60 aria-selected:bg-accent"
            >
              {item.source === 'mochi' ? <MessageQuestion className="size-4 shrink-0 text-muted-foreground" aria-hidden /> : <ProviderMark provider={item.source} size={14} className="mx-px" />}
              <span className="shrink-0 font-medium">/{item.name}</span>
              {!!item.argumentHint && <span className="shrink-0 text-subtle-foreground max-sm:hidden">{item.argumentHint}</span>}
              <span className="min-w-0 truncate text-muted-foreground">{item.description}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

const groupName = (source: SlashItem['source']) => (source === 'mochi' ? 'Mochi' : HARNESSES[source].name);
const optionId = (listId: string, item: SlashItem) => `${listId}-${item.source}-${item.name.replace(/\W/g, '_')}`;

/** The menu's state and the textarea props that drive it: arrows move, Enter or Tab completes, Esc closes until the text changes. Needs the composer's `PromptInputProvider`. */
export function useSlashMenu(items: SlashItem[]) {
  const listId = useId();
  const { textInput } = usePromptInputController();
  const [active, setActive] = useState(0);
  const [dismissedAt, setDismissedAt] = useState<string>();
  const matches = slashMatches(textInput.value, items);
  const isOpen = matches.length > 0 && dismissedAt !== textInput.value;
  const index = Math.min(active, matches.length - 1);
  const choose = (item: SlashItem) => {
    textInput.setInput(`/${item.name} `);
    setActive(0);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!isOpen) return;
    const step = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
    if (step) setActive((index + step + matches.length) % matches.length);
    else if (e.key === 'Enter' || e.key === 'Tab') choose(matches[index]);
    else if (e.key === 'Escape') setDismissedAt(textInput.value);
    else return setActive(0);
    e.preventDefault();
    e.stopPropagation();
  };

  const textareaProps = {
    onKeyDown,
    'aria-autocomplete': 'list' as const,
    'aria-controls': isOpen ? listId : undefined,
    'aria-activedescendant': isOpen ? optionId(listId, matches[index]) : undefined,
  };
  return { listId, matches, active: index, isOpen, choose, textareaProps };
}

/**
 * What `/` offers for a thread on `provider`: the live agent's own list once it reported one, else the enabled skills in the
 * profile account's config, so the menu works before the agent starts.
 */
export function useSlashItems(provider: Provider, spaceId: string, agent?: AgentInfo) {
  const configured = useConfiguredSkills(provider, spaceId, !agent?.commands);
  return slashItems(agent?.commands ?? configured, provider);
}

// GAP: the config fallback lists skills only; custom and plugin commands appear once the agent reports its own list.
function useConfiguredSkills(provider: Provider, spaceId: string, isNeeded: boolean) {
  const [skills, setSkills] = useState<AgentCommand[]>([]);
  useEffect(() => {
    if (!isNeeded) return;
    let isCurrent = true;
    configFor(spaceId).then(
      (config) => isCurrent && setSkills(config[provider].skills.filter((s) => s.enabled).map(({ name, description, argumentHint }) => ({ name, description, ...(argumentHint && { argumentHint }) }))),
      () => isCurrent && setSkills([]),
    );
    return () => {
      isCurrent = false;
    };
  }, [provider, spaceId, isNeeded]);
  return skills;
}

// GAP: one read per profile per launch; a skill added while Mochi runs shows once the agent reports it, or after a restart.
const configs = new Map<string, ReturnType<typeof host.settings.agentConfig>>();
function configFor(spaceId: string) {
  if (!configs.has(spaceId)) configs.set(spaceId, host.settings.agentConfig(spaceId).catch((error) => (configs.delete(spaceId), Promise.reject(error))));
  return configs.get(spaceId)!;
}
