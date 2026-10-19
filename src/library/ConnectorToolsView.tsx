import { useState } from 'react';
import { Ban, CheckCircle, ChevronDown, RaisedHand, Refresh, SearchAlt, type IconComponent } from '@/icons';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { timeAgo } from '../progress';
import { openSettings } from '../settings/open';
import { SettingsCard, SettingsRow, SettingsSection, SkeletonRows } from '../settings/parts';
import { useHarness } from '../store';
import { groupPermission, setTools, toolGroups, toolPermission, type ConnectorSettings, type ConnectorTool, type ToolPermission } from './connectorTools';
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
      <SettingsSection footer="Choose when agents may use each connector's tools. Always allow runs a tool without asking, Needs approval waits on a card in the thread, Blocked leaves it out. Read-only tools start allowed and the rest need approval. Claude Code and Codex both get these as their own permission rules for each thread.">
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
  const groups = toolGroups(tools).filter((group) => group.tools.length > 0);
  return (
    <Accordion type="multiple" defaultValue={groups.map((g) => g.id)} className="relative before:absolute before:inset-x-4 before:top-0 before:h-px before:bg-border">
      {groups.map((group) => (
        <ToolGroup key={group.id} id={group.id} connectorKey={connector.key} title={GROUP_TITLES[group.id]} tools={group.tools} settings={settings} onChange={onChange} />
      ))}
    </Accordion>
  );
}

const GROUP_TITLES = { read: 'Read-only tools', write: 'Write/delete tools' };

/** One annotation group, open by default: its count and one choice for every tool in it, then a row per tool. */
function ToolGroup({ id, connectorKey, title, tools, settings, onChange }: { id: string; connectorKey: string; title: string; tools: ConnectorTool[]; settings: ConnectorSettings; onChange: Change }) {
  return (
    <AccordionItem value={id} className="relative border-b-0 not-first:before:absolute not-first:before:inset-x-4 not-first:before:top-0 not-first:before:h-px not-first:before:bg-border">
      {/* A menu can't sit inside the trigger, so it floats over the trigger's right end. */}
      <div className="absolute top-2 right-4 z-10">
        <GroupMenu title={title} permission={groupPermission(settings, tools)} onChange={(p) => onChange((s) => setTools(s, tools, p))} />
      </div>
      <AccordionTrigger className="flex-row-reverse justify-end gap-2 rounded-none py-3 pr-4 pl-4 font-normal hover:no-underline **:data-[slot=accordion-trigger-icon]:ml-0">
        <span className="flex items-center gap-2 pr-44">
          <span className="type-body font-medium">{title}</span>
          <Badge variant="secondary" className="tabular">
            {tools.length}
          </Badge>
        </span>
      </AccordionTrigger>
      <AccordionContent className="pb-1">
        <ul aria-label={title}>
          {tools.map((tool) => (
            <ToolRow key={tool.name} connectorKey={connectorKey} tool={tool} settings={settings} onChange={onChange} />
          ))}
        </ul>
      </AccordionContent>
    </AccordionItem>
  );
}

const CHOICES = [
  { value: 'allow', label: 'Always allow', icon: CheckCircle },
  { value: 'ask', label: 'Needs approval', icon: RaisedHand },
  { value: 'off', label: 'Blocked', icon: Ban },
] as const satisfies { value: ToolPermission; label: string; icon: IconComponent }[];

const choiceOf = (permission: ToolPermission) => CHOICES.find((c) => c.value === permission)!;

/** The group's permission when its tools agree ("Mixed" when they don't), and a menu that sets them all. */
function GroupMenu({ title, permission, onChange }: { title: string; permission: ToolPermission | null; onChange: (permission: ToolPermission) => void }) {
  const current = permission && choiceOf(permission);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" aria-label={`${title}: ${current?.label ?? 'Mixed'}`}>
          {current && <current.icon data-icon="inline-start" />}
          {current?.label ?? 'Mixed'}
          <ChevronDown data-icon="inline-end" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuRadioGroup value={permission ?? ''} onValueChange={(v) => onChange(v as ToolPermission)}>
          {CHOICES.map((choice) => (
            <DropdownMenuRadioItem key={choice.value} value={choice.value}>
              <choice.icon />
              {choice.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** A tool's name (its description and server name on hover) and its three choices as icons. */
function ToolRow({ connectorKey, tool, settings, onChange }: { connectorKey: string; tool: ConnectorTool; settings: ConnectorSettings; onChange: Change }) {
  const { permission } = toolPermission(settings, tool);
  const label = tool.title ?? deslug(tool.name);
  return (
    <li data-setting-id={`connector-${connectorKey}-${tool.name}`} className="relative flex min-h-12 items-center gap-3 py-1.5 pr-4 pl-10 before:absolute before:top-0 before:right-4 before:left-10 before:h-px before:bg-border">
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="min-w-0 flex-1 truncate type-body text-muted-foreground">{label}</span>
        </TooltipTrigger>
        <TooltipContent side="top" align="start" className="max-w-80 flex-col items-start gap-0.5">
          <code className="block font-mono">{tool.name}</code>
          {!!tool.description && <span className="block opacity-80">{tool.description}</span>}
        </TooltipContent>
      </Tooltip>
      {/* Tooltip's data-state replaces the item's, so the chosen one is styled by aria-checked. */}
      <ToggleGroup type="single" spacing={0} value={permission} onValueChange={(v) => v && onChange((s) => ({ ...s, tools: { ...s.tools, [tool.name]: v as ToolPermission } }))} aria-label={`${label}: permission`} className="shrink-0 rounded-lg bg-muted p-0.5">
        {CHOICES.map((choice) => (
          <Tooltip key={choice.value}>
            <TooltipTrigger asChild>
              <ToggleGroupItem value={choice.value} aria-label={choice.label} size="sm" className="size-8 rounded-md! px-0! text-muted-foreground aria-checked:bg-background aria-checked:text-foreground aria-checked:shadow-xs aria-checked:ring-1 aria-checked:ring-input dark:aria-checked:bg-accent">
                <choice.icon />
              </ToggleGroupItem>
            </TooltipTrigger>
            <TooltipContent>{choice.label}</TooltipContent>
          </Tooltip>
        ))}
      </ToggleGroup>
    </li>
  );
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
