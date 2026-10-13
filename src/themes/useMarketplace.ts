import { useEffect, useRef, useState } from 'react';
import { useTheme } from 'next-themes';
import { host } from '../host';
import { slotOf, type ColorTheme } from './model';
import { PAGE_SIZE, type MarketplaceExtension } from './openVsx';
import { chooseTheme, refreshThemes } from './store';

type SearchState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'done'; total: number; extensions: MarketplaceExtension[]; isLoadingMore: boolean };

// Typing pauses this long before Open VSX is asked.
const DEBOUNCE_MS = 300;

/** Open VSX's Themes category for `query`, one page at a time; `more` appends the next. */
export function useMarketplaceSearch(query: string) {
  const [state, setState] = useState<SearchState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const offset = useRef(0);
  const current = useRef(0);

  useEffect(() => {
    const run = ++current.current;
    setState({ status: 'loading' });
    const timer = setTimeout(() => {
      host.themes.search(query, 0).then(
        (result) => {
          if (run !== current.current) return;
          offset.current = PAGE_SIZE;
          setState({ status: 'done', total: result.total, extensions: result.extensions, isLoadingMore: false });
        },
        (error: Error) => run === current.current && setState({ status: 'error', message: error.message }),
      );
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, attempt]);

  const more = () => {
    if (state.status !== 'done' || state.isLoadingMore) return;
    const run = current.current;
    setState({ ...state, isLoadingMore: true });
    void host.themes.search(query, offset.current).then(
      (result) => {
        if (run !== current.current) return;
        offset.current += PAGE_SIZE;
        setState((s) => (s.status === 'done' ? { ...s, extensions: dedupe([...s.extensions, ...result.extensions]), isLoadingMore: false } : s));
      },
      () => run === current.current && setState((s) => (s.status === 'done' ? { ...s, isLoadingMore: false } : s)),
    );
  };

  const hasMore = state.status === 'done' && offset.current < state.total;
  return { state, more, hasMore, retry: () => setAttempt((n) => n + 1) };
}

const dedupe = (list: MarketplaceExtension[]) => [...new Map(list.map((e) => [`${e.namespace}.${e.name}`, e])).values()];

type InspectState = { status: 'idle' | 'loading' } | { status: 'error'; message: string } | { status: 'done'; themes: ColorTheme[] };

/** An extension's themes, downloaded once `isVisible` turns true (rows scrolled into view), for swatches and preview. */
export function useInspectedThemes(extension: MarketplaceExtension, isVisible: boolean) {
  const [state, setState] = useState<InspectState>({ status: 'idle' });
  const { namespace, name, version, displayName } = extension;
  useEffect(() => {
    if (!isVisible) return;
    let isCurrent = true;
    setState({ status: 'loading' });
    host.themes.inspect(namespace, name, version, displayName).then(
      (themes) => isCurrent && setState({ status: 'done', themes }),
      (error: Error) => isCurrent && setState({ status: 'error', message: error.message }),
    );
    return () => void (isCurrent = false);
  }, [isVisible, namespace, name, version, displayName]);
  return state;
}

/** True once the element has come within 200px of the viewport; stays true. */
export function useSeen<T extends Element>() {
  const ref = useRef<T>(null);
  const [isSeen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || isSeen) return;
    const observer = new IntersectionObserver(([entry]) => entry.isIntersecting && setSeen(true), { rootMargin: '200px' });
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
  return (theme: ColorTheme | null, slot = theme ? slotOf(theme.kind) : 'dark') => {
    chooseTheme(theme, slot);
    if (appearance !== 'system' && appearance !== slot) setTheme(slot);
  };
}

/** Installs every theme of a marketplace extension and refreshes the installed list. */
export async function installExtension(extension: MarketplaceExtension) {
  const themes = await host.themes.install(extension.namespace, extension.name, extension.version, extension.displayName);
  await refreshThemes();
  return themes;
}
