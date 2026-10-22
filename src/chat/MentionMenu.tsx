import { useDeferredValue, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Chat, Note, ShieldAlert, Window, X } from '@/icons';
import { toast } from '@/toast/store';
import { cn } from '@/lib/utils';
import { usePromptInputController } from '@/components/ai-elements/prompt-input';
import { revealIn } from '@/lib/revealIn';
import { host } from '../host';
import { threadCwd } from '../host/cwd';
import { useFileList } from '../files/useFiles';
import { useRecentFiles } from '../pane/recentFiles';
import type { AgentImage } from '../host/types/agent';
import type { AppWindow, ScreenAccess } from '../host/types/windows';
import type { AgentCommand, McpServer, Thread } from '../model';
import { openPhotos } from '../photo/photos';
import { useHarnessSelector } from '../store';
import { isSameListing } from '../reorder';
import { useLibraryNames } from '../library/names';
import { FileMark } from './FileMark';
import { browseEntries, browseQuery, browseTarget, fileMentionFor, mentionTokens, parentDir, rankFiles, tokenText, worktreeMention } from './fileMentions';
import { McpServerMark, SkillMark } from './McpIcon';
import { isInline, mentionFor, mentionGroups, mentionOptions, mentionQuery, optionId, withoutQuery, type FileOption, type Mention, type MentionOption } from './mentions';

type MenuItem = MentionOption | { kind: 'permission' };

/**
 * Above the thread composer while the text ends in `@` and part of a name: the worktree's files, threads, windows, skills and
 * MCP servers, grouped. `@../`, `@~/` and `@/` turn it into a browser of that folder.
 */
export function MentionMenu({ menu }: { menu: ReturnType<typeof useMentionMenu> }) {
  const list = useRef<HTMLDivElement>(null);
  const current = menu.isOpen ? menu.items[menu.active] : undefined;
  useEffect(() => {
    const row = current && list.current?.querySelector(`[data-key="${CSS.escape(itemKey(current))}"]`);
    if (row) revealIn(list.current!, row);
  }, [current]);
  if (!menu.isOpen) return null;
  const groups = mentionGroups(menu.items);
  return (
    <div ref={list} id={menu.listId} role="listbox" aria-label="Reference a file, thread, window, skill or MCP server" className="absolute inset-x-0 bottom-full z-10 mb-2 flex max-h-80 flex-col gap-0.5 overflow-y-auto rounded-xl bg-popover p-1 shadow-overlay">
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
                data-key={itemKey(item)}
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
  if (item.kind === 'file')
    return (
      <>
        <FileMark name={item.name} isDir={item.mention.isDir} />
        <span className="max-w-[60%] shrink-0 truncate">{item.name}</span>
        <span className="min-w-0 truncate text-muted-foreground">{item.dir}</span>
      </>
    );
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
  const chips = menu.mentions.filter((m) => m.kind !== 'file' && m.kind !== 'thread');
  if (chips.length === 0) return null;
  return (
    <ul aria-label="References" className="flex flex-wrap gap-1.5 px-3 pt-3">
      {chips.map((m) => (
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
          <button type="button" aria-label={`Remove ${m.title}`} onClick={() => menu.remove(m.id)} className="grid size-5 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground">
            <X className="size-3.5" />
          </button>
        </li>
      ))}
    </ul>
  );
}

function ChipIcon({ mention }: { mention: Exclude<Mention, { kind: 'window' | 'file' | 'thread' }> }) {
  if (mention.kind === 'skill') return <SkillMark skill={mention.title} fallback={<Note className="size-4 shrink-0 text-info" aria-hidden />} />;
  return <McpServerMark server={mention.title} />;
}

/**
 * The menu's state, the picked references and the editor props that drive them: arrows move, Enter or Tab picks, Esc
 * closes until the text changes, Backspace in an empty input drops the last chip. While browsing a folder, Tab or `/` on a
 * folder enters it, and Backspace or ← on an empty segment goes up one. A picked file or thread goes into the text as a
 * token where the `@` was. Needs the composer's `PromptInputProvider`.
 */
export function useMentionMenu(selfId: string, skills: AgentCommand[], servers: McpServer[], files: MentionFiles = NO_FILES) {
  const listId = useId();
  const threads = useHarnessSelector((s) => s.threads, isSameListing);
  const { textInput } = usePromptInputController();
  const [active, setActive] = useState(0);
  const [dismissedAt, setDismissedAt] = useState<string>();
  const [picks, setMentions] = useState<Mention[]>([]);
  const text = textInput.value;
  // A file or thread whose token you deleted from the text is no longer a reference.
  const mentions = useMemo(() => picks.filter((m) => (m.kind === 'file' || m.kind === 'thread' ? mentionTokens(text, [m]).length > 0 : true)), [picks, text]);
  const query = mentionQuery(text);
  const isQuerying = query !== null && dismissedAt !== text;
  const browse = query === null ? null : browseQuery(query);
  const screen = useAppWindows(isQuerying && !browse);
  const fileOptions = useFileOptions(isQuerying ? query : null, files);

  const picked = new Set(mentions.map((m) => m.id));
  const others = browse ? [] : mentionOptions(query ?? '', threads, screen.windows, selfId, skills, servers).filter((o) => !picked.has(optionId(o)));
  const options = [...fileOptions, ...others];
  const items: MenuItem[] = !browse && isBlocked(screen.access) ? [...options, { kind: 'permission' }] : options;
  const isOpen = isQuerying && items.length > 0;
  const current = items[Math.min(active, items.length - 1)];

  const add = (mention: Mention) => setMentions((all) => [...all.filter((m) => m.id !== mention.id), mention]);
  const choose = async (item: MenuItem) => {
    if (item.kind === 'permission') return host.windows.openScreenRecordingSettings();
    setActive(0);
    if (item.kind === 'window') {
      textInput.setInput(withoutQuery(text));
      const image = await host.windows.captureApp(item.window.id);
      if (!image) return toast(`Couldn't capture "${item.window.title}"`, { description: 'The window closed or Mochi lost screen recording access.' });
      return add({ kind: 'window', id: item.window.id, title: item.window.title, icon: item.window.icon, image });
    }
    const mention = mentionFor(item);
    textInput.setInput(isInline(mention) ? `${withoutQuery(text)}${mention.kind === 'file' ? tokenText(mention.title) : `@${mention.title}`} ` : withoutQuery(text));
    add(mention);
  };
  const browseTo = (dir: string) => {
    setActive(0);
    textInput.setInput(`${withoutQuery(text)}@${dir}`);
  };
  const remove = (id: string) => setMentions((all) => all.filter((m) => m.id !== id));

  const onKeyDown = (e: KeyboardEvent) => {
    if (!isOpen) {
      const last = mentions.findLast((m) => !isInline(m));
      if (e.key === 'Backspace' && text === '' && last) remove(last.id);
      return;
    }
    const step = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
    const folder = browse && current.kind === 'file' && current.mention.isDir ? current.mention.title : null;
    const up = browse && browse.filter === '' ? parentDir(browse.dir) : null;
    if (step) setActive((i) => (i + step + items.length) % items.length);
    else if (folder && (e.key === 'Tab' || e.key === '/')) browseTo(folder);
    else if (up && (e.key === 'Backspace' || e.key === 'ArrowLeft')) browseTo(up);
    else if (e.key === 'Enter' || e.key === 'Tab') void choose(current);
    else if (e.key === 'Escape') setDismissedAt(text);
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
  const inlineMentions = useMemo(() => mentions.filter((m) => m.kind === 'file' || m.kind === 'thread'), [mentions]);
  return { listId, items, active, isOpen, choose, mentions, inlineMentions, remove, restore, clear: () => setMentions([]), editorProps };
}

/** Where `@` finds files: the folder the thread works in, and the files it opened or edited lately (relative, newest first). */
export type MentionFiles = { root: string | null; recent: string[] };
const NO_FILES: MentionFiles = { root: null, recent: [] };
const MAX_FILES = 8;
const MAX_BROWSE = 50;

export function useThreadMentionFiles(thread: Thread): MentionFiles {
  const root = threadCwd(thread);
  const recent = useRecentFiles(thread, root ?? '');
  return useMemo(() => ({ root, recent: recent.map((f) => f.path) }), [root, recent]);
}

/**
 * The file rows for `query` (null while the menu is shut). The worktree is listed once `@` is first typed and kept current by
 * the tree watcher; ranking runs on a deferred query so typing never waits on a large repo.
 */
function useFileOptions(query: string | null, { root, recent }: MentionFiles): FileOption[] {
  const [isUsed, setIsUsed] = useState(false);
  if (query !== null && !isUsed) setIsUsed(true);
  const { files } = useFileList(isUsed ? root : null);
  const deferred = useDeferredValue(query);
  const browse = deferred === null ? null : browseQuery(deferred);
  const folder = useFolder(browse && browseTarget(root, browse.dir), browse?.dir ?? null);
  const recentKey = recent.join('\n');
  return useMemo(() => {
    if (deferred === null) return [];
    if (browse) {
      if (!folder) return [];
      const filter = folder.dir === browse.dir ? browse.filter : '';
      return browseEntries(folder.dirs, folder.files, filter, MAX_BROWSE).map((e) => ({ kind: 'file', mention: fileMentionFor(root, folder.dir, folder.path, e.name, e.isDir), name: e.isDir ? `${e.name}/` : e.name, dir: folder.dir }));
    }
    return rankFiles(files ?? [], deferred, recentKey ? recentKey.split('\n') : [], MAX_FILES).map((path) => {
      const cut = path.lastIndexOf('/') + 1;
      return { kind: 'file', mention: worktreeMention(path), name: path.slice(cut), dir: path.slice(0, cut) };
    });
  }, [deferred, browse?.dir, browse?.filter, folder, files, recentKey, root]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** A browsed folder's listing, the last one kept while the next loads so the menu doesn't blink between folders. */
function useFolder(target: string | null, dir: string | null) {
  const [folder, setFolder] = useState<{ dir: string; path: string; dirs: string[]; files: string[] } | null>(null);
  useEffect(() => {
    if (target === null || dir === null) return;
    let isCurrent = true;
    host.fs.entries(target).then(
      (listed) => isCurrent && setFolder(listed && { dir, ...listed }),
      () => isCurrent && setFolder(null),
    );
    return () => {
      isCurrent = false;
    };
  }, [target, dir]);
  return target === null ? null : folder;
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
