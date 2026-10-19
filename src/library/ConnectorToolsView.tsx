import { useState } from 'react';
import { ChevronDown, Refresh, SearchAlt } from '@/icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { timeAgo } from '../progress';
import { openSettings } from '../settings/open';
import { SettingsCard, SettingsChoice, SettingsRow, SettingsSection, SkeletonRows } from '../settings/parts';
import { useHarness } from '../store';
import { setAllTools, toolPermission, type ConnectorSettings, type ConnectorTool, type ToolPermission } from './connectorTools';
import { countOf, EmptyRow, filterBy, LibraryRow } from './LibraryParts';
import { deslug } from './names';
import { useConnectorTools, type ToolsConnector } from './useConnectorTools';
import { useLibrary } from './useLibrary';

/** Settings › Connector tools: every connector's tools, each on or off and allowed or asked first, per harness config. */
export function ConnectorToolsView() {
  const library = useLibrary(useHarness().state.spaceId);
  const tools = useConnectorTools(library.entries);
  const [search, setSearch] = useState('');
  const query = search.trim();
  const isLoading = !tools.connectors || !tools.settings;
  const shown = tools.connectors?.filter((c) => !query || matchesConnector(c, query) || shownTools(tools.settings?.[c.key], c, query).length > 0) ?? [];
  return (
    <div data-setting-id="connectorTools" className="flex flex-col gap-10">
      <SettingsSection footer="Always allow runs a tool without asking; Ask waits on a card in the thread; Off leaves it out of threads. Read-only tools start allowed and the rest ask. Claude Code and Codex both get these as their own permission rules for each thread.">
        <InputGroup>
          <InputGroupAddon>
            <SearchAlt />
          </InputGroupAddon>
          <InputGroupInput value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setSearch('')} placeholder="Filter tools" aria-label="Filter connector tools" />
        </InputGroup>
      </SettingsSection>
      {isLoading && (
        <SettingsCard>
          <SkeletonRows count={3} />
        </SettingsCard>
      )}
      {!isLoading && !tools.connectors?.length && <NoConnectors />}
      {!isLoading && !!tools.connectors?.length && !shown.length && <p className="px-1 type-meta text-muted-foreground">No connector or tool matches “{query}”.</p>}
      {shown.map((connector) => (
        <ConnectorSection key={connector.key} connector={connector} settings={tools.settings?.[connector.key] ?? {}} query={matchesConnector(connector, query) ? '' : query} isListing={tools.isListing(connector.key)} onList={() => tools.list(connector.key)} onChange={(change) => tools.save(connector.key, change)} />
      ))}
    </div>
  );
}

const matchesConnector = (connector: ToolsConnector, query: string) => !!query && filterBy([connector], query, (c) => [c.name, c.key, c.url]).length > 0;

function shownTools(settings: ConnectorSettings | undefined, connector: ToolsConnector, query: string) {
  return filterBy(settings?.toolList?.tools ?? [], query, (t) => [t.name, t.title, t.description, connector.name]);
}

function NoConnectors() {
  return (
    <SettingsCard>
      <SettingsRow
        label="No connectors yet"
        description="Connect an account first; its tools and their permissions show up here."
        control={
          <Button variant="outline" size="sm" onClick={() => openSettings('connectors')}>
            Open Connectors
          </Button>
        }
      />
    </SettingsCard>
  );
}

type Change = (change: (current: ConnectorSettings) => ConnectorSettings) => void;

/** One connector's card: its identity with on/off, set-all and refresh, then a row per tool. */
function ConnectorSection({ connector, settings, query, isListing, onList, onChange }: { connector: ToolsConnector; settings: ConnectorSettings; query: string; isListing: boolean; onList: () => void; onChange: Change }) {
  const { toolList, isOff = false } = settings;
  const tools = shownTools(settings, connector, query);
  const meta = isOff ? 'Off: threads don’t load it' : toolList && !toolList.error ? `${countOf(toolList.tools.length, 'tool')} · listed ${timeAgo((Date.now() - toolList.listedAt) / 60_000)}` : connector.url;
  return (
    <SettingsSection id={`connector-${connector.key}`}>
      <SettingsCard>
        <LibraryRow
          name={connector.name}
          icon={connector.icon}
          meta={meta}
          actions={
            <>
              {!isOff && <SetAllMenu name={connector.name} onChange={onChange} />}
              {!isOff && (
                <Button variant="ghost" size="icon-sm" aria-label={`List ${connector.name}’s tools again`} disabled={isListing} onClick={onList}>
                  {isListing ? <Spinner /> : <Refresh />}
                </Button>
              )}
              <Switch checked={!isOff} onCheckedChange={(isOn) => onChange((s) => ({ ...s, isOff: !isOn }))} aria-label={`${connector.name} on`} />
            </>
          }
        />
        {!isOff && <ToolRows connector={connector} settings={settings} tools={tools} isListing={isListing} onList={onList} onChange={onChange} />}
      </SettingsCard>
    </SettingsSection>
  );
}

function ToolRows({ connector, settings, tools, isListing, onList, onChange }: { connector: ToolsConnector; settings: ConnectorSettings; tools: ConnectorTool[]; isListing: boolean; onList: () => void; onChange: Change }) {
  const { toolList } = settings;
  if (!toolList) return <SkeletonRows count={2} />;
  if (toolList.error) return <ListError name={connector.name} error={toolList.error} isListing={isListing} onRetry={onList} />;
  if (!toolList.tools.length) return <EmptyRow text={`${connector.name} lists no tools.`} />;
  return tools.map((tool) => <ToolRow key={tool.name} connectorKey={connector.key} tool={tool} settings={settings} onChange={onChange} />);
}

function ListError({ name, error, isListing, onRetry }: { name: string; error: string; isListing: boolean; onRetry: () => void }) {
  return (
    <SettingsRow
      label={`Couldn’t list ${name}’s tools`}
      description={<span className="text-warning">{error}</span>}
      control={
        <Button variant="outline" size="sm" disabled={isListing} onClick={onRetry}>
          Try again
        </Button>
      }
    />
  );
}

const CHOICES = [
  { value: 'allow', label: 'Always allow' },
  { value: 'ask', label: 'Ask' },
  { value: 'off', label: 'Off' },
] as const satisfies { value: ToolPermission; label: string }[];

function ToolRow({ connectorKey, tool, settings, onChange }: { connectorKey: string; tool: ConnectorTool; settings: ConnectorSettings; onChange: Change }) {
  const { permission } = toolPermission(settings, tool);
  const id = `connector-${connectorKey}-${tool.name}`;
  return (
    <SettingsRow
      id={id}
      label={
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span>{tool.title ?? deslug(tool.name)}</span>
          <code className="truncate font-mono type-caption text-muted-foreground">{tool.name}</code>
          <ToolHint tool={tool} />
        </span>
      }
      description={!!tool.description && <span className="line-clamp-2">{tool.description}</span>}
      control={<SettingsChoice id={id} aria-label={`${tool.title ?? deslug(tool.name)}: permission`} value={permission} options={CHOICES} onChange={(p) => onChange((s) => ({ ...s, tools: { ...s.tools, [tool.name]: p } }))} />}
    />
  );
}

/** The server's own annotation: read-only, or destructive (MCP's default for a tool that doesn't say it only reads). */
function ToolHint({ tool }: { tool: ConnectorTool }) {
  if (tool.isReadOnly) return <Badge variant="outline">Read-only</Badge>;
  if (tool.isDestructive) return <Badge variant="destructive">Destructive</Badge>;
  return null;
}

/** All tools to Ask or Always allow (Off ones stay off), or back to the defaults from each tool's annotations. */
function SetAllMenu({ name, onChange }: { name: string; onChange: Change }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" aria-label={`Set every ${name} tool`}>
          Set all
          <ChevronDown data-icon="inline-end" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => onChange((s) => setAllTools(s, 'allow'))}>All tools: always allow</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onChange((s) => setAllTools(s, 'ask'))}>All tools: ask</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => onChange(({ isOff }) => ({ ...(isOff && { isOff }) }))}>Back to defaults</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
