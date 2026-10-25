import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Search } from '@/icons';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Toggle } from '@/components/ui/toggle';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { SearchOptions } from '@/host/types/fs';
import { revealIn } from '@/lib/revealIn';
import { ContentResults, contentHits } from './ContentResults';
import { FileTree } from './FileTree';
import { ancestors, buildTree, filterFiles, visibleRows } from './tree';
import { useContentSearch } from './useContentSearch';

export interface FileTarget {
  path: string;
  line?: number;
  /** Columns of a search match on `line`, selected when the file opens. */
  column?: [number, number];
}

const SEARCH_PREFIX = '?';

/** The tree with one input on top: typing filters it by name, `?` searches file contents instead. */
export function FileFinder({ root, files, selected, query, onQueryChange, focusKey, onOpen }: { root: string; files: string[]; selected: string | null; query: string; onQueryChange: (query: string) => void; focusKey: number; onOpen: (target: FileTarget) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const isContentSearch = query.startsWith(SEARCH_PREFIX);
  const [options, setOptions] = useState<SearchOptions>({ isCaseSensitive: false, isRegex: false, isWholeWord: false });
  const tree = useTreeFilter(files, isContentSearch ? '' : query, selected);
  const search = useContentSearch(root, isContentSearch ? query.slice(SEARCH_PREFIX.length) : '', options);
  const hits = contentHits(search.files);
  const [activeHit, moveHit] = useActiveHit(query, options);
  useEffect(() => {
    if (focusKey) input.current?.select();
  }, [focusKey]);
  const activeKey = isContentSearch ? `hit:${activeHit}` : `path:${tree.active}`;
  useEffect(() => {
    const viewport = scroller.current?.querySelector<HTMLElement>('[data-slot=scroll-area-viewport]');
    const row = viewport?.querySelector(`[data-key="${CSS.escape(activeKey)}"]`);
    if (viewport && row) revealIn(viewport, row);
  }, [activeKey]);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && query) {
      e.preventDefault();
      return onQueryChange('');
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Enter') return;
    e.preventDefault();
    const step = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
    if (isContentSearch) {
      if (step) return moveHit(step, hits.length);
      const hit = hits[activeHit];
      return hit && onOpen({ path: hit.path, line: hit.line.line, column: hit.line.column });
    }
    if (step) return tree.move(step);
    if (tree.active) tree.activate(tree.active, (path) => onOpen({ path }));
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-11 shrink-0 items-center px-1.5">
        <InputGroup>
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
          <InputGroupInput ref={input} value={query} onChange={(e) => onQueryChange(e.target.value)} onKeyDown={onKeyDown} placeholder="Filter, or ? to search in files" aria-label="Filter files, or start with ? to search in files" spellCheck={false} />
          {isContentSearch && (
            <InputGroupAddon align="inline-end" className="gap-0.5">
              <OptionToggle label="Match case" text="Aa" pressed={options.isCaseSensitive} onPressedChange={(isCaseSensitive) => setOptions({ ...options, isCaseSensitive })} />
              <OptionToggle label="Match whole word" text="ab" pressed={options.isWholeWord} onPressedChange={(isWholeWord) => setOptions({ ...options, isWholeWord })} />
              <OptionToggle label="Use regular expression" text=".*" pressed={options.isRegex} onPressedChange={(isRegex) => setOptions({ ...options, isRegex })} />
            </InputGroupAddon>
          )}
        </InputGroup>
      </div>
      <ScrollArea ref={scroller} type="scroll" className="min-h-0 flex-1">
        {isContentSearch ? (
          <ContentResults search={search} hits={hits} active={activeHit} onOpen={onOpen} />
        ) : tree.rows.length === 0 && query ? (
          <p className="px-3 type-caption text-muted-foreground">No file name matches. Start with ? to search inside files.</p>
        ) : (
          <FileTree root={root} rows={tree.rows} isExpanded={tree.isExpanded} selected={selected} active={tree.active} highlights={tree.highlights} onToggle={tree.toggle} onSelect={(path) => onOpen({ path })} />
        )}
      </ScrollArea>
    </div>
  );
}

function OptionToggle({ label, text, pressed, onPressedChange }: { label: string; text: string; pressed: boolean; onPressedChange: (pressed: boolean) => void }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Toggle size="sm" aria-label={label} pressed={pressed} onPressedChange={onPressedChange} className="h-5 min-w-5 px-1 font-mono type-caption text-muted-foreground aria-pressed:bg-input aria-pressed:text-foreground">
          {text}
        </Toggle>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/** Tree rows for the name filter: matches only with their folders open while filtering, the user's own expansion otherwise. */
function useTreeFilter(files: string[], query: string, selected: string | null) {
  const filtered = query ? filterFiles(files, query) : null;
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(selected ? ancestors(selected) : []));
  const [active, setActive] = useState<string | null>(() => selected ?? filtered?.best ?? null);
  const best = filtered?.best;
  const [seen, setSeen] = useState({ best, selected });
  const rows = visibleRows(buildTree(filtered?.files ?? files), filtered ? 'all' : expanded);
  // A filter with a new best match puts it active; a new selection opens its folders and wins over the filter's pick.
  if (seen.best !== best || seen.selected !== selected) {
    setSeen({ best, selected });
    if (seen.best !== best && filtered) setActive(filtered.best);
    if (seen.selected !== selected && selected) {
      setExpanded((prev) => new Set([...prev, ...ancestors(selected)]));
      setActive(selected);
    }
  }
  const toggle = (path: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (!next.delete(path)) next.add(path);
      return next;
    });
  const move = (step: number) => {
    const at = rows.findIndex((r) => r.node.path === active);
    setActive(rows[clamp(at < 0 && step < 0 ? rows.length : at + step, rows.length)]?.node.path ?? null);
  };
  const activate = (path: string, open: (path: string) => void) => {
    const row = rows.find((r) => r.node.path === path);
    if (!row) return;
    if (!row.node.children) return open(path);
    if (!filtered) toggle(path);
  };
  return { rows, active, highlights: filtered?.highlights, isExpanded: (path: string) => !!filtered || expanded.has(path), toggle, move, activate };
}

/** The highlighted content hit, back to the first whenever the query or the search options change. */
function useActiveHit(query: string, options: SearchOptions) {
  const [hit, setHit] = useState({ query, options, at: 0 });
  const activeHit = hit.query === query && hit.options === options ? hit.at : 0;
  const moveHit = (step: number, count: number) => setHit({ query, options, at: clamp(activeHit + step, count) });
  return [activeHit, moveHit] as const;
}

function clamp(i: number, length: number) {
  return Math.max(0, Math.min(length - 1, i));
}
