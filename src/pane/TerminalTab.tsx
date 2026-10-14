import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Add, AlertTriangle, Lock, Search, Send, SidebarRight, TerminalSquare, X } from 'reicon-react';
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { cn } from '@/lib/utils';
import { host } from '../host';
import { threadCwd } from '../host/cwd';
import type { Thread } from '../model';
import { AskInSideChat } from '../sidechat/AskInSideChat';
import { IconAction } from '../terminal/IconAction';
import { addShell, closeSession, showSession, toggleSplit, type TerminalSession } from '../terminal/sessions';
import { useTerminals } from '../terminal/useTerminals';
import { PaneActions, PaneTitle } from './PaneHeader';
import { PlannedTab } from './PlannedTab';
import type { PaneTabProps } from './tabs';
import { isMod } from '../keys';

export function TerminalTab({ thread, tab }: PaneTabProps) {
  const cwd = threadCwd(thread);
  if (!cwd) return <PlannedTab icon={TerminalSquare} title="No project folder" description="This chat has no folder, so there is no shell to open." />;
  return <Terminals thread={thread} tabId={tab.id} cwd={cwd} />;
}

function Terminals({ thread, tabId, cwd }: { thread: Thread; tabId: string; cwd: string }) {
  const { key, context, group, sendSelection, askToFix } = useTerminals(thread, tabId, cwd);
  const [isSearching, setIsSearching] = useState(false);
  if (!group) return null;
  const focused = group.sessions.find((s) => s.id === group.focused);
  const visible = group.visible.flatMap((id) => group.sessions.filter((s) => s.id === id));
  const isSplit = visible.length > 1;

  const onKeyDown = (e: KeyboardEvent) => {
    if (!isMod(e) || e.key.toLowerCase() !== 'f') return;
    e.preventDefault();
    setIsSearching(true);
  };

  return (
    <div className="@container flex h-full flex-col gap-2 px-2 pb-2" onKeyDown={onKeyDown}>
      <PaneTitle>
        <div role="tablist" aria-label="Terminals" className="-ml-1.5 flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
          {group.sessions.map((s) => (
            <Button
              key={s.id}
              role="tab"
              aria-selected={s.id === group.focused}
              variant="ghost"
              size="sm"
              onClick={() => showSession(key, s.id)}
              className="text-muted-foreground aria-selected:bg-accent aria-selected:text-foreground"
            >
              {s.kind !== 'shell' && <Lock aria-hidden />}
              {s.title}
              {!!s.failure && <AlertTriangle className="text-destructive" aria-label="Last command failed" />}
            </Button>
          ))}
          <IconAction aria-label="New terminal" className="text-muted-foreground" onClick={() => addShell(key, context)}>
            <Add />
          </IconAction>
        </div>
      </PaneTitle>
      <PaneActions>
        {!!focused?.selection && (
          <Button variant="secondary" size="sm" onClick={() => sendSelection(focused)}>
            <Send aria-hidden />
            Send to chat
          </Button>
        )}
        {!!focused?.selection && <AskInSideChat threadId={thread.id} quote={{ source: 'terminal', label: focused.title, text: focused.selection.trim() }} />}
        <IconAction aria-label="Search output" aria-keyshortcuts="Meta+F" onClick={() => setIsSearching((v) => !v)}>
          <Search />
        </IconAction>
        <IconAction aria-label={isSplit ? 'Unsplit' : 'Split terminal'} aria-pressed={isSplit} onClick={() => toggleSplit(key)}>
          <SidebarRight />
        </IconAction>
        {focused?.kind === 'shell' && (
          <IconAction aria-label={`Close ${focused.title}`} onClick={() => closeSession(key, focused.id)}>
            <X />
          </IconAction>
        )}
      </PaneActions>
      {isSearching && !!focused && <SearchBar session={focused} onClose={() => setIsSearching(false)} />}
      {!!focused?.failure && (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>Exited with {focused.failure.exitCode}</AlertTitle>
          <AlertDescription className="truncate font-mono">{focused.failure.output.split('\n').findLast(Boolean)}</AlertDescription>
          <AlertAction>
            <Button variant="secondary" size="sm" onClick={() => askToFix(focused)}>
              Ask agent to fix
            </Button>
          </AlertAction>
        </Alert>
      )}
      <div className={cn('grid min-h-0 flex-1 grid-cols-1 gap-2', isSplit && 'grid-rows-2 @xl:grid-cols-2 @xl:grid-rows-1')}>
        {visible.map((s) => (
          <TerminalSurface key={s.id} session={s} isFocused={s.id === group.focused} isSplit={isSplit} onFocus={() => showSession(key, s.id)} />
        ))}
      </div>
      {!host.isDesktop && <p className="px-1 type-caption text-subtle-foreground">Web preview: a recorded session. The desktop app runs a real shell here.</p>}
    </div>
  );
}

function TerminalSurface({ session, isFocused, isSplit, onFocus }: { session: TerminalSession; isFocused: boolean; isSplit: boolean; onFocus: () => void }) {
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = boxRef.current!;
    box.append(session.element);
    if (!session.term.element) session.term.open(session.element);
    const fit = () => box.clientWidth > 0 && box.clientHeight > 0 && session.fit.fit();
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(box);
    return () => {
      observer.disconnect();
      session.element.remove();
    };
  }, [session]);
  useEffect(() => {
    if (isFocused) session.term.focus();
  }, [session, isFocused]);
  return (
    <div
      ref={boxRef}
      onPointerDown={onFocus}
      className={cn('min-h-0 min-w-0 overflow-hidden rounded-xl bg-card ring-1 ring-border', isSplit && isFocused && 'ring-ring/50')}
    />
  );
}

function SearchBar({ session, onClose }: { session: TerminalSession; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      session.search.clearDecorations();
      onClose();
      session.term.focus();
    } else if (e.key === 'Enter') {
      if (e.shiftKey) session.search.findPrevious(query);
      else session.search.findNext(query);
    } else return;
    e.preventDefault();
  };
  return (
    <InputGroup>
      <InputGroupAddon>
        <Search />
      </InputGroupAddon>
      <InputGroupInput
        autoFocus
        aria-label={`Search ${session.title}`}
        placeholder="Search output, Enter for next"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          session.search.findNext(e.target.value, { incremental: true });
        }}
        onKeyDown={onKeyDown}
      />
      <InputGroupAddon align="inline-end">
        <IconAction aria-label="Close search" size="icon-xs" onClick={onClose}>
          <X />
        </IconAction>
      </InputGroupAddon>
    </InputGroup>
  );
}
