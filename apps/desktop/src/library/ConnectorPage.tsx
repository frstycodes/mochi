import { useState } from 'react';
import { useNow } from '../useNow';
import {
  ArrowLeft,
  Ban,
  CheckCircle,
  ChevronDown,
  Edit,
  Plus,
  RaisedHand,
  Refresh,
  Search,
  type IconComponent,
} from '@/icons';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@/components/ui/input-group';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { timeAgo } from '../progress';
import { openSettings } from '../routes/nav';
import {
  SettingsCard,
  SettingsRow,
  SettingsSection,
  SkeletonRows,
} from '../settings/parts';
import { useHarnessSelector } from '../store';
import { OverflowIcon } from '../ui';
import { ConnectAccountDialog } from './ConnectDialog';
import { connectorKey } from '@mochi/domain/library/connectors';
import {
  groupPermission,
  setTools,
  toolGroups,
  toolPermission,
  type ConnectorSettings,
  type ConnectorTool,
  type ToolPermission,
} from '@mochi/domain/library/connectorTools';
import type { LibraryEntry } from './library';
import {
  countOf,
  EmptyRow,
  EntryActions,
  filterBy,
  LibraryIcon,
} from './LibraryParts';
import { deslug } from './names';
import { useConnectorTools, type ToolsConnector } from './useConnectorTools';
import { useLibrary, type Library } from './useLibrary';

/** Settings › Connectors › <connector>: its identity, its accounts and the profiles each reaches, whether threads load it, and when agents may use each of its tools. */
export function ConnectorPage({ id }: { id: string }) {
  const library = useLibrary(useHarnessSelector((s) => s.spaceId));
  const tools = useConnectorTools(library.entries);
  const connector = tools.connectors?.find((c) => c.key === id);
  if (!tools.connectors || !tools.settings) return <LoadingPage />;
  if (!connector) return <MissingPage />;
  const settings = tools.settings[connector.key] ?? {};
  const change: Change = (next) => tools.save(connector.key, next);
  const accounts = (library.entries ?? []).filter((e) =>
    isAccountOf(e, connector.key),
  );
  return (
    <div
      data-setting-id={`connector-${connector.key}`}
      className="flex flex-col gap-10"
    >
      <ConnectorHeader
        connector={connector}
        settings={settings}
        library={library}
        isListing={tools.isListing(connector.key)}
        onList={() => tools.list(connector.key)}
        onChange={change}
      />
      <Accounts connector={connector} accounts={accounts} library={library} />
      <ToolPermissions
        connector={connector}
        settings={settings}
        isListing={tools.isListing(connector.key)}
        onList={() => tools.list(connector.key)}
        onChange={change}
      />
    </div>
  );
}

const isAccountOf = (entry: LibraryEntry, key: string) =>
  entry.kind === 'connector' &&
  !!entry.source &&
  URL.canParse(entry.source) &&
  connectorKey(entry.source) === key;

type Change = (
  change: (current: ConnectorSettings) => ConnectorSettings,
) => void;

function BackLink() {
  return (
    <Button
      variant="ghost"
      size="xs"
      className="self-start text-muted-foreground"
      onClick={() => openSettings('connectors')}
    >
      <ArrowLeft />
      Connectors
    </Button>
  );
}

/** Back to the list, then the connector's tile, name and what it holds, with its on/off switch and a refresh on the right. */
function ConnectorHeader({
  connector,
  settings,
  library,
  isListing,
  onList,
  onChange,
}: {
  connector: ToolsConnector;
  settings: ConnectorSettings;
  library: Library;
  isListing: boolean;
  onList: () => void;
  onChange: Change;
}) {
  const { toolList, isOff = false } = settings;
  const now = useNow(60_000);
  const meta = isOff
    ? 'Off: threads don’t load it'
    : toolList && !toolList.error
      ? `${countOf(toolList.tools.length, 'tool')} · listed ${timeAgo((now - toolList.listedAt) / 60_000)}`
      : connector.url;
  return (
    <div className="flex flex-col gap-4">
      <BackLink />
      <div className="flex items-center gap-3 px-1">
        <LibraryIcon
          key={connector.icon}
          url={connector.icon}
          letter={connector.name}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <h1 className="truncate type-display">{connector.name}</h1>
          <p className="truncate type-meta text-muted-foreground">{meta}</p>
        </div>
        {!isOff && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`List ${connector.name}’s tools again`}
                disabled={isListing}
                onClick={onList}
              >
                {isListing ? <Spinner /> : <Refresh />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>List its tools again</TooltipContent>
          </Tooltip>
        )}
        <Tooltip>
          {/* Tooltip's data-state would replace the switch's own, so it hangs on a wrapper. */}
          <TooltipTrigger asChild>
            <span className="flex">
              <Switch
                checked={!isOff}
                onCheckedChange={(isOn) =>
                  onChange((s) => ({ ...s, isOff: !isOn }))
                }
                aria-label={`Threads load ${connector.name}`}
              />
            </span>
          </TooltipTrigger>
          <TooltipContent>
            {isOff
              ? `Off: threads don’t load ${connector.name}`
              : `Threads load ${connector.name}`}
          </TooltipContent>
        </Tooltip>
        <ConnectorMenu connector={connector} library={library} />
      </div>
    </div>
  );
}

/** Rename lives here; removing goes account by account, under Accounts. */
function ConnectorMenu({
  connector,
  library,
}: {
  connector: ToolsConnector;
  library: Library;
}) {
  const [isRenaming, setRenaming] = useState(false);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`${connector.name} actions`}
          >
            <OverflowIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem onSelect={() => setRenaming(true)}>
            <Edit />
            Rename…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={isRenaming} onOpenChange={setRenaming}>
        <DialogContent className="sm:max-w-sm">
          <RenameForm
            connector={connector}
            library={library}
            onDone={() => setRenaming(false)}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

// Inside the dialog's content, which unmounts when it closes, so every opening starts from the current name.
function RenameForm({
  connector,
  library,
  onDone,
}: {
  connector: ToolsConnector;
  library: Library;
  onDone: () => void;
}) {
  const [name, setName] = useState(connector.name);
  const trimmed = name.trim();
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!trimmed || trimmed === connector.name) return onDone();
        void library
          .renameConnector(connector.key, trimmed)
          .then((isDone) => isDone && onDone());
      }}
    >
      <DialogHeader>
        <DialogTitle>Rename {connector.name}</DialogTitle>
        <DialogDescription>
          Threads, menus and the work log show this name.
        </DialogDescription>
      </DialogHeader>
      <Field>
        <FieldLabel htmlFor="connector-name">Name</FieldLabel>
        <Input
          id="connector-name"
          autoFocus
          maxLength={64}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <FieldDescription>
          Agents still reach it as{' '}
          <code className="font-mono">{connector.key}</code>, so its tool
          permissions keep working.
        </FieldDescription>
      </Field>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={!trimmed}>
          Save name
        </Button>
      </DialogFooter>
    </form>
  );
}

/** Each account with its sign-in, the profiles it reaches and its ⋯ (Remove account), then a row to add another. */
function Accounts({
  connector,
  accounts,
  library,
}: {
  connector: ToolsConnector;
  accounts: LibraryEntry[];
  library: Library;
}) {
  const [isConnecting, setConnecting] = useState(false);
  return (
    <SettingsSection
      title="Accounts"
      footer="Two accounts on one service reach a thread as one server whose tools ask which account to use."
    >
      <SettingsCard>
        {accounts.map((account) => (
          <SettingsRow
            key={account.id}
            label={account.alias}
            description={
              account.isLinked === false ? (
                <span className="text-warning">
                  Signed out: its tools are left out of threads
                </span>
              ) : (
                'Signed in'
              )
            }
            control={
              <span className="flex items-center gap-2">
                <EntryActions entry={account} library={library} />
              </span>
            }
          />
        ))}
        <button
          type="button"
          onClick={() => setConnecting(true)}
          className="relative flex min-h-13 w-full items-center gap-3 px-4 py-2 text-left type-body text-muted-foreground outline-none transition-colors before:absolute before:inset-x-4 before:top-0 before:h-px before:bg-border last:rounded-b-xl hover:bg-accent/60 hover:text-foreground focus-visible:bg-accent/60 focus-visible:text-foreground"
        >
          <Plus aria-hidden className="size-4" />
          Add a {connector.name} account
        </button>
      </SettingsCard>
      <ConnectAccountDialog
        open={isConnecting}
        onOpenChange={setConnecting}
        url={connector.url}
        library={library}
      />
    </SettingsSection>
  );
}

// A filter only earns its place on a long list (GitHub lists ~100 tools).
const FILTER_FROM = 12;

function ToolPermissions({
  connector,
  settings,
  isListing,
  onList,
  onChange,
}: {
  connector: ToolsConnector;
  settings: ConnectorSettings;
  isListing: boolean;
  onList: () => void;
  onChange: Change;
}) {
  const [search, setSearch] = useState('');
  const query = search.trim();
  const all = settings.toolList?.tools ?? [];
  const tools = filterBy(all, query, (t) => [t.name, t.title, t.description]);
  return (
    <SettingsSection
      title="Tool permissions"
      action={
        all.length >= FILTER_FROM &&
        !settings.isOff && (
          <InputGroup className="h-7 w-48">
            <InputGroupAddon>
              <Search />
            </InputGroupAddon>
            <InputGroupInput
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && setSearch('')}
              placeholder="Filter tools"
              aria-label={`Filter ${connector.name}’s tools`}
            />
          </InputGroup>
        )
      }
      footer="Always allow runs a tool without asking, Needs approval waits on a card in the thread, Blocked leaves it out. Read-only tools start allowed and the rest need approval. Claude Code and Codex both get these as their own permission rules for each thread."
    >
      <SettingsCard>
        {settings.isOff ? (
          <EmptyRow
            text={`Off: threads don’t load ${connector.name}. Turn it on to choose per tool.`}
          />
        ) : (
          <ToolRows
            connector={connector}
            settings={settings}
            tools={tools}
            query={query}
            isListing={isListing}
            onList={onList}
            onChange={onChange}
          />
        )}
      </SettingsCard>
    </SettingsSection>
  );
}

function ToolRows({
  connector,
  settings,
  tools,
  query,
  isListing,
  onList,
  onChange,
}: {
  connector: ToolsConnector;
  settings: ConnectorSettings;
  tools: ConnectorTool[];
  query: string;
  isListing: boolean;
  onList: () => void;
  onChange: Change;
}) {
  const { toolList } = settings;
  if (!toolList) return <SkeletonRows count={3} />;
  if (toolList.error)
    return (
      <ListError
        name={connector.name}
        error={toolList.error}
        isListing={isListing}
        onRetry={onList}
      />
    );
  if (!toolList.tools.length)
    return <EmptyRow text={`${connector.name} lists no tools.`} />;
  if (!tools.length) return <EmptyRow text={`No tool matches “${query}”`} />;
  const groups = toolGroups(tools).filter((group) => group.tools.length > 0);
  return (
    <Accordion type="multiple" defaultValue={groups.map((g) => g.id)}>
      {groups.map((group) => (
        <ToolGroup
          key={group.id}
          id={group.id}
          connectorKey={connector.key}
          title={GROUP_TITLES[group.id]}
          tools={group.tools}
          settings={settings}
          onChange={onChange}
        />
      ))}
    </Accordion>
  );
}

const GROUP_TITLES = { read: 'Read-only tools', write: 'Write/delete tools' };

/** One annotation group, open by default: its count and one choice for every tool in it, then a row per tool. */
function ToolGroup({
  id,
  connectorKey,
  title,
  tools,
  settings,
  onChange,
}: {
  id: string;
  connectorKey: string;
  title: string;
  tools: ConnectorTool[];
  settings: ConnectorSettings;
  onChange: Change;
}) {
  return (
    // The primitive's own `not-last:border-b` would draw a second, full-width line under the inset hairline.
    <AccordionItem
      value={id}
      className="relative not-last:border-b-0 not-first:before:absolute not-first:before:inset-x-4 not-first:before:top-0 not-first:before:h-px not-first:before:bg-border"
    >
      {/* A menu can't sit inside the trigger, so it floats over the trigger's right end. */}
      <div className="absolute top-2 right-4 z-10">
        <GroupMenu
          title={title}
          permission={groupPermission(settings, tools)}
          onChange={(p) => onChange((s) => setTools(s, tools, p))}
        />
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
            <ToolRow
              key={tool.name}
              connectorKey={connectorKey}
              tool={tool}
              settings={settings}
              onChange={onChange}
            />
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
] as const satisfies {
  value: ToolPermission;
  label: string;
  icon: IconComponent;
}[];

const choiceOf = (permission: ToolPermission) =>
  CHOICES.find((c) => c.value === permission)!;

/** The group's permission when its tools agree ("Mixed" when they don't), and a menu that sets them all. */
function GroupMenu({
  title,
  permission,
  onChange,
}: {
  title: string;
  permission: ToolPermission | null;
  onChange: (permission: ToolPermission) => void;
}) {
  const current = permission && choiceOf(permission);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          aria-label={`${title}: ${current?.label ?? 'Mixed'}`}
        >
          {current && <current.icon data-icon="inline-start" />}
          {current?.label ?? 'Mixed'}
          <ChevronDown data-icon="inline-end" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuRadioGroup
          value={permission ?? ''}
          onValueChange={(v) => onChange(v as ToolPermission)}
        >
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
function ToolRow({
  connectorKey,
  tool,
  settings,
  onChange,
}: {
  connectorKey: string;
  tool: ConnectorTool;
  settings: ConnectorSettings;
  onChange: Change;
}) {
  const { permission } = toolPermission(settings, tool);
  const label = tool.title ?? deslug(tool.name);
  return (
    <li
      data-setting-id={`connector-${connectorKey}-${tool.name}`}
      className="relative flex min-h-12 items-center gap-3 py-1.5 pr-4 pl-10 before:absolute before:top-0 before:right-4 before:left-10 before:h-px before:bg-border"
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="min-w-0 flex-1 truncate type-body text-muted-foreground">
            {label}
          </span>
        </TooltipTrigger>
        <TooltipContent
          side="top"
          align="start"
          className="max-w-80 flex-col items-start gap-0.5"
        >
          <code className="block font-mono">{tool.name}</code>
          {!!tool.description && (
            <span className="block opacity-80">{tool.description}</span>
          )}
        </TooltipContent>
      </Tooltip>
      {/* Tooltip's data-state replaces the item's, so the chosen one is styled by aria-checked. */}
      <ToggleGroup
        type="single"
        spacing={0}
        value={permission}
        onValueChange={(v) =>
          v &&
          onChange((s) => ({
            ...s,
            tools: { ...s.tools, [tool.name]: v as ToolPermission },
          }))
        }
        aria-label={`${label}: permission`}
        className="shrink-0 rounded-lg bg-muted p-0.5"
      >
        {CHOICES.map((choice) => (
          <Tooltip key={choice.value}>
            <TooltipTrigger asChild>
              <ToggleGroupItem
                value={choice.value}
                aria-label={choice.label}
                size="sm"
                className="size-8 rounded-md! px-0! text-muted-foreground aria-checked:bg-background aria-checked:text-foreground aria-checked:shadow-xs aria-checked:ring-1 aria-checked:ring-input dark:aria-checked:bg-accent"
              >
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

function ListError({
  name,
  error,
  isListing,
  onRetry,
}: {
  name: string;
  error: string;
  isListing: boolean;
  onRetry: () => void;
}) {
  return (
    <SettingsRow
      label={`Couldn’t list ${name}’s tools`}
      description={<span className="text-warning">{error}</span>}
      control={
        <Button
          variant="outline"
          size="sm"
          disabled={isListing}
          onClick={onRetry}
        >
          Try again
        </Button>
      }
    />
  );
}

/** The header's real layout with placeholder bars, so the page doesn't jump when the library arrives. */
function LoadingPage() {
  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-col gap-4">
        <BackLink />
        <div className="flex items-center gap-3 px-1">
          <Skeleton className="size-10 rounded-lg" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-4 w-28" />
          </div>
        </div>
      </div>
      <SettingsCard>
        <SkeletonRows count={3} />
      </SettingsCard>
    </div>
  );
}

function MissingPage() {
  return (
    <div className="flex flex-col gap-4">
      <BackLink />
      <SettingsCard>
        <SettingsRow
          label="This connector isn’t connected anymore"
          description="Its last account was removed. Connect it again from Connectors to choose its tools."
          control={
            <Button
              variant="outline"
              size="sm"
              onClick={() => openSettings('connectors')}
            >
              Open Connectors
            </Button>
          }
        />
      </SettingsCard>
    </div>
  );
}
