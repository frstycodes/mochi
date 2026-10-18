import { useEffect, useId, useState } from 'react';
import { Chat, Note, ShieldAlert, Window, X } from '@/icons';
import { toast } from '@/toast/store';
import { cn } from '@/lib/utils';
import { usePromptInputController } from '@/components/ai-elements/prompt-input';
import { host } from '../host';
import type { AgentImage } from '../host/types/agent';
import type { AppWindow, ScreenAccess } from '../host/types/windows';
import type { AgentCommand, McpServer } from '../model';
import { openPhotos } from '../photo/photos';
import { useHarness } from '../store';
import { useLibraryNames } from '../library/names';
import { McpServerMark, SkillMark } from './McpIcon';
import { mentionFor, mentionGroups, mentionOptions, mentionQuery, optionId, withoutQuery, type Mention, type MentionOption } from './mentions';

type MenuItem = MentionOption | { kind: 'permission' };

/** Above the thread composer while the text ends in `@` and part of a name: threads, windows, skills and MCP servers, grouped. */
export function MentionMenu({ menu }: { menu: ReturnType<typeof useMentionMenu> }) {
  if (!menu.isOpen) return null;
  const groups = mentionGroups(menu.items);
  return (
    <div id={menu.listId} role="listbox" aria-label="Reference a thread, window, skill or MCP server" className="absolute inset-x-0 bottom-full z-10 mb-2 flex max-h-80 flex-col gap-0.5 overflow-y-auto rounded-xl bg-popover p-1 shadow-overlay">
      {groups.map((group) => (
        <div key={group.kind} role="group" aria-label={group.label} className="flex flex-col gap-0.5">
          {groups.length > 1 && (
            <div aria-hidden className="px-2 pt-1.5 pb-0.5 type-caption text-subtle-foreground">
              {group.label}
            </div>
          )}
          {group.items.map((item) => {
            const i = menu.items.indexOf(item);
            return (
              <div
                key={itemKey(item)}
                id={`${menu.listId}-${i}`}
                role="option"
                aria-selected={i === menu.active}
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => menu.choose(item)}
                className="flex h-8 shrink-0 cursor-default items-center gap-2 rounded-md px-2 type-body hover:bg-accent/60 aria-selected:bg-accent"
              >
                <MentionItem item={item} />
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function MentionItem({ item }: { item: MenuItem }) {
  const names = useLibraryNames();
  if (item.kind === 'permission')
    return (
      <>
        <ShieldAlert className="size-4 shrink-0 text-warning" aria-hidden />
        <span className="shrink-0 font-medium">Allow screen recording</span>
        <span className="min-w-0 truncate text-muted-foreground">to reference other windows, then restart Mochi</span>
      </>
    );
  if (item.kind === 'window')
    return (
      <>
        <WindowIcon icon={item.window.icon} />
        <span className="min-w-0 truncate">{item.window.title}</span>
        {!!item.window.app && item.window.app !== item.window.title && <span className="ml-auto shrink-0 type-caption text-subtle-foreground">{item.window.app}</span>}
      </>
    );
  if (item.kind === 'skill')
    return (
      <>
        <SkillMark skill={item.skill.name} fallback={<Note className="size-4 shrink-0 text-info" aria-hidden />} />
        <span className="shrink-0 font-medium" title={item.skill.name}>
          {names.skill(item.skill.name).title}
        </span>
        <span className="min-w-0 truncate text-muted-foreground">{item.skill.description}</span>
      </>
    );
  if (item.kind === 'mcp')
    return (
      <>
        <McpServerMark server={item.server.name} url={item.server.url} />
        <span className="min-w-0 truncate font-medium" title={item.server.name}>
          {names.server(item.server.name).title}
        </span>
        <span className="ml-auto shrink-0 type-caption text-subtle-foreground tabular">{toolCountLabel(item.server)}</span>
      </>
    );
  return (
    <>
      <Chat className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0 truncate">{item.thread.title}</span>
      <span className="ml-auto shrink-0 type-caption text-subtle-foreground">{item.thread.repo?.project ?? 'No project'}</span>
    </>
  );
}

const TOOLS = new Intl.PluralRules('en');
function toolCountLabel(server: Pick<McpServer, 'toolCount' | 'status'>) {
  if (server.toolCount === undefined) return server.status === 'needs-auth' ? 'Needs sign-in' : 'Not started yet';
  return `${server.toolCount} ${TOOLS.select(server.toolCount) === 'one' ? 'tool' : 'tools'}`;
}

function WindowIcon({ icon }: { icon?: string }) {
  if (!icon) return <Window className="size-4 shrink-0 text-muted-foreground" aria-hidden />;
  return <img src={icon} alt="" className="size-4 shrink-0" />;
}

/** The picked references as removable chips inside the composer, above the text. A window chip shows its screenshot. */
export function MentionChips({ menu }: { menu: ReturnType<typeof useMentionMenu> }) {
  const names = useLibraryNames();
  if (menu.mentions.length === 0) return null;
  return (
    <ul aria-label="References" className="flex flex-wrap gap-1.5 px-3 pt-3">
      {menu.mentions.map((m) => (
        <li key={m.id} className="flex h-7 max-w-64 items-center gap-1.5 rounded-full border bg-background/40 pr-1 pl-1.5 type-meta">
          {m.kind === 'window' ? (
            <button type="button" aria-label={`View screenshot of ${m.title}`} onClick={() => openPhotos({ photos: [{ src: dataUrl(m.image), name: m.title }], index: 0 })} className="h-5 w-7 shrink-0 cursor-zoom-in overflow-hidden rounded-sm">
              <img src={dataUrl(m.image)} alt="" className="size-full object-cover object-top" />
            </button>
          ) : (
            <ChipIcon mention={m} />
          )}
          <span className={cn('min-w-0 truncate', (m.kind === 'skill' || m.kind === 'mcp') && 'text-info')} title={m.kind === 'skill' ? m.description : m.kind === 'mcp' ? m.title : undefined}>
            {m.kind === 'skill' ? names.skill(m.title).title : m.kind === 'mcp' ? names.server(m.title).title : m.title}
          </span>
          {m.kind === 'mcp' && m.toolCount !== undefined && <span className="shrink-0 type-caption text-subtle-foreground tabular">{m.toolCount}</span>}
          <button type="button" aria-label={`Remove ${m.title}`} onClick={() => menu.remove(m.id)} className="grid size-5 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground">
            <X className="size-3.5" />
          </button>
        </li>
      ))}
    </ul>
  );
}

function ChipIcon({ mention }: { mention: Exclude<Mention, { kind: 'window' }> }) {
  if (mention.kind === 'skill') return <SkillMark skill={mention.title} fallback={<Note className="size-4 shrink-0 text-info" aria-hidden />} />;
  if (mention.kind === 'mcp') return <McpServerMark server={mention.title} />;
  return <Chat className="size-4 shrink-0 text-muted-foreground" aria-hidden />;
}

/**
 * The menu's state, the picked references and the editor props that drive them: arrows move, Enter or Tab picks, Esc
 * closes until the text changes, Backspace in an empty input drops the last reference. Needs the composer's `PromptInputProvider`.
 */
export function useMentionMenu(selfId: string, skills: AgentCommand[], servers: McpServer[]) {
  const listId = useId();
  const { state } = useHarness();
  const { textInput } = usePromptInputController();
  const [active, setActive] = useState(0);
  const [dismissedAt, setDismissedAt] = useState<string>();
  const [mentions, setMentions] = useState<Mention[]>([]);
  const query = mentionQuery(textInput.value);
  const isQuerying = query !== null && dismissedAt !== textInput.value;
  const screen = useAppWindows(isQuerying);

  const picked = new Set(mentions.map((m) => m.id));
  const options = mentionOptions(query ?? '', state.threads, screen.windows, selfId, skills, servers).filter((o) => !picked.has(optionId(o)));
  const items: MenuItem[] = isBlocked(screen.access) ? [...options, { kind: 'permission' }] : options;
  const isOpen = isQuerying && items.length > 0;
  const current = items[Math.min(active, items.length - 1)];

  const add = (mention: Mention) => setMentions((all) => [...all.filter((m) => m.id !== mention.id), mention]);
  const choose = async (item: MenuItem) => {
    if (item.kind === 'permission') return host.windows.openScreenRecordingSettings();
    textInput.setInput(withoutQuery(textInput.value));
    setActive(0);
    if (item.kind !== 'window') return add(mentionFor(item));
    const image = await host.windows.captureApp(item.window.id);
    if (!image) return toast(`Couldn't capture "${item.window.title}"`, { description: 'The window closed or Mochi lost screen recording access.' });
    add({ kind: 'window', id: item.window.id, title: item.window.title, icon: item.window.icon, image });
  };
  const remove = (id: string) => setMentions((all) => all.filter((m) => m.id !== id));

  const onKeyDown = (e: KeyboardEvent) => {
    if (!isOpen) {
      if (e.key === 'Backspace' && textInput.value === '' && mentions.length) setMentions((all) => all.slice(0, -1));
      return;
    }
    const step = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
    if (step) setActive((i) => (i + step + items.length) % items.length);
    else if (e.key === 'Enter' || e.key === 'Tab') void choose(current);
    else if (e.key === 'Escape') setDismissedAt(textInput.value);
    else return setActive(0);
    e.preventDefault();
    e.stopPropagation();
  };

  const editorProps = {
    onKeyDown,
    attributes: { 'aria-autocomplete': 'list', 'aria-controls': isOpen ? listId : undefined, 'aria-activedescendant': isOpen ? `${listId}-${items.indexOf(current)}` : undefined },
  };
  // Edit on a queued message brings its references back beside any you already picked.
  const restore = (list: Mention[]) => setMentions((all) => [...all, ...list.filter((m) => !all.some((a) => a.id === m.id))]);
  return { listId, items, active, isOpen, choose, mentions, remove, restore, clear: () => setMentions([]), editorProps };
}

/** Other apps' windows, listed fresh each time the menu opens. */
function useAppWindows(isOpen: boolean) {
  const [screen, setScreen] = useState<{ access: ScreenAccess; windows: AppWindow[] }>({ access: 'unknown', windows: [] });
  useEffect(() => {
    if (!isOpen) return;
    let isCurrent = true;
    host.windows.listApps().then(
      (next) => isCurrent && setScreen(next),
      () => isCurrent && setScreen({ access: 'unknown', windows: [] }),
    );
    return () => {
      isCurrent = false;
    };
  }, [isOpen]);
  return screen;
}

const isBlocked = (access: ScreenAccess) => access === 'denied' || access === 'restricted';
const itemKey = (item: MenuItem) => (item.kind === 'permission' ? 'permission' : optionId(item));
const dataUrl = (image: AgentImage) => `data:${image.mediaType};base64,${image.data}`;
