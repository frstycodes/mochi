import { libraryMutationOptions, libraryQuery } from './queries';
import { useEffect } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { queryClient } from '../query.ts';
import { queryKeys } from '../queryKeys.ts';
import { toast } from '@/toast/store';
import { host } from '../host';
import type { Provider } from '../model';
import { useLibraryScope } from './libraryScope';
import { setLibraryNames } from './names';
import type { CatalogPlugin, CatalogSkill, LibraryEntry, Marketplace, SkillDestination } from './library';

/**
 * The profile's library entries, and every change to them; a failed change toasts and leaves the list as it was. What an
 * install adds goes to the profiles the library pages are scoped to (`useLibraryScope`).
 */
export function useLibrary(spaceId: string) {
  const { installTo } = useLibraryScope();
  const entriesQuery = useQuery(libraryQuery(spaceId));
  const entries = entriesQuery.data ?? null;
  useEffect(() => { if (entriesQuery.error) toast.error("Couldn't read the library", { description: entriesQuery.error.message }); }, [entriesQuery.error]);
  useEffect(() => { if (entries) setLibraryNames(entries); }, [entries]);
  const importMutation = useMutation({ mutationFn: (provider: Provider) => host.library.importFromAccount(spaceId, provider, ['skills', 'mcp']), onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.library.all() }) });
  const libraryMutation = useMutation(libraryMutationOptions);
  const apply = (failure: string) => (run: () => Promise<unknown>) =>
    libraryMutation.mutateAsync(run).then(() => true, (error: Error) => {
      toast.error(failure, { description: error.message });
      return false;
    });
  // The host adds a new item to the profile it's called for; the other profiles get it here, then the list is read again.
  const installed = async (install: (profileId: string) => Promise<LibraryEntry[]>) => {
    const before = new Set((entries ?? (await host.library.list(spaceId))).map((e) => e.id));
    const [first, ...rest] = installTo;
    const added = (await install(first)).filter((e) => !before.has(e.id));
    for (const profileId of rest) for (const entry of added) await host.library.setEnabled(profileId, entry.id, true);
    return host.library.list(spaceId);
  };
  return {
    entries,
    installTo,
    setEnabled: (entry: LibraryEntry, isEnabled: boolean) => apply(`${entry.title} not changed`)(() => host.library.setEnabled(spaceId, entry.id, isEnabled)),
    /** Hands an item to a profile, or takes it away; the list stays the one for `spaceId`. */
    setInProfile: (entry: LibraryEntry, profileId: string, isIn: boolean) =>
      apply(`${entry.title} not changed`)(() => host.library.setEnabled(profileId, entry.id, isIn).then(() => host.library.list(spaceId))),
    remove: (entry: LibraryEntry) => apply(`${entry.title} not removed`)(() => host.library.remove(spaceId, entry.id)),
    /** `source` is what the catalog was browsed from, so install reads the same (cached) repo. A reinstall keeps its profiles. */
    installSkill: (source: string, skill: CatalogSkill, destination?: SkillDestination) =>
      apply(`${skill.name} not installed`)(() => installed((profileId) => host.library.installSkill(profileId, source, skill.name, destination))),
    installPlugin: (marketplace: string, plugin: CatalogPlugin) => apply(`${plugin.title ?? plugin.name} not installed`)(() => installed((profileId) => host.library.installPlugin(profileId, marketplace, plugin.name))),
    /** Rejects with the reason instead of toasting, for the review dialog to show inline. */
    installUpload: (file: PluginFile, choice: Parameters<typeof host.library.installUpload>[2]) => libraryMutation.mutateAsync(() => host.library.installUpload(spaceId, file, choice)),
    addConnector: (account: NewConnector) => apply(`${account.alias} not connected`)(() => installed((profileId) => host.library.addConnector(profileId, account))),
    /** Names the connector `key`, every account on it. */
    renameConnector: (key: string, name: string) => apply(`${name} not renamed`)(() => host.library.renameConnector(spaceId, key, name)),
    signIn: (entry: LibraryEntry) => apply(`${entry.title} not signed in`)(() => host.library.signIn(spaceId, entry.id)),
    update: (entry: LibraryEntry) =>
      apply(`${entry.title} not updated`)(
        () => host.library.update(spaceId, entry.id).then((list) => {
          const isChanged = list.find((e) => e.id === entry.id)?.updatedAt !== entry.updatedAt;
          toast(isChanged ? `${entry.title} updated` : `${entry.title} is up to date`);
          return list;
        }),
      ),
    setAutoUpdate: (entry: LibraryEntry, autoUpdate: boolean) => apply(`${entry.title} not changed`)(() => host.library.update(spaceId, entry.id, autoUpdate)),
    importFromAccount: (provider: Provider) =>
      importMutation.mutateAsync(provider).then(
        ({ notes }) => notes,
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
  const entriesQuery = useQuery({ ...libraryQuery(spaceId ?? ''), enabled: !!spaceId });
  useEffect(() => { if (entriesQuery.data) setLibraryNames(entriesQuery.data); }, [entriesQuery.data]);
}

export type NewConnector = Parameters<typeof host.library.addConnector>[1];

type PluginFile = Parameters<typeof host.library.reviewUpload>[0];

/** The entry a catalog item became, if it is installed. */
export function installedEntry(entries: LibraryEntry[] | null, kind: LibraryEntry['kind'], name: string) {
  return entries?.find((e) => e.kind === kind && e.name === name);
}

export type Loaded<T> = { status: 'loading' } | { status: 'done'; value: T } | { status: 'error'; message: string };

/** One catalog read, again whenever `key` changes or on `retry`; a slow answer for an old key never lands. */
export function useLoaded<T>(key: string, load: () => Promise<T>) {
  const loadedQuery = useQuery({ queryKey: queryKeys.library.catalog(key), queryFn: load });
  const state: Loaded<T> = loadedQuery.isError ? { status: 'error', message: loadedQuery.error.message } : loadedQuery.data !== undefined ? { status: 'done', value: loadedQuery.data } : { status: 'loading' };
  return { state, retry: () => { void loadedQuery.refetch(); } };
}

/** The featured marketplaces then the user's, with adding and removing; read again whenever `key` changes. */
export function useMarketplaces(key = '') {
  const marketplacesQuery = useQuery({ queryKey: queryKeys.library.marketplaces.key(key), queryFn: () => host.library.marketplaces() });
  const marketplaceMutation = useMutation({ mutationFn: (run: () => Promise<Marketplace[]>) => run(), onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.library.marketplaces.all() }) });
  return {
    marketplaces: marketplacesQuery.data ?? (marketplacesQuery.isError ? [] : null),
    add: (source: string) => marketplaceMutation.mutateAsync(() => host.library.addMarketplace(source)),
    remove: (name: string) => marketplaceMutation.mutateAsync(() => host.library.removeMarketplace(name)).then(() => {}, (error: Error) => toast.error(`${name} not removed`, { description: error.message })),
  };
}
