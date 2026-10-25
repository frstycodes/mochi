import { useState, type ReactNode } from 'react';
import { ArrowUpRight, CopyStack, Globe } from '@/icons';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { cn } from '@/lib/utils';
import { hostname } from './agentPhase';
import { faviconUrl } from '@mochi/domain/favicon';
import { IconImage } from './IconImage';
import { copyText } from './clipboard';
import type { WebLink } from './model';
import { usePaneOpeners } from './terminal/usePaneOpeners';
import { useVizThreadId } from './viz/WidgetVisual';

const SHOWN = 4;

/** The pages a web search returned, with their favicons; the first few, then the rest on demand. */
export function LinkList({ links }: { links: WebLink[] }) {
  const [isAll, setAll] = useState(false);
  const shown = isAll ? links : links.slice(0, SHOWN);
  return (
    <ul className="-mx-2 flex flex-col">
      {shown.map((link, i) => (
        <li key={`${link.url}-${i}`}>
          <LinkRow link={link} />
        </li>
      ))}
      {links.length > SHOWN && (
        <li>
          <button
            type="button"
            onClick={() => setAll((a) => !a)}
            className="flex h-6 cursor-default items-center rounded-md px-2 type-caption text-subtle-foreground hover:bg-accent/60 hover:text-foreground"
          >
            {isAll ? 'Show fewer' : `${links.length - SHOWN} more`}
          </button>
        </li>
      )}
    </ul>
  );
}

/** A page: its favicon and where it lives, opening in the browser tab. */
export function LinkRow({
  link,
  className,
}: {
  link: WebLink;
  className?: string;
}) {
  const { openUrl } = usePaneOpeners(useVizThreadId());
  const host = hostname(link.url);
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <button
          type="button"
          title={link.url}
          onClick={() => openUrl(link.url)}
          className={cn(
            'flex h-6 w-full min-w-0 cursor-default items-center gap-2 rounded-md px-2 text-left type-caption hover:bg-accent/60',
            className,
          )}
        >
          <Favicon host={host} />
          <span className="min-w-0 truncate text-foreground">
            {link.title ?? host}
          </span>
          <span className="max-w-[45%] shrink-0 truncate text-subtle-foreground">
            {link.title ? host : pathOf(link.url)}
          </span>
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        <ContextMenuItem onSelect={() => openUrl(link.url)}>
          <Globe />
          Open in browser tab
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={() => window.open(link.url, '_blank', 'noopener')}
        >
          <ArrowUpRight />
          Open in system browser
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => copyText(link.url, 'Link copied')}>
          <CopyStack />
          Copy link
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

/** The page's favicon over `fallback` (a globe) that shows until it loads, and stays when it never does; fixed size, so nothing shifts. */
export function Favicon({
  host,
  fallback = <Globe className="size-3.5 text-subtle-foreground" />,
  className,
}: {
  host: string;
  fallback?: ReactNode;
  className?: string;
}) {
  return (
    <IconImage
      src={faviconUrl(host)}
      fallback={fallback}
      className={cn('size-4 rounded-xs', className)}
    />
  );
}

function pathOf(url: string) {
  try {
    const { pathname, search } = new URL(url);
    return pathname === '/' && !search ? '' : pathname + search;
  } catch {
    return '';
  }
}
