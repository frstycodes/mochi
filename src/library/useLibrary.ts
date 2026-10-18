import { useCallback, useEffect, useState } from 'react';
import { toast } from '@/toast/store';
import { host } from '../host';
import type { Provider } from '../model';
import { setLibraryNames } from './names';
import type { CatalogPlugin, CatalogSkill, LibraryEntry, Marketplace } from './library';

/** The profile's library entries, and every change to them; a failed change toasts and leaves the list as it was. */
export function useLibrary(spaceId: string) {
  const [entries, setListed] = useState<LibraryEntry[] | null>(null);
  const setEntries = useCallback((list: LibraryEntry[]) => {
    setListed(list);
    setLibraryNames(list);
  }, []);
  useEffect(() => {
    let isLive = true;
    setListed(null);
    host.library.list(spaceId).then(
      (list) => isLive && setEntries(list),
      (error: Error) => toast.error("Couldn't read the library", { description: error.message }),
    );
    return () => void (isLive = false);
  }, [spaceId, setEntries]);
  const apply = (failure: string) => (next: Promise<LibraryEntry[]>) =>
    next.then(
      (list) => {
        setEntries(list);
        return true;
      },
      (error: Error) => {
        toast.error(failure, { description: error.message });
        // A failed step can still have changed something (an account added before its sign-in failed).
        void host.library.list(spaceId).then(setEntries, () => {});
        return false;
      },
    );
  return {
    entries,
    setEnabled: (entry: LibraryEntry, isEnabled: boolean) => apply(`${entry.title} not changed`)(host.library.setEnabled(spaceId, entry.id, isEnabled)),
    /** Hands an item to a profile, or takes it away; the list stays the one for `spaceId`. */
    setInProfile: (entry: LibraryEntry, profileId: string, isIn: boolean) =>
      apply(`${entry.title} not changed`)(host.library.setEnabled(profileId, entry.id, isIn).then(() => host.library.list(spaceId))),
    remove: (entry: LibraryEntry) => apply(`${entry.title} not removed`)(host.library.remove(spaceId, entry.id)),
    /** `source` is what the catalog was browsed from, so install reads the same (cached) repo. */
    installSkill: (source: string, skill: CatalogSkill) => apply(`${skill.name} not installed`)(host.library.installSkill(spaceId, source, skill.name)),
    installPlugin: (marketplace: string, plugin: CatalogPlugin) => apply(`${plugin.title ?? plugin.name} not installed`)(host.library.installPlugin(spaceId, marketplace, plugin.name)),
    addConnector: (account: NewConnector) => apply(`${account.alias} not connected`)(host.library.addConnector(spaceId, account)),
    signIn: (entry: LibraryEntry) => apply(`${entry.title} not signed in`)(host.library.signIn(spaceId, entry.id)),
    update: (entry: LibraryEntry) =>
      apply(`${entry.title} not updated`)(
        host.library.update(spaceId, entry.id).then((list) => {
          const isChanged = list.find((e) => e.id === entry.id)?.updatedAt !== entry.updatedAt;
          toast(isChanged ? `${entry.title} updated` : `${entry.title} is up to date`);
          return list;
        }),
      ),
    setAutoUpdate: (entry: LibraryEntry, autoUpdate: boolean) => apply(`${entry.title} not changed`)(host.library.update(spaceId, entry.id, autoUpdate)),
    importFromAccount: (provider: Provider) =>
      host.library.importFromAccount(spaceId, provider, ['skills', 'mcp']).then(
        ({ entries: list, notes }) => {
          setEntries(list);
          return notes;
        },
        (error: Error) => {
          toast.error('Nothing imported', { description: error.message });
          return null;
        },
      ),
  };
}

export type Library = ReturnType<typeof useLibrary>;

/** Reads the library once per profile, so threads name its skills, plugins and connectors (`useLibraryNames`). */
export function useLibraryNamesLoader(spaceId: string | undefined) {
  useEffect(() => {
    if (spaceId) host.library.list(spaceId).then(setLibraryNames, () => {});
  }, [spaceId]);
}

export type NewConnector = Parameters<typeof host.library.addConnector>[1];

/** The entry a catalog item became, if it is installed. */
export function installedEntry(entries: LibraryEntry[] | null, kind: LibraryEntry['kind'], name: string) {
  return entries?.find((e) => e.kind === kind && e.name === name);
}

export type Loaded<T> = { status: 'loading' } | { status: 'done'; value: T } | { status: 'error'; message: string };

/** One catalog read, again whenever `key` changes or on `retry`; a slow answer for an old key never lands. */
export function useLoaded<T>(key: string, load: () => Promise<T>) {
  const [state, setState] = useState<Loaded<T>>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let isLive = true;
    setState({ status: 'loading' });
    load().then(
      (value) => isLive && setState({ status: 'done', value }),
      (error: Error) => isLive && setState({ status: 'error', message: error.message }),
    );
    return () => void (isLive = false);
  }, [key, attempt]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { state, retry };
}

/** The featured marketplaces then the user's, with adding and removing; read again whenever `key` changes. */
export function useMarketplaces(key = '') {
  const [marketplaces, setMarketplaces] = useState<Marketplace[] | null>(null);
  useEffect(() => {
    host.library.marketplaces().then(setMarketplaces, () => setMarketplaces([]));
  }, [key]);
  return {
    marketplaces,
    add: (source: string) =>
      host.library.addMarketplace(source).then((list) => {
        setMarketplaces(list);
        return list;
      }),
    remove: (name: string) =>
      host.library.removeMarketplace(name).then(setMarketplaces, (error: Error) => toast.error(`${name} not removed`, { description: error.message })),
  };
}
