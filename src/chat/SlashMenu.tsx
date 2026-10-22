import { useQuery } from '@tanstack/react-query';
import { useId, useMemo, useRef, useState } from 'react';
import type { EditorView } from '@codemirror/view';
import { Minimize, MessageQuestion } from '@/icons';
import { usePromptInputController } from '@/components/ai-elements/prompt-input';
import { CommandGroup, CommandItem } from '@/components/ui/command';
import { host } from '../host';
import type { AgentCommand, AgentInfo, McpServer, Provider } from '../model';
import { MOCHI_SERVER } from '../runtime/toolTable';
import { HARNESSES } from '../settings/harnesses';
import { ProviderMark } from '../ui';
import { isAbsolutePath } from '../projects';
import type { Caret } from './ComposerEditor';
import { CaretMenu, forwardKey } from './CaretMenu';
import { configuredCommands, insertToken, slashItems, slashMatches, slashQueryAt, type SlashItem } from './slash';
import { queryKeys } from '../queryKeys';

/** Above the caret while it ends a `/` and part of a name: Mochi's commands, then the harness's skills and commands. */
export function SlashMenu({ menu }: { menu: ReturnType<typeof useSlashMenu> }) {
  const groups = [menu.matches.filter((m) => m.source === 'mochi'), menu.matches.filter((m) => m.source !== 'mochi')].filter((g) => g.length);
  return (
    <CaretMenu isOpen={menu.isOpen} editor={menu.editor} listRef={menu.listRef} listId={menu.listId} label="Commands and skills" value={menu.activeKey} onValueChange={menu.setActiveKey} onDismiss={menu.dismiss}>
      {groups.map((group) => (
        <CommandGroup key={group[0].source} heading={groupName(group[0].source)}>
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
              {!!item.argumentHint && <span className="shrink-0 text-subtle-foreground max-sm:hidden">{item.argumentHint}</span>}
              <span className="min-w-0 truncate text-muted-foreground">{item.description}</span>
              {item.disabledReason ? (
                <span className="ml-auto shrink-0 type-caption text-subtle-foreground">{item.disabledReason}</span>
              ) : (
                menu.isMidText && !item.isSkill && <span className="ml-auto shrink-0 type-caption text-warning">Runs only at the start of a message</span>
              )}
            </CommandItem>
          ))}
        </CommandGroup>
      ))}
    </CaretMenu>
  );
}

const MOCHI_ICONS = { side: MessageQuestion, compact: Minimize } satisfies Record<string, typeof MessageQuestion>;

function SlashIcon({ item }: { item: SlashItem }) {
  if (item.source !== 'mochi') return <ProviderMark provider={item.source} size={14} className="mx-px" />;
  const Icon = MOCHI_ICONS[item.name as keyof typeof MOCHI_ICONS] ?? MessageQuestion;
  return <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />;
}

const groupName = (source: SlashItem['source']) => (source === 'mochi' ? 'Mochi' : HARNESSES[source].name);
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
  const matches = range ? slashMatches(range.query, items) : [];
  const isOpen = matches.length > 0 && dismissedAt !== text;
  const index = Math.max(0, matches.findIndex((m) => itemKey(m) === activeKey));

  const choose = (item: SlashItem) => {
    if (!range || item.disabledReason) return;
    const next = insertToken(text, range, item);
    setActiveKey(undefined);
    // With text right after it, the caret ends the full name and would reopen the menu on it.
    setDismissedAt(next.text);
    const view = editor.current;
    if (!view) return textInput.setInput(next.text);
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: next.text }, selection: { anchor: next.caret } });
    view.focus();
  };

  const onCaret = (next: Caret, view: EditorView) => {
    editor.current = view;
    setCaret(next);
  };

  const onKeyDown = (e: KeyboardEvent, view: EditorView) => {
    editor.current = view;
    if (!isOpen) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') forwardKey(listRef.current, e);
    else if (e.key === 'Enter' || e.key === 'Tab') choose(matches[index]);
    else return setActiveKey(undefined);
    e.preventDefault();
    e.stopPropagation();
  };

  const editorProps = {
    onKeyDown,
    onCaret,
    attributes: { 'aria-autocomplete': 'list', 'aria-controls': isOpen ? listId : undefined },
  };
  return { listId, matches, activeKey: matches[index] && itemKey(matches[index]), setActiveKey, dismiss: () => setDismissedAt(text), editor, listRef, isOpen, isMidText: !!range && range.start > 0, choose, editorProps };
}

/**
 * What `/` offers for a thread on `provider`: the live agent's own list once it reported one, else what the profile's account,
 * the project at `projectRoot` and enabled plugins carry on disk, so the menu works before the agent starts.
 */
export function useSlashItems(provider: Provider, spaceId: string, projectRoot: string | null, agent?: AgentInfo) {
  const { commands, skills } = useAgentCommands(provider, spaceId, projectRoot, agent);
  return slashItems(commands, provider, skills);
}

/** The thread's harness skills for `@`: the live agent's (its skill names picked out of its commands) or those on disk. */
export function useThreadSkills(provider: Provider, spaceId: string, projectRoot: string | null, agent?: AgentInfo): AgentCommand[] {
  const { commands, skills } = useAgentCommands(provider, spaceId, projectRoot, agent);
  const names = skills && new Set(skills);
  return names ? commands.filter((c) => names.has(c.name)) : commands;
}

/**
 * The profile's enabled MCP servers on `provider` (and the project's `.mcp.json`), with the live agent's tool count where it
 * reported one. Before the profile config is read (or in a build without one) the live agent's own list stands in. Mochi's
 * own server is never offered.
 */
export function useThreadServers(provider: Provider, spaceId: string, projectRoot: string | null, agent?: AgentInfo): McpServer[] {
  const config = useProfileConfig(spaceId, projectRoot);
  const live = new Map((agent?.mcpServers ?? []).map((s) => [s.name, s]));
  const servers = config ? config[provider].mcpServers.filter((m) => m.enabled).map(({ def }) => live.get(def.name) ?? { name: def.name, status: 'pending' as const }) : [...live.values()];
  return servers.filter((s) => s.name !== MOCHI_SERVER && s.status !== 'disabled');
}

function useAgentCommands(provider: Provider, spaceId: string, projectRoot: string | null, agent?: AgentInfo): { commands: AgentCommand[]; skills?: string[] } {
  const configured = useConfiguredCommands(provider, spaceId, projectRoot, !agent?.commands);
  return agent?.commands ? { commands: agent.commands, skills: agent.skills } : configured;
}

function useConfiguredCommands(provider: Provider, spaceId: string, projectRoot: string | null, isNeeded: boolean) {
  const config = useProfileConfig(isNeeded ? spaceId : undefined, projectRoot);
  // Stable per config read: the menu reveals its current row when that row changes.
  return useMemo(() => (config ? configuredCommands(config[provider]) : { commands: [], skills: [] }), [config, provider]);
}

function useProfileConfig(spaceId: string | undefined, projectRoot: string | null) {
  const root = projectRoot && isAbsolutePath(projectRoot) ? projectRoot : undefined;
  const configQuery = useQuery({ queryKey: queryKeys.profile.config.root(spaceId, root), queryFn: () => host.settings.agentConfig(spaceId!, root), enabled: !!spaceId });
  return configQuery.data;
}
