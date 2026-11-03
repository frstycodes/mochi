import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type WheelEvent,
} from 'react';
import { ArrowLeft, ArrowRight, Refresh } from '@/icons';
import { Input } from '@/components/ui/input';
import { host } from '@/host';
import type { BrowserInput } from '@mochi/domain/host/types/browser';
import type { FollowedMachine, RemoteCommand } from '../host/types/remote';
import type { PaneTab, Thread } from '../model';
import { toWire, wireId } from '../remote/ids';
import { useDispatch } from '../store';
import { TooltipIconButton } from '../ui';
import { useSize } from './PageSurface';
import { normalizeUrl } from './url';

/**
 * Another computer's thread's browser tab: the page runs on that computer, where the thread's agent and its localhost are, and
 * shows here as its frames. Clicks, wheel and keys go back to it (`browser-input`).
 */
export function RemoteBrowser({
  machine,
  thread,
  tab,
}: {
  machine: FollowedMachine;
  thread: Thread;
  tab: PaneTab;
}) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const size = useSize(surfaceRef);
  const { frame, error, send } = useRemotePage(machine, thread, tab, size);
  const [draft, setDraft] = useState<string | null>(null);
  const url = frame?.url || tab.url || '';

  const pointAt = (e: MouseEvent<HTMLElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.metaKey || e.ctrlKey) return;
    e.preventDefault();
    send(
      e.key.length === 1
        ? { kind: 'text', text: e.key }
        : { kind: 'key', key: e.key },
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-1 px-2">
        <TooltipIconButton label="Back" onClick={() => navigate(send, 'back')}>
          <ArrowLeft />
        </TooltipIconButton>
        <TooltipIconButton
          label="Forward"
          onClick={() => navigate(send, 'forward')}
        >
          <ArrowRight />
        </TooltipIconButton>
        <TooltipIconButton
          label="Reload"
          onClick={() => navigate(send, 'reload')}
        >
          <Refresh />
        </TooltipIconButton>
        <form
          className="mx-1 min-w-0 flex-1"
          onSubmit={(e) => {
            e.preventDefault();
            if (draft) navigate(send, { url: normalizeUrl(draft) });
            setDraft(null);
          }}
        >
          <Input
            aria-label={`Address on ${machine.name}`}
            value={draft ?? url}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => setDraft(null)}
            className="h-7 truncate rounded-full border-transparent bg-muted px-3 type-caption text-muted-foreground focus-visible:text-foreground dark:bg-muted"
          />
        </form>
      </div>
      <div
        ref={surfaceRef}
        role="application"
        aria-label={`${frame?.title || 'Page'} on ${machine.name}`}
        tabIndex={0}
        onKeyDown={onKeyDown}
        className="relative min-h-0 flex-1 overflow-hidden bg-white outline-none"
      >
        {!!frame && (
          <img
            alt=""
            src={frame.data}
            draggable={false}
            onClick={(e) => send({ kind: 'click', ...pointAt(e) })}
            onWheel={(e: WheelEvent<HTMLImageElement>) =>
              send({
                kind: 'scroll',
                ...pointAt(e),
                dx: e.deltaX,
                dy: e.deltaY,
              })
            }
            className="block size-full object-cover object-top"
          />
        )}
        {!frame && (
          <RemotePageNote
            text={error ?? `Opening the page on ${machine.name}…`}
          />
        )}
      </div>
    </div>
  );
}

function RemotePageNote({ text }: { text: string }) {
  return (
    <div className="absolute inset-0 grid place-items-center bg-background px-6 text-center type-caption text-muted-foreground">
      {text}
    </div>
  );
}

type Send = (input: BrowserInput | Navigate) => void;
type Navigate = {
  navigate: Extract<RemoteCommand, { type: 'browser-navigate' }>['to'];
};

const navigate = (send: Send, to: Navigate['navigate']) =>
  send({ navigate: to });

/**
 * Opens the tab on the thread's computer at this surface's size (again when it resizes) and follows its frames; the tab's URL
 * and title follow the page. Closing the surface stops the stream, the tab stays open there.
 */
function useRemotePage(
  machine: FollowedMachine,
  thread: Thread,
  tab: PaneTab,
  size: { w: number; h: number },
) {
  const dispatch = useDispatch();
  const [frame, setFrame] = useState<{
    data: string;
    url: string;
    title: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const threadId = wireId(thread.id);
  const width = Math.round(size.w);
  const height = Math.round(size.h);
  const startUrl = useRef(tab.url ?? 'about:blank');

  const run = (command: RemoteCommand) =>
    host.remote.command(machine.id, toWire(command)).then((result) => {
      if (!result.isOk) setError(result.error);
    });

  useEffect(
    () =>
      host.remote.onBrowserFrame((message) => {
        if (
          message.machineId !== machine.id ||
          message.threadId !== threadId ||
          message.tabId !== tab.id
        )
          return;
        setError(null);
        setFrame(message.frame);
      }),
    [machine.id, threadId, tab.id],
  );

  useEffect(() => {
    if (!width || !height) return;
    const key = { threadId: thread.id, tabId: tab.id };
    void run({
      type: 'browser-open',
      ...key,
      url: startUrl.current,
      width,
      height,
    });
    return () => void run({ type: 'browser-close', ...key });
    // `run` is a fresh closure each render; the tab opens again only for a new tab or size.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [machine.id, thread.id, tab.id, width, height]);

  const url = frame?.url;
  const title = frame?.title;
  useEffect(() => {
    if (!url || (url === tab.url && title === tab.title)) return;
    dispatch({
      type: 'pane-update-tab',
      threadId: thread.id,
      tabId: tab.id,
      patch: { url, ...(title && { title }) },
    });
  }, [dispatch, thread.id, tab.id, tab.url, tab.title, url, title]);

  const send: Send = (input) => {
    const key = { threadId: thread.id, tabId: tab.id };
    void run(
      'navigate' in input
        ? { type: 'browser-navigate', ...key, to: input.navigate }
        : { type: 'browser-input', ...key, input },
    );
  };
  return { frame, error, send };
}
