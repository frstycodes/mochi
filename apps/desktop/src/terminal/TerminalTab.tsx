import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Plus, XCircle, Lock, Search, SendAlt, Terminal, X } from '@/icons';
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@/components/ui/input-group';
import { cn } from '@/lib/utils';
import { host } from '../host';
import { threadCwd } from '../host/cwd';
import type { Thread } from '../model';
import { AskInSideChat } from '../sidechat/AskInSideChat';
import { IconAction } from './IconAction';
import {
  addShell,
  closeSession,
  showSession,
  type TerminalSession,
} from './sessions';
import { useTerminals } from './useTerminals';
import { PaneActions, PaneTitle } from '../pane/PaneHeader';
import { PlannedTab } from '../pane/PlannedTab';
import type { PaneTabProps } from '../pane/tabs';
import { isCommand } from '../keymap';

export default function TerminalTab({ thread, tab }: PaneTabProps) {
  const cwd = threadCwd(thread);
  if (!cwd)
    return (
      <PlannedTab
        icon={Terminal}
        title="No project folder"
        description="This chat has no folder, so there is no shell to open."
      />
    );
  return <Terminals thread={thread} tabId={tab.id} cwd={cwd} />;
}

function Terminals({
  thread,
  tabId,
  cwd,
}: {
  thread: Thread;
  tabId: string;
  cwd: string;
}) {
  const { key, context, group, sendSelection, askToFix } = useTerminals(
    thread,
    tabId,
    cwd,
  );
  const [isSearching, setIsSearching] = useState(false);
  if (!group) return null;
  const focused = group.sessions.find((s) => s.id === group.focused);

  const onKeyDown = (e: KeyboardEvent) => {
    if (!isCommand(e, 'find')) return;
    e.preventDefault();
    setIsSearching(true);
  };

  return (
    <div
      className="@container flex h-full flex-col gap-2 px-2 pb-2"
      onKeyDown={onKeyDown}
    >
      <PaneTitle>
        <div
          role="tablist"
          aria-label="Terminals"
          className="-ml-1.5 flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto"
          style={{ scrollbarWidth: 'none' }}
        >
          {group.sessions.map((s) => {
            const isSelected = s.id === group.focused;
            return (
              // The tab and its close sit in one chip; the agent's read-only terminal has no close.
              <span
                key={s.id}
                className={cn(
                  'group/tab flex shrink-0 items-center rounded-md text-muted-foreground hover:bg-accent/60',
                  isSelected && 'bg-accent text-foreground hover:bg-accent',
                )}
              >
                <Button
                  role="tab"
                  aria-selected={isSelected}
                  variant="ghost"
                  size="sm"
                  onClick={() => showSession(key, s.id)}
                  className={cn(
                    'hover:bg-transparent',
                    s.kind === 'shell' && 'pr-1',
                  )}
                >
                  {s.kind !== 'shell' && <Lock aria-hidden />}
                  {s.title}
                  {!!s.failure && (
                    <XCircle
                      className="text-destructive"
                      aria-label="Last command failed"
                    />
                  )}
                </Button>
                {s.kind === 'shell' && (
                  <IconAction
                    aria-label={`Close ${s.title}`}
                    onClick={() => closeSession(key, s.id)}
                    className={cn(
                      'mr-0.5 size-5 opacity-0 group-hover/tab:opacity-100 focus-visible:opacity-100',
                      isSelected && 'opacity-100',
                    )}
                  >
                    <X />
                  </IconAction>
                )}
              </span>
            );
          })}
          <IconAction
            aria-label="New terminal"
            className="text-muted-foreground"
            onClick={() => addShell(key, context)}
          >
            <Plus />
          </IconAction>
        </div>
      </PaneTitle>
      <PaneActions>
        {!!focused?.selection && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => sendSelection(focused)}
          >
            <SendAlt aria-hidden />
            Send to chat
          </Button>
        )}
        {!!focused?.selection && (
          <AskInSideChat
            threadId={thread.id}
            quote={{
              source: 'terminal',
              label: focused.title,
              text: focused.selection.trim(),
            }}
          />
        )}
        <IconAction
          aria-label="Search output"
          aria-keyshortcuts="Meta+F"
          onClick={() => setIsSearching((v) => !v)}
        >
          <Search />
        </IconAction>
      </PaneActions>
      {isSearching && !!focused && (
        <SearchBar session={focused} onClose={() => setIsSearching(false)} />
      )}
      {!!focused && <TerminalSurface key={focused.id} session={focused} />}
      {/* A failed command reads under the output it came from, where your eye already is. */}
      {!!focused?.failure && (
        <Alert variant="destructive">
          <XCircle />
          <AlertTitle>Exited with {focused.failure.exitCode}</AlertTitle>
          <AlertDescription className="truncate font-mono">
            {focused.failure.output.split('\n').findLast(Boolean)}
          </AlertDescription>
          <AlertAction>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => askToFix(focused)}
            >
              Ask agent to fix
            </Button>
          </AlertAction>
        </Alert>
      )}
      {!host.hasCore && (
        <p className="px-1 type-caption text-subtle-foreground">
          Web preview: a recorded session. The desktop app runs a real shell
          here.
        </p>
      )}
    </div>
  );
}

function TerminalSurface({ session }: { session: TerminalSession }) {
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = boxRef.current!;
    box.append(session.element);
    if (!session.term.element) session.term.open(session.element);
    const fit = () =>
      box.clientWidth > 0 && box.clientHeight > 0 && session.fit.fit();
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(box);
    return () => {
      observer.disconnect();
      session.element.remove();
    };
  }, [session]);
  useEffect(() => session.term.focus(), [session]);
  return (
    <div ref={boxRef} className="min-h-0 min-w-0 flex-1 overflow-hidden" />
  );
}

function SearchBar({
  session,
  onClose,
}: {
  session: TerminalSession;
  onClose: () => void;
}) {
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
