import { useEffect, useRef } from 'react';
import { ChevronDown, ChevronUp, X } from '@/icons';
import { Input } from '@/components/ui/input';
import { host } from '@/host';
import { cn } from '@/lib/utils';
import { Shortcut } from '../Shortcut';
import { TooltipIconButton } from '../ui';
import { closeFind, updatePage, type FindState, type Page } from './pages';

/** Find in page under the toolbar: ⌘F opens it from the pane or the page, Enter / Shift Enter step, Esc closes. */
export function FindBar({ pageId, page, find }: { pageId: string; page: Page; find: FindState }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const id = page.hostId;

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- focusAt is the ⌘F request: each one refocuses the field
  }, [find.focusAt]);

  useEffect(() => {
    if (!id) return;
    if (find.query) void host.browser.find(id, find.query, { forward: true, isNewSearch: true, matchCase: find.matchCase });
    else void host.browser.stopFind(id);
  }, [id, find.query, find.matchCase]);

  const step = (forward: boolean) => id && find.query && void host.browser.find(id, find.query, { forward, isNewSearch: false, matchCase: find.matchCase });
  const set = (patch: Partial<FindState>) => updatePage(pageId, { find: { ...find, ...patch } });
  const count = !find.query ? '' : find.matches ? `${find.active} of ${find.matches}` : 'No results';

  return (
    <div role="search" className="flex h-9 shrink-0 items-center gap-1 px-2">
      <Input
        ref={inputRef}
        aria-label="Find in page"
        placeholder="Find in page"
        spellCheck={false}
        value={find.query}
        onChange={(e) => set({ query: e.target.value, active: 0, matches: 0 })}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            step(!e.shiftKey);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            closeFind(pageId);
          }
        }}
        className="h-7 min-w-0 flex-1 rounded-full border-transparent bg-muted px-3 type-caption dark:bg-muted"
      />
      <span aria-live="polite" className={cn('shrink-0 px-1 type-caption tabular-nums', find.query && !find.matches ? 'text-destructive' : 'text-muted-foreground')}>
        {count}
      </span>
      <TooltipIconButton label="Previous match" hint={<Shortcut keys={['shift', 'Enter']} />} disabled={!find.matches} onClick={() => step(false)}>
        <ChevronUp />
      </TooltipIconButton>
      <TooltipIconButton label="Next match" hint={<Shortcut keys={['Enter']} />} disabled={!find.matches} onClick={() => step(true)}>
        <ChevronDown />
      </TooltipIconButton>
      <TooltipIconButton label="Match case" hint={find.matchCase ? 'On: only exact case matches' : 'Off: ignores case'} aria-pressed={find.matchCase} className={cn(find.matchCase && 'bg-accent text-foreground')} onClick={() => set({ matchCase: !find.matchCase })}>
        <span className="type-caption font-semibold">Aa</span>
      </TooltipIconButton>
      <TooltipIconButton label="Close" hint={<Shortcut keys={['Esc']} />} onClick={() => closeFind(pageId)}>
        <X />
      </TooltipIconButton>
    </div>
  );
}
