import { useState } from 'react';
import { ArrowUpRight, Copy3, Global, GlobalSearch } from 'reicon-react';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui/context-menu';
import { cn } from '@/lib/utils';
import { hostname } from './agentPhase';
import { copyText } from './clipboard';
import type { WebLink } from './model';
import type { ToolCall } from './summary';
import { usePaneOpeners } from './terminal/usePaneOpeners';
import { useVizThreadId } from './viz/WidgetVisual';

const SHOWN = 4;

/** A web search in the work log: the query, then the pages it returned with their favicons. */
export function WebSearchRow({ call, links = [], isRunning }: { call: ToolCall; links?: WebLink[]; isRunning: boolean }) {
  const [isAll, setAll] = useState(false);
  const shown = isAll ? links : links.slice(0, SHOWN);
  return (
    <li className="flex flex-col">
      <div className="flex h-7 min-w-0 items-center gap-2 px-2 type-meta">
        <GlobalSearch className="size-4 shrink-0 text-muted-foreground" />
        <span className="shrink-0 text-subtle-foreground">{isRunning ? 'Searching' : 'Searched'}</span>
        <span className="min-w-0 truncate text-foreground" title={call.target}>
          {call.target}
        </span>
        {links.length > 0 && <span className="ml-auto shrink-0 pl-2 tabular text-subtle-foreground">{links.length}</span>}
      </div>
      {links.length > 0 && (
        <ul className="flex flex-col pl-6">
          {shown.map((link, i) => (
            <li key={`${link.url}-${i}`}>
              <LinkRow link={link} />
            </li>
          ))}
          {links.length > SHOWN && (
            <li>
              <button type="button" onClick={() => setAll((a) => !a)} className="flex h-6 cursor-default items-center rounded-md px-2 type-caption text-subtle-foreground hover:bg-accent/60 hover:text-foreground">
                {isAll ? 'Show fewer' : `${links.length - SHOWN} more`}
              </button>
            </li>
          )}
        </ul>
      )}
    </li>
  );
}

/** A page the agent read: its favicon and where it lives, opening in the browser tab. */
export function WebFetchRow({ call, links, isRunning }: { call: ToolCall; links?: WebLink[]; isRunning: boolean }) {
  const link = links?.[0] ?? { url: call.target };
  return (
    <li className="flex min-w-0">
      <LinkRow link={link} verb={isRunning ? 'Reading' : 'Read'} className="h-7 type-meta" />
    </li>
  );
}

function LinkRow({ link, verb, className }: { link: WebLink; verb?: string; className?: string }) {
  const { openUrl } = usePaneOpeners(useVizThreadId());
  const host = hostname(link.url);
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <button
          type="button"
          title={link.url}
          onClick={() => openUrl(link.url)}
          className={cn('flex h-6 w-full min-w-0 cursor-default items-center gap-2 rounded-md px-2 text-left type-caption hover:bg-accent/60', className)}
        >
          <Favicon host={host} />
          {!!verb && <span className="shrink-0 text-subtle-foreground">{verb}</span>}
          <span className="min-w-0 truncate text-foreground">{link.title ?? host}</span>
          <span className="max-w-[45%] shrink-0 truncate text-subtle-foreground">{link.title ? host : pathOf(link.url)}</span>
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        <ContextMenuItem onSelect={() => openUrl(link.url)}>
          <Global />
          Open in browser tab
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => window.open(link.url, '_blank', 'noopener')}>
          <ArrowUpRight />
          Open in system browser
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => copyText(link.url, 'Link copied')}>
          <Copy3 />
          Copy link
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

/** The page's favicon over a globe that shows until it loads, and stays when it never does; fixed size, so nothing shifts. */
export function Favicon({ host }: { host: string }) {
  const [state, setState] = useState<'loading' | 'shown' | 'failed'>('loading');
  return (
    <span aria-hidden className="relative flex size-4 shrink-0 items-center justify-center">
      {state !== 'shown' && <Global className="size-3.5 text-subtle-foreground" />}
      {state !== 'failed' && (
        <img
          src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=32`}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onLoad={(e) => setState(isDefaultIcon(e.currentTarget) ? 'failed' : 'shown')}
          onError={() => setState('failed')}
          className={cn('absolute inset-0 size-4 rounded-xs', state === 'loading' && 'opacity-0')}
        />
      )}
    </span>
  );
}

// Google answers an unknown domain with its own 16px globe, which loads like any image; asked for 32px, real icons come back larger.
// GAP: a site whose only favicon is 16px also reads as missing and gets the globe.
const isDefaultIcon = (img: HTMLImageElement) => img.naturalWidth <= 16;

function pathOf(url: string) {
  try {
    const { pathname, search } = new URL(url);
    return pathname === '/' && !search ? '' : pathname + search;
  } catch {
    return '';
  }
}
