import { Server } from 'reicon-react';
import { cn } from '@/lib/utils';
import mochiIcon from '../../build/icon.svg';
import { hostname } from '../agentPhase';
import { useThread } from '../store';
import { useVizThreadId } from '../viz/WidgetVisual';
import { Favicon } from '../WebLinks';
import { isMochiTarget } from './mochiCalls';

/** An MCP call's mark, from its target (`linear: get_issue`): Mochi's app icon, the server site's favicon, or the server glyph. */
export function McpIcon({ target, className }: { target: string; className?: string }) {
  const url = useServerUrl(target.split(': ')[0]);
  if (isMochiTarget(target)) return <img src={mochiIcon} alt="" aria-hidden className={cn('shrink-0 rounded-[22%]', className)} />;
  if (url) return <Favicon host={siteOf(hostname(url))} />;
  return <Server aria-hidden className={cn('shrink-0 text-muted-foreground', className)} />;
}

function useServerUrl(server: string) {
  return useThread(useVizThreadId())?.agent?.mcpServers?.find((s) => s.name === server)?.url;
}

// Servers live on a subdomain (`mcp.linear.app`) whose favicon is the generic one; the site's own sits one level up.
// GAP: a two-part suffix (`mcp.example.co.uk`) loses too much and shows the globe.
function siteOf(host: string) {
  const labels = host.split('.');
  return labels.length > 2 ? labels.slice(1).join('.') : host;
}
