import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import mochiIcon from '../../build/icon.svg';
import { hostname } from '../agentPhase';
import { IconImage } from '../IconImage';
import { McpServerIcon } from '../icons/ObjectIcons';
import { useLibraryNames } from '../library/names';
import { MOCHI_SERVER } from '@mochi/domain/runtime/toolTable';
import { useThread } from '../store';
import { useVizThreadId } from '../viz/WidgetVisual';
import { Favicon } from '../WebLinks';

/** An MCP call's mark, from its target (`linear: get_issue`). */
export function McpIcon({
  target,
  className,
}: {
  target: string;
  className?: string;
}) {
  const server = target.split(': ')[0];
  const url = useThread(useVizThreadId())?.agent?.mcpServers?.find(
    (s) => s.name === server,
  )?.url;
  return <McpServerMark server={server} url={url} className={className} />;
}

/**
 * An MCP server's mark: Mochi's app icon, the library's icon for a connector or plugin, the server site's favicon, or the
 * wrench while it loads and when there is none. A connector's own address wins over `url`, which is Mochi's local proxy for it.
 */
export function McpServerMark({
  server,
  url,
  className,
}: {
  server: string;
  url?: string;
  className?: string;
}) {
  const name = useLibraryNames().server(server);
  if (server === MOCHI_SERVER)
    return (
      <img
        src={mochiIcon}
        alt=""
        aria-hidden
        className={cn('size-4 shrink-0 rounded-[22%]', className)}
      />
    );
  if (name.image)
    return (
      <LibraryImage
        src={name.image}
        fallback={<McpServerIcon className={className} />}
        className={className}
      />
    );
  const site = name.url ?? url;
  if (site)
    return (
      <Favicon
        host={hostname(site)}
        fallback={<McpServerIcon className={className} />}
      />
    );
  return <McpServerIcon className={className} />;
}

/** A skill's mark: its plugin's or its own icon from the library, else `fallback`. */
export function SkillMark({
  skill,
  fallback,
  className,
}: {
  skill: string;
  fallback: ReactNode;
  className?: string;
}) {
  const { image } = useLibraryNames().skill(skill);
  return image ? <LibraryImage src={image} className={className} /> : fallback;
}

/** An installed plugin's own icon from the library, else `fallback`. */
export function PluginMark({
  plugin,
  fallback,
  className,
}: {
  plugin: string;
  fallback: ReactNode;
  className?: string;
}) {
  const { image } = useLibraryNames().plugin(plugin);
  return image ? <LibraryImage src={image} className={className} /> : fallback;
}

function LibraryImage({
  src,
  fallback,
  className,
}: {
  src: string;
  fallback?: ReactNode;
  className?: string;
}) {
  return (
    <IconImage
      src={src}
      fallback={fallback}
      className={cn('size-4 rounded-sm', className)}
    />
  );
}
