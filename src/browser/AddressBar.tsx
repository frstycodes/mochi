import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { ArrowUpRight, Globe, Monitor, SearchAlt } from '@/icons';
import { Command, CommandItem, CommandList } from '@/components/ui/command';
import { Input } from '@/components/ui/input';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { host } from '@/host';
import { threadCwd } from '@/host/cwd';
import type { Thread } from '@/model';
import { usePrefs } from '../settings/prefs';
import { useHarness } from '../store';
import { usePorts } from '../terminal/ports';
import { usePaneOpeners } from '../terminal/usePaneOpeners';
import { TooltipIconButton } from '../ui';
import { historyTitle, pageKey, updatePage, useAddressHistory, type Page } from './pages';
import { openExternally, openInLabel } from './systemBrowser';
import { bare, inlineCompletion, rankSuggestions, type Candidate } from './suggest';
import { displayUrl, normalizeUrl, SEARCH_ENGINES } from './url';

const SUGGEST_DEBOUNCE_MS = 120;
const NONE: string[] = [];

type Row = { value: string; url: string; label: string; detail: string; icon: 'site' | 'server' | 'search' | 'go'; tabId?: string };

/**
 * The address field with suggestions under it: what you typed (go or search), open tabs, the thread's dev servers, history and
 * the search engine's suggestions; arrows move, Enter opens, the top URL match completes inline (→ or End accepts it).
 */
export function AddressBar({ thread, pageId, page }: { thread: Thread; pageId: string; page: Page }) {
  const { dispatch } = useHarness();
  const inputRef = useRef<HTMLInputElement>(null);
  const anchorRef = useRef<HTMLFormElement>(null);
  const [typed, setTyped] = useState<string | null>(null);
  const [completion, setCompletion] = useState('');
  const [selected, setSelected] = useState('');
  const candidates = useCandidates(thread, pageId);
  // Focusing selects the page's URL; until you type, the list shows what's open, running and recent.
  const query = typed === null || typed === page.url ? '' : typed;
  const remote = useSearchSuggestions(query);
  const rows = useRows(query, completion, candidates, remote);
  const isOpen = typed !== null && rows.length > 0;

  useLayoutEffect(() => {
    if (completion && typed) inputRef.current?.setSelectionRange(typed.length, typed.length + completion.length);
  }, [typed, completion]);
  useEffect(() => setSelected(rows[0]?.value ?? ''), [rows]);

  const finish = () => {
    setTyped(null);
    setCompletion('');
    inputRef.current?.blur();
  };
  const open = (row: Row) => {
    if (row.tabId) dispatch({ type: 'pane-select-tab', threadId: thread.id, tabId: row.tabId });
    else {
      updatePage(pageId, { url: row.url, error: null });
      if (page.hostId) void host.browser.navigate(page.hostId, row.url);
    }
    finish();
  };
  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setTyped(value);
    // Deleting never completes again, or Backspace could never remove the completed part.
    const isDelete = (e.nativeEvent as InputEvent).inputType?.startsWith('delete');
    const match = isDelete ? undefined : rankSuggestions(value, candidates).find((c) => inlineCompletion(value, c.url));
    setCompletion(match ? inlineCompletion(value, match.url)! : '');
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // cmdk takes Home and End for the list; in a text field they move the caret.
    if (e.key === 'Home' || e.key === 'End') e.stopPropagation();
    if ((e.key === 'ArrowRight' || e.key === 'End') && completion && typed !== null) {
      setTyped(typed + completion);
      setCompletion('');
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      finish();
    }
  };

  return (
    <Popover open={isOpen} onOpenChange={(next) => !next && finish()}>
      <Command shouldFilter={false} loop vimBindings={false} value={selected} onValueChange={setSelected} className="mx-1 size-auto min-w-0 flex-1 overflow-visible rounded-none! bg-transparent p-0">
        <PopoverAnchor asChild>
          <form ref={anchorRef} onSubmit={(e) => e.preventDefault()} className="group/address relative">
            <Input
              ref={inputRef}
              aria-label="Address"
              aria-autocomplete="both"
              aria-expanded={isOpen}
              role="combobox"
              spellCheck={false}
              autoCapitalize="off"
              autoComplete="off"
              value={typed === null ? displayUrl(page.url) : typed + completion}
              onFocus={(e) => {
                setTyped(page.url);
                requestAnimationFrame(() => e.target.select());
              }}
              onBlur={finish}
              onChange={onChange}
              onKeyDown={onKeyDown}
              className="h-7 truncate rounded-full border-transparent bg-muted px-3 type-caption text-muted-foreground focus-visible:text-foreground dark:bg-muted"
            />
            {typed === null && /^https?:/i.test(page.url) && <OpenExternalButton url={page.url} />}
          </form>
        </PopoverAnchor>
        <PopoverContent
          align="start"
          sideOffset={6}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onInteractOutside={(e) => anchorRef.current?.contains(e.target as Node) && e.preventDefault()}
          // Keeps focus in the field, so a click on a row lands before the field's blur closes the list.
          onMouseDown={(e) => e.preventDefault()}
          className="w-(--radix-popover-trigger-width) min-w-72 p-1"
        >
          <CommandList>
            {rows.map((row) => (
              <CommandItem key={row.value} value={row.value} onSelect={() => open(row)} className="gap-2.5 rounded-[calc(var(--radius-xl)-var(--spacing)*var(--corner-scale))]">
                <RowIcon row={row} />
                <span className="min-w-0 truncate text-foreground">{row.label}</span>
                {!!row.detail && <span className="min-w-0 shrink-[2] truncate type-caption text-muted-foreground">{row.detail}</span>}
                {!!row.tabId && <span className="ml-auto shrink-0 type-caption text-muted-foreground">Switch to tab</span>}
              </CommandItem>
            ))}
          </CommandList>
        </PopoverContent>
      </Command>
    </Popover>
  );
}

/** The thread's other browser tabs, its running dev servers and the address history, as one list to rank. */
function useCandidates(thread: Thread, pageId: string) {
  const { state } = useHarness();
  const history = useAddressHistory();
  const { openPort } = usePaneOpeners(thread.id);
  const { ports } = usePorts(thread.id, threadCwd(thread) ?? null, openPort);
  const tabs = state.panes.find((p) => p.threadId === thread.id)?.tabs;
  return useMemo<Candidate[]>(
    () => [
      ...(tabs ?? []).filter((t) => t.kind === 'browser' && !!t.url && pageKey(thread.id, t.id) !== pageId).map((t) => ({ kind: 'tab' as const, url: t.url!, title: t.title ?? '', tabId: t.id })),
      ...(ports ?? []).map((p) => ({ kind: 'server' as const, url: `http://localhost:${p.port}`, title: p.command })),
      ...history.map((url) => ({ kind: 'history' as const, url, title: historyTitle(url) })),
    ],
    [tabs, ports, history, thread.id, pageId],
  );
}

/** The engine's suggestions for `query`, kept while the next keystroke's answer is on its way so the list doesn't blink. */
function useSearchSuggestions(query: string) {
  const { searchEngine } = usePrefs();
  const [result, setResult] = useState({ query: '', list: [] as string[] });
  useEffect(() => {
    if (!query.trim() || /^[a-z]+:\/\//i.test(query)) return;
    const timer = setTimeout(() => void host.browser.suggest(searchEngine, query).then((list) => setResult({ query, list }), () => {}), SUGGEST_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, searchEngine]);
  return query && query.startsWith(result.query) ? result.list : NONE;
}

function useRows(query: string, completion: string, candidates: Candidate[], remote: string[]) {
  const { searchEngine } = usePrefs();
  return useMemo(() => {
    const engine = SEARCH_ENGINES[searchEngine];
    const ranked = rankSuggestions(query, candidates);
    // With an inline completion the completed page is the top row, so Enter opens what the field shows.
    const completed = completion ? ranked.find((c) => bare(c.url).toLowerCase() === (query + completion).toLowerCase()) : undefined;
    const target = query && normalizeUrl(query, searchEngine);
    const isSearch = !!target && target.startsWith(engine.url);
    const typedRow: Row[] = !query || completed ? [] : [{ value: `go:${target}`, url: target, label: isSearch ? query : displayUrl(target), detail: isSearch ? `Search ${engine.name}` : '', icon: isSearch ? 'search' : 'go' }];
    const pages = (completed ? [completed, ...ranked.filter((c) => c !== completed)] : ranked).map(
      (c): Row => ({ value: `${c.kind}:${c.url}`, url: c.url, label: c.kind === 'server' ? bare(c.url) : c.title || bare(c.url), detail: c.kind === 'server' ? c.title : c.title ? bare(c.url) : '', icon: c.kind === 'server' ? 'server' : 'site', tabId: c.tabId }),
    );
    const searches = remote
      .filter((s) => s.toLowerCase() !== query.toLowerCase())
      .slice(0, 4)
      .map((s): Row => ({ value: `search:${s}`, url: engine.url + encodeURIComponent(s), label: s, detail: '', icon: 'search' }));
    return [...typedRow, ...pages, ...searches];
  }, [query, completion, candidates, remote, searchEngine]);
}

/** Sits over the field's right end, shown while the bar is hovered or the button has keyboard focus. */
function OpenExternalButton({ url }: { url: string }) {
  return (
    <TooltipIconButton
      label={openInLabel()}
      // Keeps the click from focusing the field, which would select the URL and open the suggestions.
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => openExternally(url)}
      className="absolute inset-y-0.5 right-0.5 h-auto rounded-full bg-muted text-muted-foreground opacity-0 transition-[opacity,color] group-hover/address:opacity-100 hover:bg-muted hover:text-foreground focus-visible:opacity-100 dark:hover:bg-muted"
    >
      <ArrowUpRight aria-hidden className="size-3.5" />
    </TooltipIconButton>
  );
}

function RowIcon({ row }: { row: Row }) {
  if (row.icon === 'search') return <SearchAlt className="text-muted-foreground" />;
  if (row.icon === 'go') return <Globe className="text-muted-foreground" />;
  if (row.icon === 'server' || isLocal(row.url)) return <Monitor className="text-muted-foreground" />;
  return <SiteIcon url={row.url} />;
}

/** The site's own /favicon.ico (never a third-party favicon service, which would learn your history), a globe when it has none. */
function SiteIcon({ url }: { url: string }) {
  const [hasFailed, setFailed] = useState(false);
  const origin = useMemo(() => {
    try {
      return new URL(url).origin;
    } catch {
      return null;
    }
  }, [url]);
  if (!origin || hasFailed) return <Globe className="text-muted-foreground" />;
  return <img src={`${origin}/favicon.ico`} alt="" aria-hidden referrerPolicy="no-referrer" onError={() => setFailed(true)} className="size-4 shrink-0 rounded-xs" />;
}

function isLocal(url: string) {
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0|[\w.-]+\.(localhost|test))(:\d+)?(\/|$)/i.test(url);
}
