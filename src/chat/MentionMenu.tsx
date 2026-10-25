import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  useDeferredValue,
  useEffect,
  useEffectEvent,
  useId,
  useRef,
  useState,
} from 'react';
import type { EditorView } from '@codemirror/view';
import { Chat, Plug, ShieldAlert, Skill, Window, X } from '@/icons';
import { toast } from '@/toast/store';
import { cn } from '@/lib/utils';
import { usePromptInputController } from '@/components/ai-elements/prompt-input';
import { CommandGroup, CommandItem } from '@/components/ui/command';
import { host } from '../host';
import { threadCwd } from '../host/cwd';
import { useFileList } from '../files/useFiles';
import { useRecentFiles } from '../pane/recentFiles';
import type { AgentImage } from '../host/types/agent';
import type { ScreenAccess } from '../host/types/windows';
import type { AgentCommand, McpServer, Thread } from '../model';
import { openPhotos } from '../photo/photos';
import { useHarnessSelector } from '../store';
import { isSameListing } from '../reorder';
import { useLibraryNames } from '../library/names';
import { CaretMenu, forwardKey } from './CaretMenu';
import { MENTION_DROP_EVENT, useDragSelector } from '../layout/drag';
import { isInside } from '../pane/headerPins';
import { FileMark } from './FileMark';
import {
  browseEntries,
  browseQuery,
  browseTarget,
  fileMentionFor,
  mentionTokens,
  parentDir,
  rankFiles,
  tokenText,
  worktreeMention,
} from './fileMentions';
import { McpServerMark, PluginMark, SkillMark } from './McpIcon';
import {
  isInline,
  mentionFor,
  mentionGroups,
  mentionOptions,
  mentionQuery,
  optionId,
  withoutQuery,
  type FileOption,
  type Mention,
  type MentionOption,
} from './mentions';
import { queryKeys } from '../queryKeys';

type MenuItem = MentionOption | { kind: 'permission' };

/**
 * Above the caret while the text ends in `@` and part of a name: the worktree's files, threads, windows, skills,
 * connectors and plugins, grouped. `@../`, `@~/` and `@/` turn it into a browser of that folder.
 */
export function MentionMenu({
  menu,
}: {
  menu: ReturnType<typeof useMentionMenu>;
}) {
  const groups = mentionGroups(menu.items);
  return (
    <CaretMenu
      isOpen={menu.isOpen}
      editor={menu.editor}
      listRef={menu.listRef}
      listId={menu.listId}
      label="Reference a file, thread, window, skill, connector or plugin"
      value={menu.activeKey}
      onValueChange={menu.setActiveKey}
      onDismiss={menu.dismiss}
    >
      {groups.map((group) => (
        <CommandGroup
          key={group.kind}
          heading={groups.length > 1 ? group.label : undefined}
        >
          {group.items.map((item) => (
            <CommandItem
              key={itemKey(item)}
              value={itemKey(item)}
              onSelect={() => menu.choose(item)}
              className="h-8 rounded-md type-body"
            >
              <MentionItem item={item} />
            </CommandItem>
          ))}
        </CommandGroup>
      ))}
    </CaretMenu>
  );
}

function MentionItem({ item }: { item: MenuItem }) {
  const names = useLibraryNames();
  if (item.kind === 'file')
    return (
      <>
        <FileMark name={item.name} isDir={item.mention.isDir} />
        <span className="max-w-[60%] shrink-0 truncate">{item.name}</span>
        <span className="min-w-0 truncate text-muted-foreground">
          {item.dir}
        </span>
      </>
    );
  if (item.kind === 'permission')
    return (
      <>
        <ShieldAlert className="size-4 shrink-0 text-warning" aria-hidden />
        <span className="shrink-0 font-medium">Allow screen recording</span>
        <span className="min-w-0 truncate text-muted-foreground">
          to reference other windows, then restart Mochi
        </span>
      </>
    );
  if (item.kind === 'window')
    return (
      <>
        <WindowIcon icon={item.window.icon} />
        <span className="min-w-0 truncate">{item.window.title}</span>
        {!!item.window.app && item.window.app !== item.window.title && (
          <span className="ml-auto shrink-0 type-caption text-subtle-foreground">
            {item.window.app}
          </span>
        )}
      </>
    );
  if (item.kind === 'skill')
    return (
      <>
        <SkillMark skill={item.skill.name} fallback={<SkillFallback />} />
        <span className="shrink-0 font-medium" title={item.skill.name}>
          {names.skill(item.skill.name).title}
        </span>
        <span className="min-w-0 truncate text-muted-foreground">
          {item.skill.description}
        </span>
      </>
    );
  if (item.kind === 'mcp')
    return (
      <>
        <McpServerMark server={item.server.name} url={item.server.url} />
        <span className="min-w-0 truncate font-medium" title={item.server.name}>
          {names.server(item.server.name).title}
        </span>
        <span className="ml-auto shrink-0 type-caption text-subtle-foreground tabular">
          {toolCountLabel(item.server)}
        </span>
      </>
    );
  if (item.kind === 'plugin')
    return (
      <>
        <PluginMark plugin={item.plugin} fallback={<PluginFallback />} />
        <span className="min-w-0 truncate font-medium" title={item.plugin}>
          {names.plugin(item.plugin).title}
        </span>
      </>
    );
  return (
    <>
      <Chat className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0 truncate">{item.thread.title}</span>
      <span className="ml-auto shrink-0 type-caption text-subtle-foreground">
        {item.thread.repo?.project ?? 'No project'}
      </span>
    </>
  );
}

/** The lightbulb every skill without its own icon wears, here and in the `/` menu. */
export function SkillFallback() {
  return (
    <Skill className="size-4 shrink-0 text-muted-foreground" aria-hidden />
  );
}

function PluginFallback() {
  return <Plug className="size-4 shrink-0 text-muted-foreground" aria-hidden />;
}

const TOOLS = new Intl.PluralRules('en');
function toolCountLabel(server: Pick<McpServer, 'toolCount' | 'status'>) {
  if (server.toolCount === undefined)
    return server.status === 'needs-auth' ? 'Needs sign-in' : 'Not started yet';
  return `${server.toolCount} ${TOOLS.select(server.toolCount) === 'one' ? 'tool' : 'tools'}`;
}

function WindowIcon({ icon }: { icon?: string }) {
  if (!icon)
    return (
      <Window className="size-4 shrink-0 text-muted-foreground" aria-hidden />
    );
  return <img src={icon} alt="" className="size-4 shrink-0" />;
}

/** The picked references as removable chips inside the composer, above the text. A window chip shows its screenshot. */
export function MentionChips({
  menu,
}: {
  menu: ReturnType<typeof useMentionMenu>;
}) {
  const names = useLibraryNames();
  const chips = menu.mentions.filter(
    (m) => m.kind !== 'file' && m.kind !== 'thread',
  );
  if (chips.length === 0) return null;
  return (
    <ul aria-label="References" className="flex flex-wrap gap-1.5 px-3 pt-3">
      {chips.map((m) => (
        <li
          key={m.id}
          className="flex h-7 max-w-64 items-center gap-1.5 rounded-full border bg-background/40 pr-1 pl-1.5 type-meta"
        >
          {m.kind === 'window' ? (
            <button
              type="button"
              aria-label={`View screenshot of ${m.title}`}
              onClick={() =>
                openPhotos({
                  photos: [{ src: dataUrl(m.image), name: m.title }],
                  index: 0,
                })
              }
              className="h-5 w-7 shrink-0 cursor-zoom-in overflow-hidden rounded-sm"
            >
              <img
                src={dataUrl(m.image)}
                alt=""
                className="size-full object-cover object-top"
              />
            </button>
          ) : (
            <ChipIcon mention={m} />
          )}
          <span
            className={cn(
              'min-w-0 truncate',
              m.kind !== 'window' && 'text-info',
            )}
            title={
              m.kind === 'skill'
                ? m.description
                : m.kind === 'mcp' || m.kind === 'plugin'
                  ? m.title
                  : undefined
            }
          >
            {m.kind === 'skill'
              ? names.skill(m.title).title
              : m.kind === 'mcp'
                ? names.server(m.title).title
                : m.kind === 'plugin'
                  ? names.plugin(m.title).title
                  : m.title}
          </span>
          {m.kind === 'mcp' && m.toolCount !== undefined && (
            <span className="shrink-0 type-caption text-subtle-foreground tabular">
              {m.toolCount}
            </span>
          )}
          <button
            type="button"
            aria-label={`Remove ${m.title}`}
            onClick={() => menu.remove(m.id)}
            className="grid size-5 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        </li>
      ))}
    </ul>
  );
}

function ChipIcon({
  mention,
}: {
  mention: Exclude<Mention, { kind: 'window' | 'file' | 'thread' }>;
}) {
  if (mention.kind === 'skill')
    return <SkillMark skill={mention.title} fallback={<SkillFallback />} />;
  if (mention.kind === 'plugin')
    return <PluginMark plugin={mention.title} fallback={<PluginFallback />} />;
  return <McpServerMark server={mention.title} />;
}

/**
 * The menu's state, the picked references and the editor props that drive them: arrows move (cmdk does the moving), Enter or Tab picks, Esc
 * closes until the text changes, Backspace in an empty input drops the last chip. While browsing a folder, Tab or `/` on a
 * folder enters it, and Backspace or ← on an empty segment goes up one. A picked file or thread goes into the text as a
 * token where the `@` was. Needs the composer's `PromptInputProvider`.
 */
export function useMentionMenu(
  selfId: string,
  skills: AgentCommand[],
  servers: McpServer[],
  plugins: string[],
  files: MentionFiles = NO_FILES,
) {
  const listId = useId();
  const threads = useHarnessSelector((s) => s.threads, isSameListing);
  const { textInput } = usePromptInputController();
  const [activeKey, setActiveKey] = useState<string>();
  const listRef = useRef<HTMLDivElement>(null);
  const editor = useRef<EditorView>(null);
  const [dismissedAt, setDismissedAt] = useState<string>();
  const [picks, setMentions] = useState<Mention[]>([]);
  const text = textInput.value;
  // A file or thread whose token you deleted from the text is no longer a reference.
  const mentions = picks.filter((m) =>
    m.kind === 'file' || m.kind === 'thread'
      ? mentionTokens(text, [m]).length > 0
      : true,
  );
  const query = mentionQuery(text);
  const isQuerying = query !== null && dismissedAt !== text;
  const browse = query === null ? null : browseQuery(query);
  const screen = useAppWindows(isQuerying && !browse);
  const fileOptions = useFileOptions(isQuerying ? query : null, files);

  const picked = new Set(mentions.map((m) => m.id));
  const others = browse
    ? []
    : mentionOptions(
        query ?? '',
        threads,
        screen.windows,
        selfId,
        skills,
        servers,
        plugins,
      ).filter((o) => !picked.has(optionId(o)));
  const options = [...fileOptions, ...others];
  const items: MenuItem[] =
    !browse && isBlocked(screen.access)
      ? [...options, { kind: 'permission' }]
      : options;
  const isOpen = isQuerying && items.length > 0;
  const current = items.find((item) => itemKey(item) === activeKey) ?? items[0];

  const add = (mention: Mention) =>
    setMentions((all) => [...all.filter((m) => m.id !== mention.id), mention]);
  const choose = async (item: MenuItem) => {
    if (item.kind === 'permission')
      return host.windows.openScreenRecordingSettings();
    setActiveKey(undefined);
    if (item.kind === 'window') {
      textInput.setInput(withoutQuery(text));
      const image = await host.windows.captureApp(item.window.id);
      if (!image)
        return toast(`Couldn't capture "${item.window.title}"`, {
          description:
            'The window closed or Mochi lost screen recording access.',
        });
      return add({
        kind: 'window',
        id: item.window.id,
        title: item.window.title,
        icon: item.window.icon,
        image,
      });
    }
    const mention = mentionFor(item);
    textInput.setInput(
      isInline(mention)
        ? `${withoutQuery(text)}${mention.kind === 'file' ? tokenText(mention.title) : `@${mention.title}`} `
        : withoutQuery(text),
    );
    add(mention);
  };
  const browseTo = (dir: string) => {
    setActiveKey(undefined);
    textInput.setInput(`${withoutQuery(text)}@${dir}`);
  };
  const remove = (id: string) =>
    setMentions((all) => all.filter((m) => m.id !== id));
  /** A thread dropped on the composer: its token at the end of the text, as if picked from the menu. */
  const mentionThread = (threadId: string) => {
    const thread = threads.find((t) => t.id === threadId);
    if (!thread || thread.id === selfId) return;
    const mention = mentionFor({ kind: 'thread', thread });
    textInput.setInput(
      `${text}${text && !/\s$/.test(text) ? ' ' : ''}@${mention.title} `,
    );
    add(mention);
  };

  const onKeyDown = (e: KeyboardEvent, view?: EditorView) => {
    if (view) editor.current = view;
    if (!isOpen) {
      const last = mentions.findLast((m) => !isInline(m));
      if (e.key === 'Backspace' && text === '' && last) remove(last.id);
      return;
    }
    const folder =
      browse && current.kind === 'file' && current.mention.isDir
        ? current.mention.title
        : null;
    const up = browse && browse.filter === '' ? parentDir(browse.dir) : null;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp')
      forwardKey(listRef.current, e);
    else if (folder && (e.key === 'Tab' || e.key === '/')) browseTo(folder);
    else if (up && (e.key === 'Backspace' || e.key === 'ArrowLeft'))
      browseTo(up);
    else if (e.key === 'Enter' || e.key === 'Tab') void choose(current);
    else return setActiveKey(undefined);
    e.preventDefault();
    e.stopPropagation();
  };

  const editorProps = {
    onKeyDown,
    attributes: {
      'aria-autocomplete': 'list',
      'aria-controls': isOpen ? listId : undefined,
    },
  };
  // Edit on a queued message brings its references back beside any you already picked.
  const restore = (list: Mention[]) =>
    setMentions((all) => [
      ...all,
      ...list.filter((m) => !all.some((a) => a.id === m.id)),
    ]);
  const inlineMentions = mentions.filter(
    (m) => m.kind === 'file' || m.kind === 'thread',
  );
  return {
    listId,
    items,
    activeKey: current && itemKey(current),
    setActiveKey,
    dismiss: () => setDismissedAt(text),
    editor,
    listRef,
    isOpen,
    choose,
    mentions,
    inlineMentions,
    remove,
    mentionThread,
    restore,
    clear: () => setMentions([]),
    editorProps,
  };
}

/**
 * Makes the composer a drop target for a thread dragged from the sidebar: `isOver` while one hovers it, and the drop mentions
 * that thread (`mentionThread`). Spread `dropProps` on the composer card.
 */
export function useThreadMentionDrop(menu: ReturnType<typeof useMentionMenu>) {
  // A callback ref: the composer can mount after this hook does (a new thread's composer waits for its project step).
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const isOver = useDragSelector(
    (s) => s?.view.kind === 'thread' && !!el && isInside(el, s.x, s.y),
  );
  const mentionThread = useEffectEvent((threadId: string) =>
    menu.mentionThread(threadId),
  );
  useEffect(() => {
    if (!el) return;
    const onDrop = (e: Event) =>
      mentionThread((e as CustomEvent<string>).detail);
    el.addEventListener(MENTION_DROP_EVENT, onDrop);
    return () => el.removeEventListener(MENTION_DROP_EVENT, onDrop);
  }, [el]);
  return {
    ref: setEl,
    'data-mention-drop': '',
    'data-mention-over': isOver || undefined,
  };
}

/** Where `@` finds files: the folder the thread works in, and the files it opened or edited lately (relative, newest first). */
export type MentionFiles = { root: string | null; recent: string[] };
const NO_FILES: MentionFiles = { root: null, recent: [] };
const MAX_FILES = 8;
const MAX_BROWSE = 50;

export function useThreadMentionFiles(thread: Thread): MentionFiles {
  const root = threadCwd(thread);
  const recent = useRecentFiles(thread, root ?? '');
  return { root, recent: recent.map((f) => f.path) };
}

/**
 * The file rows for `query` (null while the menu is shut). The worktree is listed once `@` is first typed and kept current by
 * the tree watcher; ranking runs on a deferred query so typing never waits on a large repo.
 */
function useFileOptions(
  query: string | null,
  { root, recent }: MentionFiles,
): FileOption[] {
  const [isUsed, setIsUsed] = useState(false);
  if (query !== null && !isUsed) setIsUsed(true);
  const { files } = useFileList(isUsed ? root : null);
  const deferred = useDeferredValue(query);
  const browse = deferred === null ? null : browseQuery(deferred);
  const folder = useFolder(
    browse && browseTarget(root, browse.dir),
    browse?.dir ?? null,
  );
  if (deferred === null) return [];
  if (browse) {
    if (!folder) return [];
    const filter = folder.dir === browse.dir ? browse.filter : '';
    return browseEntries(folder.dirs, folder.files, filter, MAX_BROWSE).map(
      (e) => ({
        kind: 'file',
        mention: fileMentionFor(root, folder.dir, folder.path, e.name, e.isDir),
        name: e.isDir ? `${e.name}/` : e.name,
        dir: folder.dir,
      }),
    );
  }
  return rankFiles(files ?? [], deferred, recent, MAX_FILES).map((path) => {
    const cut = path.lastIndexOf('/') + 1;
    return {
      kind: 'file',
      mention: worktreeMention(path),
      name: path.slice(cut),
      dir: path.slice(0, cut),
    };
  });
}

/** A browsed folder's listing, the last one kept while the next loads so the menu doesn't blink between folders. */
function useFolder(target: string | null, dir: string | null) {
  const folderQuery = useQuery({
    queryKey: queryKeys.chat.folderEntries(target, dir),
    queryFn: async () => {
      const listed = await host.fs.entries(target!);
      return listed && { dir: dir!, ...listed };
    },
    enabled: target !== null && dir !== null,
    placeholderData: keepPreviousData,
  });
  return target === null ? null : (folderQuery.data ?? null);
}

/** Other apps' windows, listed fresh each time the menu opens. */
function useAppWindows(isOpen: boolean) {
  const windowsQuery = useQuery({
    queryKey: queryKeys.chat.appWindows(),
    queryFn: () => host.windows.listApps(),
    enabled: isOpen,
    staleTime: 0,
  });
  return windowsQuery.data ?? { access: 'unknown' as const, windows: [] };
}

const isBlocked = (access: ScreenAccess) =>
  access === 'denied' || access === 'restricted';
const itemKey = (item: MenuItem) =>
  item.kind === 'permission' ? 'permission' : optionId(item);
const dataUrl = (image: AgentImage) =>
  `data:${image.mediaType};base64,${image.data}`;
