import { cn } from '@/lib/utils';
import mochiIcon from '../../build/icon.svg';
import { hostname } from '../agentPhase';
import { McpServerIcon } from '../icons/ObjectIcons';
import { MOCHI_SERVER } from '../runtime/toolTable';
import { useThread } from '../store';
import { useVizThreadId } from '../viz/WidgetVisual';
import { Favicon } from '../WebLinks';

/** An MCP call's mark, from its target (`linear: get_issue`). */
export function McpIcon({ target, className }: { target: string; className?: string }) {
  const server = target.split(': ')[0];
  const url = useThread(useVizThreadId())?.agent?.mcpServers?.find((s) => s.name === server)?.url;
  return <McpServerMark server={server} url={url} className={className} />;
}

/** An MCP server's mark: Mochi's app icon, the server site's favicon, or the wrench while it loads and when there is none. */
export function McpServerMark({ server, url, className }: { server: string; url?: string; className?: string }) {
  if (server === MOCHI_SERVER) return <img src={mochiIcon} alt="" aria-hidden className={cn('size-4 shrink-0 rounded-[22%]', className)} />;
  if (url) return <Favicon host={siteOf(hostname(url))} fallback={<McpServerIcon className={className} />} />;
  return <McpServerIcon className={className} />;
}

// Servers live on a subdomain (`mcp.linear.app`) whose favicon is the generic one; the site's own sits one level up.
// GAP: a two-part suffix (`mcp.example.co.uk`) loses too much and shows the wrench.
function siteOf(host: string) {
  const labels = host.split('.');
  return labels.length > 2 ? labels.slice(1).join('.') : host;
}
