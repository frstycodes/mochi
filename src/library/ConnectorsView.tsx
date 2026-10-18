import { useState } from 'react';
import { Plus } from '@/icons';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { SettingsCard, SettingsRow, SettingsSection, SkeletonRows } from '../settings/parts';
import { ConnectAccountDialog } from './ConnectDialog';
import { CONNECTORS, connectorFor, connectorIcon, isSameServer, type Connector } from './connectors';
import type { LibraryEntry } from './library';
import { LibraryPage, type PagePart } from './LibraryPage';
import { ALL, CategoryChips, countOf, EmptyRow, EntryActions, filterBy, InstalledList, LibraryIcon, LibraryRow, LIST } from './LibraryParts';
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
  const on = entries.filter((e) => e.kind === 'connector' || e.kind === 'server');
  return new Set(on.map((e) => (e.kind === 'connector' ? e.source : e.id))).size;
}

function CustomServerButton({ library }: { library: Library }) {
  const [isOpen, setOpen] = useState(false);
  return (
    <>
      <Button size="xs" onClick={() => setOpen(true)}>
        <Plus />
        Add custom server
      </Button>
      <ConnectAccountDialog open={isOpen} onOpenChange={setOpen} library={library} />
    </>
  );
}

// {LIBRARY}

function Connected({ library, query, showDiscover }: Parameters<PagePart>[0]) {
  const accounts = library.entries?.filter((e) => e.kind === 'connector');
  const servers = library.entries?.filter((e) => e.kind === 'server') ?? [];
  const services = accounts && filterBy(byService(accounts), query, (s) => [s.name, s.url, ...s.accounts.map((a) => a.alias)]);
  const shownServers = filterBy(servers, query, (e) => [e.title, e.description]);
  const isEmpty = !!services && !services.length && !shownServers.length;
  return (
    <>
      <SettingsSection>
        <SettingsCard>
          {!services && <SkeletonRows count={2} />}
          {isEmpty && (query ? <EmptyRow text={`Nothing in your library matches “${query}”`} /> : <NothingConnected onDiscover={showDiscover} />)}
          {!!services?.length && (
            <Accordion type="multiple">
              {services.map((service) => (
                <ServiceRow key={service.url} service={service} library={library} />
              ))}
            </Accordion>
          )}
        </SettingsCard>
      </SettingsSection>
      {shownServers.length > 0 && (
        <SettingsSection title="Local servers" footer={!query && 'Programs on this computer that threads start, imported from an account or a plugin.'}>
          <InstalledList entries={shownServers} library={library} query="" empty={null} />
        </SettingsSection>
      )}
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

type Service = { url: string; name: string; icon: string | null; accounts: LibraryEntry[] };

/** Connector accounts by the server they're on, each service where its first account was added. */
function byService(accounts: LibraryEntry[]): Service[] {
  const groups = new Map<string, LibraryEntry[]>();
  for (const account of accounts) {
    const url = (account.source ?? account.id).replace(/\/+$/, '');
    groups.set(url, [...(groups.get(url) ?? []), account]);
  }
  return [...groups].map(([url, list]) => ({ url, name: connectorFor(url)?.name ?? (URL.canParse(url) ? new URL(url).hostname : url), icon: list[0].icon, accounts: list }));
}

/** One service, closed to a line saying which accounts it has; opened, each account with its sign-in and switch. */
function ServiceRow({ service, library }: { service: Service; library: Library }) {
  const [isConnecting, setConnecting] = useState(false);
  const { accounts } = service;
  const aliases = accounts.flatMap((a) => (a.alias ? [a.alias] : []));
  const signedOut = accounts.filter((a) => a.isLinked === false).length;
  return (
    <AccordionItem value={service.url} className="relative not-last:border-b-0 not-first:before:absolute not-first:before:inset-x-4 not-first:before:top-0 not-first:before:h-px not-first:before:bg-border">
      <AccordionTrigger className="items-center gap-3 rounded-none px-4 py-3 font-normal hover:no-underline">
        <LibraryIcon key={service.icon} url={service.icon} letter={service.name} />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate type-body font-medium">{service.name}</span>
          <span className="truncate type-caption text-subtle-foreground">
            {countOf(accounts.length, 'account')} · {LIST.format(aliases)}
          </span>
          {signedOut > 0 && <span className="type-caption text-warning">{signedOut} signed out</span>}
        </span>
      </AccordionTrigger>
      <AccordionContent className="bg-muted/30 p-0">
        <ul aria-label={`${service.name} accounts`}>
          {accounts.map((account) => (
            <li key={account.id} className={NESTED_ROW}>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate type-body">{account.alias}</span>
                <span className={account.isLinked === false ? 'type-caption text-warning' : 'type-caption text-subtle-foreground'}>{account.isLinked === false ? 'Signed out: its tools are left out of threads' : 'Signed in'}</span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <EntryActions entry={account} library={library} />
              </span>
            </li>
          ))}
          <li>
            <button type="button" onClick={() => setConnecting(true)} className={cn(NESTED_ROW, 'min-h-13 w-full text-left type-body text-muted-foreground outline-none transition-colors hover:bg-accent/40 hover:text-foreground focus-visible:bg-accent/40 focus-visible:text-foreground')}>
              <Plus aria-hidden className="size-4" />
              Add a {service.name} account
            </button>
          </li>
        </ul>
        <ConnectAccountDialog open={isConnecting} onOpenChange={setConnecting} url={service.url} library={library} />
      </AccordionContent>
    </AccordionItem>
  );
}

// A row inside an open service: indented to the service's name, split from the row above by the card's inset hairline.
const NESTED_ROW = 'relative flex items-center gap-3 py-2 pr-4 pl-4 before:absolute before:inset-x-4 before:top-0 before:h-px before:bg-border sm:pl-17';

// {DISCOVER}

function Directory({ library, query }: Parameters<PagePart>[0]) {
  const [category, setCategory] = useState(ALL);
  const accounts = library.entries?.filter((e) => e.kind === 'connector') ?? [];
  const needed = filterBy(neededRemotes(library.entries ?? []), query, (r) => [r.name, r.url, r.plugin]);
  // A search looks through every category.
  const inCategory = category === ALL || query ? CONNECTORS : CONNECTORS.filter((c) => c.category === category);
  const shown = filterBy(inCategory, query, (c) => [c.name, c.description, c.category]);
  return (
    <>
      {needed.length > 0 && (
        <SettingsSection title="Needed by your plugins">
          <SettingsCard>
            {needed.map((remote) => (
              <ConnectorRow key={remote.url} connector={{ id: remote.url, name: remote.name, description: `Used by ${remote.plugin}`, category: 'Engineering', serverUrl: remote.url }} accounts={[]} library={library} />
            ))}
          </SettingsCard>
        </SettingsSection>
      )}
      <SettingsSection title={!query && 'Directory'} footer={!query && 'Each account signs in once, in your browser, and its tokens stay in this computer’s keychain. For anything not listed, use Add custom server.'}>
        {!query && <CategoryChips categories={[...new Set(CONNECTORS.map((c) => c.category))]} value={category} onChange={setCategory} />}
        <SettingsCard>
          {!shown.length && <EmptyRow text={query ? `No connector matches “${query}”` : 'No connector in this category'} />}
          {shown.map((connector) => (
            <ConnectorRow key={connector.id} connector={connector} accounts={accounts.filter((a) => !!a.source && isSameServer(a.source, connector.serverUrl))} library={library} />
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
      .filter((remote) => !connected.some((c) => !!c.source && isSameServer(c.source, remote.url)) && !CONNECTORS.some((c) => isSameServer(c.serverUrl, remote.url)))
      .map((remote) => ({ ...remote, plugin: entry.title })),
  );
}

function ConnectorRow({ connector, accounts, library }: { connector: Connector; accounts: LibraryEntry[]; library: Library }) {
  const [isConnecting, setConnecting] = useState(false);
  const aliases = accounts.flatMap((a) => (a.alias ? [a.alias] : []));
  return (
    <LibraryRow
      name={connector.name}
      icon={connectorIcon(connector.serverUrl)}
      description={connector.description}
      meta={aliases.length ? `${connector.category} · ${LIST.format(aliases)}` : connector.category}
      actions={
        <>
          <Button variant="outline" size="sm" onClick={() => setConnecting(true)} aria-label={`Connect a ${connector.name} account`}>
            <Plus data-icon="inline-start" />
            {aliases.length ? 'Add another' : 'Connect'}
          </Button>
          <ConnectAccountDialog open={isConnecting} onOpenChange={setConnecting} url={connector.serverUrl} library={library} />
        </>
      }
    />
  );
}
