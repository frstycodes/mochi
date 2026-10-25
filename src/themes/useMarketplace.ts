import { useDebounced } from '../hooks/useDebounced';
import { useEffect, useRef, useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useTheme } from 'next-themes';
import { host } from '../host';
import { getPrefs } from '../settings/prefs';
import { slotsUsing, type PackageGroup } from './groups';
import { slotOf, type ColorTheme } from './model';
import { PAGE_SIZE, type MarketplaceExtension } from './openVsx';
import { chooseTheme, refreshThemes } from './store';
import { queryKeys } from '../queryKeys';

type SearchState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | {
      status: 'done';
      total: number;
      extensions: MarketplaceExtension[];
      isLoadingMore: boolean;
    };

// Typing pauses this long before Open VSX is asked.
const DEBOUNCE_MS = 300;

/** Open VSX's Themes category for `query`, one page at a time; `more` appends the next. */
export function useMarketplaceSearch(query: string) {
  const search = useDebounced(query, DEBOUNCE_MS);
  const searchQuery = useInfiniteQuery({
    queryKey: queryKeys.themes.search(search),
    queryFn: ({ pageParam }) => host.themes.search(search, pageParam),
    initialPageParam: 0,
    getNextPageParam: (last, _pages, offset) =>
      offset + PAGE_SIZE < last.total ? offset + PAGE_SIZE : undefined,
  });
  const state: SearchState =
    query !== search
      ? { status: 'loading' }
      : searchQuery.data
        ? {
            status: 'done',
            total: searchQuery.data.pages[0].total,
            extensions: dedupe(
              searchQuery.data.pages.flatMap((page) => page.extensions),
            ),
            isLoadingMore: searchQuery.isFetchingNextPage,
          }
        : searchQuery.isError
          ? { status: 'error', message: searchQuery.error.message }
          : { status: 'loading' };
  return {
    state,
    more: () => {
      if (!searchQuery.isFetching && searchQuery.hasNextPage)
        void searchQuery.fetchNextPage();
    },
    hasMore: searchQuery.hasNextPage,
    retry: () => {
      void searchQuery.refetch();
    },
  };
}

const dedupe = (list: MarketplaceExtension[]) => [
  ...new Map(list.map((e) => [`${e.namespace}.${e.name}`, e])).values(),
];

type InspectState =
  | { status: 'idle' | 'loading' }
  | { status: 'error'; message: string }
  | { status: 'done'; themes: ColorTheme[] };

/** An extension's themes, downloaded once `isVisible` turns true (rows scrolled into view), for swatches and preview. */
export function useInspectedThemes(
  extension: MarketplaceExtension,
  isVisible: boolean,
) {
  const { namespace, name, version, displayName } = extension;
  const themesQuery = useQuery({
    queryKey: queryKeys.themes.inspect(namespace, name, version, displayName),
    queryFn: () => host.themes.inspect(namespace, name, version, displayName),
    enabled: isVisible,
    staleTime: Infinity,
  });
  const state: InspectState = themesQuery.data
    ? { status: 'done', themes: themesQuery.data }
    : themesQuery.isError
      ? { status: 'error', message: themesQuery.error.message }
      : { status: isVisible ? 'loading' : 'idle' };
  return state;
}

/** True once the element has come within 200px of the viewport; stays true. */
export function useSeen<T extends Element>() {
  const ref = useRef<T>(null);
  const [isSeen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || isSeen) return;
    const observer = new IntersectionObserver(
      ([entry]) => entry.isIntersecting && setSeen(true),
      { rootMargin: '200px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [isSeen]);
  return [ref, isSeen] as const;
}

/**
 * Uses `theme` for its own appearance. When Light or Dark is forced to the other appearance it switches too, so the
 * choice shows; under System it waits for the OS.
 */
export function useApplyTheme() {
  const { theme: appearance, setTheme } = useTheme();
  return (
    theme: ColorTheme | null,
    slot = theme ? slotOf(theme.kind) : 'dark',
  ) => {
    chooseTheme(theme, slot);
    if (appearance !== 'system' && appearance !== slot) setTheme(slot);
  };
}

/** Installs every theme of a marketplace extension and refreshes the installed list. */
export async function installExtension(extension: MarketplaceExtension) {
  const themes = await host.themes.install(
    extension.namespace,
    extension.name,
    extension.version,
    extension.displayName,
  );
  await refreshThemes();
  return themes;
}

/** Uninstalls a package with all its themes; a slot that was showing one of them goes back to Mochi. */
export async function uninstallPackage(group: PackageGroup) {
  releaseSlots(group.themes);
  await host.themes.uninstall(group.namespace, group.name);
  await refreshThemes();
}

/** Deletes one custom theme file, handing its slot back to Mochi if it was in use. */
export async function removeCustomTheme(theme: ColorTheme, file: string) {
  releaseSlots([theme]);
  await host.themes.removeCustom(file);
  await refreshThemes();
}

const releaseSlots = (themes: ColorTheme[]) =>
  slotsUsing(themes, getPrefs()).forEach((slot) => chooseTheme(null, slot));
