import { useState, type ReactNode } from 'react';
import { SearchAlt } from '@/icons';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SettingsSection } from '../settings/parts';
import { useHarness } from '../store';
import { useLibrary, type Library } from './useLibrary';

type PageTab = 'library' | 'discover';

/** A page's half, as a component: the library, the search (trimmed, '' when none) and a way to Discover. */
export type PagePart = (props: { library: Library; query: string; showDiscover: () => void }) => ReactNode;

/**
 * Settings › Skills, Plugins and Connectors (LIBRARY.md), under Settings' own title. Everything is installed once
 * (Library) and handed to profiles item by item; Discover is where to get more. A search on the right looks through
 * both tabs at once, each half under its own heading. A new install goes to the profile you're in.
 */
export function LibraryPage({ id, noun, description, actions, count, library: LibraryPart, discover: DiscoverPart }: { id: string; noun: string; description: string; actions?: (props: { library: Library; showDiscover: () => void }) => ReactNode; count: (library: Library) => number; library: PagePart; discover: PagePart }) {
  const library = useLibrary(useHarness().state.spaceId);
  const [tab, setTab] = useState<PageTab>('library');
  const [search, setSearch] = useState('');
  const query = search.trim();
  const showDiscover = () => setTab('discover');
  const part = { library, query, showDiscover };
  const installed = count(library);
  return (
    <div data-setting-id={id} className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 px-1 sm:flex-row sm:items-start sm:justify-between">
        <p className="type-meta text-pretty text-muted-foreground">{description}</p>
        {!!actions && <div className="flex shrink-0 items-center gap-2">{actions({ library, showDiscover })}</div>}
      </div>
      {/* While searching no tab is chosen: both halves show. Picking a tab clears the search. */}
      <Tabs
        value={query ? '' : tab}
        onValueChange={(v) => {
          setTab(v as PageTab);
          setSearch('');
        }}
        className="gap-8"
      >
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-end sm:justify-between sm:shadow-[inset_0_-1px_0_var(--color-border)]">
          <TabsList variant="line" className="w-full justify-start sm:w-auto sm:shadow-none">
            <TabsTrigger value="library" className="flex-none px-2">
              Library
              {installed > 0 && <span className="text-subtle-foreground tabular">{installed}</span>}
            </TabsTrigger>
            <TabsTrigger value="discover" className="flex-none px-2">
              Discover
            </TabsTrigger>
          </TabsList>
          <InputGroup className="h-8 sm:mb-1.5 sm:w-64">
            <InputGroupAddon>
              <SearchAlt />
            </InputGroupAddon>
            <InputGroupInput value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setSearch('')} placeholder={`Search ${noun}`} aria-label={`Search ${noun} in your library and Discover`} />
          </InputGroup>
        </div>
        {query ? (
          <div className="flex flex-col gap-10">
            <SettingsSection title="In your library">
              <LibraryPart {...part} />
            </SettingsSection>
            <SettingsSection title="In Discover">
              <DiscoverPart {...part} />
            </SettingsSection>
          </div>
        ) : (
          <>
            <TabsContent value="library" className="flex flex-col gap-10">
              <LibraryPart {...part} />
            </TabsContent>
            <TabsContent value="discover" className="flex flex-col gap-10">
              <DiscoverPart {...part} />
            </TabsContent>
          </>
        )}
      </Tabs>
    </div>
  );
}
