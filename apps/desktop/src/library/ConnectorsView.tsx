import { useState } from 'react';
import { CheckCircle, ChevronRight, Plus } from '@/icons';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { openSubpage } from '../routes/nav';
import {
  SettingsCard,
  SettingsRow,
  SettingsSection,
  SkeletonRows,
} from '../settings/parts';
import { ConnectAccountDialog } from './ConnectDialog';
import {
  CONNECTORS,
  connectorIcon,
  connectorKey,
  isSameServer,
  type Connector,
} from '@mochi/domain/library/connectors';
import { useLibraryScope } from './libraryScope';
import { serviceName } from './names';
import type { LibraryEntry } from './library';
import { NativeSections } from './NativeSections';
import { LibraryPage, type PagePart } from './LibraryPage';
import {
  ALL,
  CategoryChips,
  countOf,
  EmptyRow,
  filterBy,
  InstalledList,
  LibraryIcon,
  LibraryRow,
  LIST,
} from './LibraryParts';
import type { Library } from './useLibrary';

/** Settings › Connectors: every connected account and local server, which profiles reach each, and a directory of services to connect. */
export function ConnectorsView() {
  return (
    <LibraryPage
      id="connectorsLibrary"
      noun="connectors"
      description="Each account is connected once, then handed to the profiles that should reach it, account by account. Two accounts on one service reach a thread as one server whose tools ask which account to use."
      count={({ entries }) => countConnected(entries ?? [])}
      actions={({ library }) => <CustomServerButton library={library} />}
      library={Connected}
      discover={Directory}
    />
  );
}

/** Services with an account, and local servers; several accounts on one service count once. */
function countConnected(entries: LibraryEntry[]) {
  const on = entries.filter(
    (e) => e.kind === 'connector' || e.kind === 'server',
  );
  return new Set(on.map((e) => (e.kind === 'connector' ? e.source : e.id)))
    .size;
}

function CustomServerButton({ library }: { library: Library }) {
  const [isOpen, setOpen] = useState(false);
  return (
    <>
      <Button size="xs" onClick={() => setOpen(true)}>
        <Plus />
        Add custom server
      </Button>
      <ConnectAccountDialog
        open={isOpen}
        onOpenChange={setOpen}
        library={library}
      />
    </>
  );
}

// {LIBRARY}

function Connected({ library, query, showDiscover }: Parameters<PagePart>[0]) {
  const accounts = library.entries?.filter((e) => e.kind === 'connector');
  const servers = library.entries?.filter((e) => e.kind === 'server') ?? [];
  const services =
    accounts &&
    filterBy(byService(accounts), query, (s) => [
      s.name,
      s.url,
      ...s.accounts.map((a) => a.alias),
    ]);
  const shownServers = filterBy(servers, query, (e) => [
    e.title,
    e.description,
  ]);
  const isEmpty = !!services && !services.length && !shownServers.length;
  return (
    <>
      <SettingsSection title="In Mochi">
        <SettingsCard>
          {!services && <SkeletonRows count={2} />}
          {isEmpty &&
            (query ? (
              <EmptyRow text={`Nothing in your library matches “${query}”`} />
            ) : (
              <NothingConnected onDiscover={showDiscover} />
            ))}
          {services?.map((service) => (
            <ServiceRow key={service.url} service={service} />
          ))}
        </SettingsCard>
      </SettingsSection>
      {shownServers.length > 0 && (
        <SettingsSection
          title="Local servers"
          footer={
            !query &&
            'Programs on this computer that threads start, imported from an account or a plugin.'
          }
        >
          <InstalledList
            entries={shownServers}
            library={library}
            query=""
            empty={null}
          />
        </SettingsSection>
      )}
      <NativeSections kinds={['server', 'connector']} query={query} />
    </>
  );
}

function NothingConnected({ onDiscover }: { onDiscover: () => void }) {
  return (
    <SettingsRow
      label="Nothing connected yet"
      description="Connect Gmail, Linear, GitHub and more, with as many accounts each as you need."
      control={
        <Button variant="outline" size="sm" onClick={onDiscover}>
          Discover connectors
        </Button>
      }
    />
  );
}

type Service = {
  url: string;
  key: string;
  name: string;
  icon: string | null;
  accounts: LibraryEntry[];
};

/** Connector accounts by the server they're on, each service where its first account was added. */
function byService(accounts: LibraryEntry[]): Service[] {
  const groups = new Map<string, LibraryEntry[]>();
  for (const account of accounts) {
    const url = (account.source ?? account.id).replace(/\/+$/, '');
    groups.set(url, [...(groups.get(url) ?? []), account]);
  }
  return [...groups].map(([url, list]) => ({
    url,
    key: URL.canParse(url) ? connectorKey(url) : url,
    name: serviceName(list[0]),
    icon: list[0].icon,
    accounts: list,
  }));
}

/**
 * One service as a settings row that opens its own page: tile, name and accounts, then its status beside the chevron;
 * for a picked profile, how many of its accounts that profile reaches (accounts are switched on the service's page).
 */
function ServiceRow({ service }: { service: Service }) {
  const { accounts } = service;
  const { profile } = useLibraryScope();
  const inProfile =
    profile && accounts.filter((a) => a.profileIds.includes(profile.id)).length;
  const aliases = accounts.flatMap((a) => (a.alias ? [a.alias] : []));
  const signedOut = accounts.filter((a) => a.isLinked === false).length;
  return (
    <button
      type="button"
      onClick={() => openSubpage('connectors', service.key)}
      className="relative flex w-full items-center gap-3 px-4 py-3 text-left outline-none transition-colors not-first:before:absolute not-first:before:inset-x-4 not-first:before:top-0 not-first:before:h-px not-first:before:bg-border first:rounded-t-xl last:rounded-b-xl hover:bg-accent/40 focus-visible:bg-accent/40"
    >
      <span className={cn('flex', inProfile === 0 && 'opacity-60')}>
        <LibraryIcon
          key={service.icon}
          url={service.icon}
          letter={service.name}
        />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span
          className={cn(
            'truncate type-body font-medium',
            inProfile === 0 && 'text-muted-foreground',
          )}
        >
          {service.name}
        </span>
        <span className="truncate type-caption text-subtle-foreground">
          {countOf(accounts.length, 'account')} · {LIST.format(aliases)}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-2">
        {!!profile && inProfile !== accounts.length && (
          <span className="type-meta text-muted-foreground tabular">
            {inProfile
              ? `${inProfile} of ${accounts.length} in ${profile.name}`
              : `Off in ${profile.name}`}
          </span>
        )}
        {signedOut ? (
          <span className="type-meta text-warning">{signedOut} signed out</span>
        ) : (
          <CheckCircle
            aria-label="Every account signed in"
            className="size-4 text-muted-foreground"
          />
        )}
        <ChevronRight aria-hidden className="size-4 text-subtle-foreground" />
      </span>
    </button>
  );
}

// {DISCOVER}

function Directory({ library, query }: Parameters<PagePart>[0]) {
  const [category, setCategory] = useState(ALL);
  const accounts = library.entries?.filter((e) => e.kind === 'connector') ?? [];
  const needed = filterBy(neededRemotes(library.entries ?? []), query, (r) => [
    r.name,
    r.url,
    r.plugin,
  ]);
  // A search looks through every category.
  const inCategory =
    category === ALL || query
      ? CONNECTORS
      : CONNECTORS.filter((c) => c.category === category);
  const shown = filterBy(inCategory, query, (c) => [
    c.name,
    c.description,
    c.category,
  ]);
  return (
    <>
      {needed.length > 0 && (
        <SettingsSection title="Needed by your plugins">
          <SettingsCard>
            {needed.map((remote) => (
              <ConnectorRow
                key={remote.url}
                connector={{
                  id: remote.url,
                  name: remote.name,
                  description: `Used by ${remote.plugin}`,
                  category: 'Engineering',
                  serverUrl: remote.url,
                }}
                accounts={[]}
                library={library}
              />
            ))}
          </SettingsCard>
        </SettingsSection>
      )}
      <SettingsSection
        title={!query && 'Directory'}
        footer={
          !query &&
          'Each account signs in once, in your browser, and its tokens stay in this computer’s keychain. For anything not listed, use Add custom server.'
        }
      >
        {!query && (
          <CategoryChips
            categories={[...new Set(CONNECTORS.map((c) => c.category))]}
            value={category}
            onChange={setCategory}
          />
        )}
        <SettingsCard>
          {!shown.length && (
            <EmptyRow
              text={
                query
                  ? `No connector matches “${query}”`
                  : 'No connector in this category'
              }
            />
          )}
          {shown.map((connector) => (
            <ConnectorRow
              key={connector.id}
              connector={connector}
              accounts={accounts.filter(
                (a) =>
                  !!a.source && isSameServer(a.source, connector.serverUrl),
              )}
              library={library}
            />
          ))}
        </SettingsCard>
      </SettingsSection>
    </>
  );
}

/** Remote servers installed plugins expect that no account covers and the directory doesn't list. */
function neededRemotes(entries: LibraryEntry[]) {
  const connected = entries.filter((e) => e.kind === 'connector');
  return entries.flatMap((entry) =>
    entry.remotes
      .filter(
        (remote) =>
          !connected.some(
            (c) => !!c.source && isSameServer(c.source, remote.url),
          ) && !CONNECTORS.some((c) => isSameServer(c.serverUrl, remote.url)),
      )
      .map((remote) => ({ ...remote, plugin: entry.title })),
  );
}

function ConnectorRow({
  connector,
  accounts,
  library,
}: {
  connector: Connector;
  accounts: LibraryEntry[];
  library: Library;
}) {
  const [isConnecting, setConnecting] = useState(false);
  const aliases = accounts.flatMap((a) => (a.alias ? [a.alias] : []));
  return (
    <LibraryRow
      name={connector.name}
      icon={connectorIcon(connector.serverUrl)}
      description={connector.description}
      meta={
        aliases.length
          ? `${connector.category} · ${LIST.format(aliases)}`
          : connector.category
      }
      actions={
        <>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setConnecting(true)}
            aria-label={`Connect a ${connector.name} account`}
          >
            <Plus data-icon="inline-start" />
            {aliases.length ? 'Add another' : 'Connect'}
          </Button>
          <ConnectAccountDialog
            open={isConnecting}
            onOpenChange={setConnecting}
            url={connector.serverUrl}
            library={library}
          />
        </>
      }
    />
  );
}
