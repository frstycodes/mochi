import { useQuery } from '@tanstack/react-query';
import { useId, useRef, useState } from 'react';
import type { EditorView } from '@codemirror/view';
import { Minimize, MessageQuestion } from '@/icons';
import { usePromptInputController } from '@/components/ai-elements/prompt-input';
import { CommandGroup, CommandItem } from '@/components/ui/command';
import { host } from '../host';
import type { AgentCommand, AgentInfo, McpServer, Provider } from '../model';
import { offItems } from '../library/nativeOverrides';
import { useProfiles } from '../profiles';
import { MOCHI_SERVER } from '@mochi/domain/runtime/toolTable';
import { HARNESSES } from '../settings/harnesses';
import { isAbsolutePath } from '../projects';
import type { Caret } from './ComposerEditor';
import { CaretMenu, forwardKey } from './CaretMenu';
import { ItemMeta, SkillFallback } from './MentionMenu';
import { SkillMark } from './McpIcon';
import {
  bySlashGroup,
  configuredCommands,
  insertToken,
  slashGroup,
  slashItems,
  slashMatches,
  slashQueryAt,
  type SlashItem,
} from './slash';
import { queryKeys } from '../queryKeys';
import { libraryQuery } from '../library/queries';

/** Above the caret while it ends a `/` and part of a name: Mochi's commands, then the harness's skills and commands. */
export function SlashMenu({ menu }: { menu: ReturnType<typeof useSlashMenu> }) {
  // `matches` arrive with each section's rows together (`bySlashGroup`), so a section is a run of one group.
  const groups = menu.matches.reduce<SlashItem[][]>((runs, item) => {
    const last = runs.at(-1);
    if (last && slashGroup(last[0]) === slashGroup(item)) last.push(item);
    else runs.push([item]);
    return runs;
  }, []);
  return (
    <CaretMenu
      isOpen={menu.isOpen}
      listRef={menu.listRef}
      listId={menu.listId}
      label="Commands and skills"
      value={menu.activeKey}
      onValueChange={menu.setActiveKey}
      onDismiss={menu.dismiss}
    >
      {groups.map((group) => (
        <CommandGroup key={slashGroup(group[0])} heading={groupName(group[0])}>
          {group.map((item) => (
            <CommandItem
              key={itemKey(item)}
              value={itemKey(item)}
              aria-disabled={!!item.disabledReason || undefined}
              onSelect={() => menu.choose(item)}
              className="h-8 rounded-md type-body aria-disabled:text-muted-foreground aria-disabled:data-selected:bg-accent/60"
            >
              <SlashIcon item={item} />
              <span className="shrink-0 font-medium">/{item.name}</span>
              {!!item.argumentHint && (
                <span className="shrink-0 text-subtle-foreground max-sm:hidden">
                  {item.argumentHint}
                </span>
              )}
              <span className="min-w-0 truncate text-muted-foreground">
                {item.description}
              </span>
              {item.disabledReason ? (
                <ItemMeta>{item.disabledReason}</ItemMeta>
              ) : (
                menu.isMidText &&
                !item.isSkill && (
                  <ItemMeta className="text-warning group-data-selected/command-item:text-warning">
                    Runs only at the start of a message
                  </ItemMeta>
                )
              )}
            </CommandItem>
          ))}
        </CommandGroup>
      ))}
    </CaretMenu>
  );
}

const MOCHI_ICONS = {
  side: MessageQuestion,
  compact: Minimize,
} satisfies Record<string, typeof MessageQuestion>;

/** A harness item's own icon (its skill's, else its plugin's, from the library), else the skill lightbulb. */
function SlashIcon({ item }: { item: SlashItem }) {
  if (item.source !== 'mochi')
    return <SkillMark skill={item.name} fallback={<SkillFallback />} />;
  const Icon =
    MOCHI_ICONS[item.name as keyof typeof MOCHI_ICONS] ?? MessageQuestion;
  return <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />;
}

// A plugin's section reads as the prefix you type (`emilkowalski`), not a prettified title.
const groupName = (item: SlashItem) => {
  if (item.source === 'mochi') return 'Mochi';
  const group = slashGroup(item);
  return group === item.source ? HARNESSES[item.source].name : group;
};
const itemKey = (item: SlashItem) => `${item.source}:${item.name}`;

/**
 * The menu's state and the editor props that drive it: arrows move (cmdk does the moving), Enter or Tab picks, Esc (the popover's) closes until the text changes.
 * Picking puts the name where it was typed, nothing else moves. Needs the composer's `PromptInputProvider`.
 */
export function useSlashMenu(items: SlashItem[]) {
  const listId = useId();
  const { textInput } = usePromptInputController();
  const text = textInput.value;
  const [activeKey, setActiveKey] = useState<string>();
  const listRef = useRef<HTMLDivElement>(null);
  const [dismissedAt, setDismissedAt] = useState<string>();
  // The caret as of the text it was read with; a programmatic change (send, pick) puts it at the end.
  const [caret, setCaret] = useState<Caret>();
  const editor = useRef<EditorView>(null);
  const at = caret?.text === text ? caret.at : text.length;
  const range = at === null ? null : slashQueryAt(text, at);
  const matches = range ? bySlashGroup(slashMatches(range.query, items)) : [];
  const isOpen = matches.length > 0 && dismissedAt !== text;
  const index = Math.max(
    0,
    matches.findIndex((m) => itemKey(m) === activeKey),
  );

  const choose = (item: SlashItem) => {
    if (!range || item.disabledReason) return;
    const next = insertToken(text, range, item);
    setActiveKey(undefined);
    // With text right after it, the caret ends the full name and would reopen the menu on it.
    setDismissedAt(next.text);
    const view = editor.current;
    if (!view) return textInput.setInput(next.text);
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: next.text },
      selection: { anchor: next.caret },
    });
    view.focus();
  };

  const onCaret = (next: Caret, view: EditorView) => {
    editor.current = view;
    setCaret(next);
  };

  const onKeyDown = (e: KeyboardEvent, view: EditorView) => {
    editor.current = view;
    if (!isOpen) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp')
      forwardKey(listRef.current, e);
    else if (e.key === 'Enter' || e.key === 'Tab') choose(matches[index]);
    else return setActiveKey(undefined);
    e.preventDefault();
    e.stopPropagation();
  };

  const editorProps = {
    onKeyDown,
    onCaret,
    attributes: {
      'aria-autocomplete': 'list',
      'aria-controls': isOpen ? listId : undefined,
    },
  };
  return {
    listId,
    matches,
    activeKey: matches[index] && itemKey(matches[index]),
    setActiveKey,
    dismiss: () => setDismissedAt(text),
    listRef,
    isOpen,
    isMidText: !!range && range.start > 0,
    choose,
    editorProps,
  };
}

/**
 * What `/` offers for a thread on `provider`: the live agent's own list once it reported one, else what the profile's account,
 * the project at `projectRoot` and enabled plugins carry on disk, so the menu works before the agent starts.
 */
export function useSlashItems(
  provider: Provider,
  spaceId: string,
  projectRoot: string | null,
  agent?: AgentInfo,
) {
  const { commands, skills } = useAgentCommands(
    provider,
    spaceId,
    projectRoot,
    agent,
  );
  return slashItems(commands, provider, skills);
}

/** The thread's harness skills for `@`: the live agent's (its skill names picked out of its commands) or those on disk. */
export function useThreadSkills(
  provider: Provider,
  spaceId: string,
  projectRoot: string | null,
  agent?: AgentInfo,
): AgentCommand[] {
  const { commands, skills } = useAgentCommands(
    provider,
    spaceId,
    projectRoot,
    agent,
  );
  const names = skills && new Set(skills);
  return names ? commands.filter((c) => names.has(c.name)) : commands;
}

/**
 * The profile's enabled MCP servers on `provider` (and the project's `.mcp.json`), with the live agent's tool count where it
 * reported one. Before the profile config is read (or in a build without one) the live agent's own list stands in. Mochi's
 * own server is never offered, nor one the profile turned off.
 */
export function useThreadServers(
  provider: Provider,
  spaceId: string,
  projectRoot: string | null,
  agent?: AgentInfo,
): McpServer[] {
  const config = useProfileConfig(spaceId, projectRoot);
  const nativeOff =
    useProfiles().find((p) => p.id === spaceId)?.nativeOff ?? [];
  const live = new Map((agent?.mcpServers ?? []).map((s) => [s.name, s]));
  const off = new Set(
    config
      ? offItems(config[provider], nativeOff).flatMap((i) =>
          i.kind === 'server' || i.kind === 'connector' ? [i.name] : [],
        )
      : [],
  );
  const pending = (name: string) =>
    live.get(name) ?? { name, status: 'pending' as const };
  const servers = config
    ? [
        ...config[provider].mcpServers
          .filter((m) => m.enabled && !off.has(m.def.name))
          .map(({ def }) => pending(def.name)),
        ...(config[provider].claudeAiConnectors ?? [])
          .filter((name) => !off.has(name))
          .map(pending),
      ]
    : [...live.values()];
  return servers.filter(
    (s) => s.name !== MOCHI_SERVER && s.status !== 'disabled',
  );
}

/**
 * The plugins `@` offers, by the name their skills are prefixed with: the live agent's own, else the account's enabled ones the
 * profile didn't turn off and the library's plugins on for the profile (Claude loads both; Codex threads get no plugin folders).
 */
export function useThreadPlugins(
  provider: Provider,
  spaceId: string,
  projectRoot: string | null,
  agent?: AgentInfo,
): string[] {
  const config = useProfileConfig(
    agent?.plugins ? undefined : spaceId,
    projectRoot,
  );
  const nativeOff = useProfiles().find((p) => p.id === spaceId)?.nativeOff;
  const library = useLibraryPlugins(
    agent?.plugins || provider !== 'claude' ? undefined : spaceId,
  );
  if (agent?.plugins) return agent.plugins.map((p) => p.name);
  if (!config) return [];
  const off = new Set(
    offItems(config[provider], nativeOff ?? []).map((i) => i.name),
  );
  const native = config[provider].plugins
    .filter((id) => !off.has(id))
    .map((id) => id.split('@')[0]);
  return [...new Set([...native, ...library])];
}

function useLibraryPlugins(spaceId: string | undefined) {
  const entriesQuery = useQuery({
    ...libraryQuery(spaceId ?? ''),
    enabled: !!spaceId,
  });
  return (entriesQuery.data ?? [])
    .filter((e) => e.kind === 'plugin' && e.isEnabled)
    .map((e) => e.name);
}

function useAgentCommands(
  provider: Provider,
  spaceId: string,
  projectRoot: string | null,
  agent?: AgentInfo,
): { commands: AgentCommand[]; skills?: string[] } {
  const configured = useConfiguredCommands(
    provider,
    spaceId,
    projectRoot,
    !agent?.commands,
  );
  return agent?.commands
    ? { commands: agent.commands, skills: agent.skills }
    : configured;
}

/** Leaves out what the Skills tab turned off for the profile, as the session will once it starts. */
function useConfiguredCommands(
  provider: Provider,
  spaceId: string,
  projectRoot: string | null,
  isNeeded: boolean,
) {
  const config = useProfileConfig(isNeeded ? spaceId : undefined, projectRoot);
  const profiles = useProfiles();
  const nativeOff = profiles.find((p) => p.id === spaceId)?.nativeOff;
  // Stable per config read: the menu reveals its current row when that row changes, and every chat row re-renders.
  // `useProfiles()` stays out of the expression below, or React Compiler leaves it unmemoized.
  return config
    ? configuredCommands(
        config[provider],
        offItems(config[provider], nativeOff ?? []),
      )
    : { commands: [], skills: [] };
}

function useProfileConfig(
  spaceId: string | undefined,
  projectRoot: string | null,
) {
  const root =
    projectRoot && isAbsolutePath(projectRoot) ? projectRoot : undefined;
  const configQuery = useQuery({
    queryKey: queryKeys.profile.config.root(spaceId, root),
    queryFn: () => host.settings.agentConfig(spaceId!, root),
    enabled: !!spaceId,
  });
  return configQuery.data;
}
