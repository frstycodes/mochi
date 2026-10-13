import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type SyntheticEvent } from 'react';
import { MessageQuestion } from 'reicon-react';
import { usePromptInputController } from '@/components/ai-elements/prompt-input';
import { revealIn } from '@/lib/revealIn';
import { host } from '../host';
import type { ProfileConfig } from '../host/types/settings';
import type { AgentCommand, AgentInfo, McpServer, Provider } from '../model';
import { HARNESSES } from '../settings/harnesses';
import { ProviderMark } from '../ui';
import { moveToFront, resolveToken, slashItems, slashMatches, slashQueryAt, type SlashItem } from './slash';

/** Above the composer while the caret ends a `/` and part of a name: Mochi's commands, then the harness's skills and commands. */
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
      {!!menu.replaces && (
        <p className="px-2 pt-1.5 pb-0.5 type-caption text-muted-foreground">
          Replaces <span className="text-info">/{menu.replaces.name}</span> at the start: one command per message
        </p>
      )}
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

/**
 * The menu's state and the textarea props that drive it: arrows move, Enter or Tab picks, Esc closes until the text changes.
 * Picking moves the command to the start of the message, the rest staying as its arguments. Needs the composer's `PromptInputProvider`.
 */
export function useSlashMenu(items: SlashItem[]) {
  const listId = useId();
  const { textInput } = usePromptInputController();
  const text = textInput.value;
  const [active, setActive] = useState(0);
  const [dismissedAt, setDismissedAt] = useState<string>();
  // The caret as of the text it was read with; a programmatic change (send, pick) puts it at the end.
  const [caret, setCaret] = useState<{ text: string; at: number | null }>();
  const textarea = useRef<HTMLTextAreaElement>(null);
  const at = caret?.text === text ? caret.at : text.length;
  const range = at === null ? null : slashQueryAt(text, at);
  const matches = range ? slashMatches(range.query, items) : [];
  const isOpen = matches.length > 0 && dismissedAt !== text;
  const index = Math.min(active, matches.length - 1);
  const existing = range && range.start > 0 ? resolveToken(text, items) : null;

  const choose = (item: SlashItem) => {
    if (!range) return;
    const next = moveToFront(text, range, item, items);
    textInput.setInput(next);
    setActive(0);
    // After React writes the value: the caret goes to the end, after the arguments.
    requestAnimationFrame(() => textarea.current?.setSelectionRange(next.length, next.length));
  };

  const track = (e: SyntheticEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    textarea.current = el;
    setCaret({ text: el.value, at: el.selectionStart === el.selectionEnd ? el.selectionStart : null });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    textarea.current = e.currentTarget;
    if (!isOpen) return;
    const step = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
    if (step) setActive((index + step + matches.length) % matches.length);
    else if (e.key === 'Enter' || e.key === 'Tab') choose(matches[index]);
    else if (e.key === 'Escape') setDismissedAt(text);
    else return setActive(0);
    e.preventDefault();
    e.stopPropagation();
  };

  const textareaProps = {
    onKeyDown,
    onChange: track,
    onSelect: track,
    'aria-autocomplete': 'list' as const,
    'aria-controls': isOpen ? listId : undefined,
    'aria-activedescendant': isOpen ? optionId(listId, matches[index]) : undefined,
  };
  return { listId, matches, active: index, isOpen, replaces: isOpen ? existing?.item : undefined, choose, textareaProps };
}

/**
 * What `/` offers for a thread on `provider`: the live agent's own list once it reported one, else the enabled skills in the
 * profile account's config, so the menu works before the agent starts.
 */
export function useSlashItems(provider: Provider, spaceId: string, agent?: AgentInfo) {
  const configured = useConfiguredSkills(provider, spaceId, !agent?.commands);
  return slashItems(agent?.commands ?? configured, provider);
}

/** The thread's harness skills for `@`: the live agent's (its skill names picked out of its commands) or the profile's enabled ones. */
export function useThreadSkills(provider: Provider, spaceId: string, agent?: AgentInfo): AgentCommand[] {
  const configured = useConfiguredSkills(provider, spaceId, !agent?.commands);
  if (!agent?.commands) return configured;
  const names = agent.skills && new Set(agent.skills);
  return names ? agent.commands.filter((c) => names.has(c.name)) : agent.commands;
}

/**
 * The profile's enabled MCP servers on `provider`, with the live agent's tool count where it reported one. Before the profile
 * config is read (or in a build without one) the live agent's own list stands in. Mochi's own server is never offered.
 */
export function useThreadServers(provider: Provider, spaceId: string, agent?: AgentInfo): McpServer[] {
  const config = useProfileConfig(spaceId);
  const live = new Map((agent?.mcpServers ?? []).map((s) => [s.name, s]));
  const servers = config ? config[provider].mcpServers.filter((m) => m.enabled).map(({ def }) => live.get(def.name) ?? { name: def.name, status: 'pending' as const }) : [...live.values()];
  return servers.filter((s) => s.name !== MOCHI_SERVER && s.status !== 'disabled');
}

// electron/mcp/server.ts `SERVER`: Mochi's own tools, which the agent already uses for goal steps.
const MOCHI_SERVER = 'mochi';

// GAP: the config fallback lists skills only; custom and plugin commands appear once the agent reports its own list.
function useConfiguredSkills(provider: Provider, spaceId: string, isNeeded: boolean) {
  const config = useProfileConfig(isNeeded ? spaceId : undefined);
  // Stable per config read: the menu reveals its current row when that row changes.
  return useMemo(() => config?.[provider].skills.filter((s) => s.enabled).map(({ name, description, argumentHint }) => ({ name, description, ...(argumentHint && { argumentHint }) })) ?? [], [config, provider]);
}

function useProfileConfig(spaceId?: string) {
  const [config, setConfig] = useState<{ spaceId: string; value?: ProfileConfig }>();
  useEffect(() => {
    if (!spaceId) return;
    let isCurrent = true;
    configFor(spaceId).then(
      (value) => isCurrent && setConfig({ spaceId, value }),
      () => isCurrent && setConfig({ spaceId }),
    );
    return () => {
      isCurrent = false;
    };
  }, [spaceId]);
  return config && config.spaceId === spaceId ? config.value : undefined;
}

// GAP: one read per profile per launch; a skill added while Mochi runs shows once the agent reports it, or after a restart.
const configs = new Map<string, ReturnType<typeof host.settings.agentConfig>>();
function configFor(spaceId: string) {
  if (!configs.has(spaceId)) configs.set(spaceId, host.settings.agentConfig(spaceId).catch((error) => (configs.delete(spaceId), Promise.reject(error))));
  return configs.get(spaceId)!;
}
