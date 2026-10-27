import { useState, type ReactNode } from 'react';
import { ChevronDown, Search, Users } from '@/icons';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@/components/ui/input-group';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useProfiles } from '../profiles';
import { useHarnessSelector } from '../store';
import { SpaceIcon } from '../ui';
import { ALL_PROFILES, setLibraryScope, useLibraryScope } from './libraryScope';
import { useLibrary, type Library } from './useLibrary';

type PageTab = 'library' | 'discover';

/** A page's half, as a component: the library, the search (trimmed, '' when none) and a way to Discover. */
export type PagePart = (props: {
  library: Library;
  query: string;
  showDiscover: () => void;
}) => ReactNode;

/**
 * Settings › Skills, Plugins and Connectors (LIBRARY.md), under Settings' own title, for one profile at a time (picked
 * at the top; All profiles is the whole library). Library is what that profile loads, Discover is where to get more,
 * and what's added goes to it. The search on the right filters the tab you're on and stays as you switch.
 */
export function LibraryPage({
  id,
  noun,
  description,
  actions,
  count,
  library: LibraryPart,
  discover: DiscoverPart,
}: {
  id: string;
  noun: string;
  description: string;
  actions?: (props: {
    library: Library;
    showDiscover: () => void;
  }) => ReactNode;
  count: (library: Library) => number;
  library: PagePart;
  discover: PagePart;
}) {
  const library = useLibrary(useHarnessSelector((s) => s.spaceId));
  const [tab, setTab] = useState<PageTab>('library');
  const [search, setSearch] = useState('');
  const query = search.trim();
  const showDiscover = () => setTab('discover');
  const part = { library, query, showDiscover };
  const installed = count(library);
  return (
    <div data-setting-id={id} className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 px-1 sm:flex-row sm:items-start sm:justify-between">
        <p className="type-meta text-pretty text-muted-foreground">
          {description}
        </p>
        <div className="flex shrink-0 items-center gap-2">
          <ScopePicker />
          {actions?.({ library, showDiscover })}
        </div>
      </div>
      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as PageTab)}
        className="gap-8"
      >
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-end sm:justify-between sm:shadow-[inset_0_-1px_0_var(--color-border)]">
          <TabsList
            variant="line"
            className="w-full justify-start sm:w-auto sm:shadow-none"
          >
            <TabsTrigger value="library" className="flex-none px-2">
              Library
              {installed > 0 && (
                <span className="text-subtle-foreground tabular">
                  {installed}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="discover" className="flex-none px-2">
              Discover
            </TabsTrigger>
          </TabsList>
          <InputGroup className="h-8 sm:mb-1.5 sm:w-64">
            <InputGroupAddon>
              <Search />
            </InputGroupAddon>
            <InputGroupInput
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && setSearch('')}
              placeholder={`Search ${noun}`}
              aria-label={`Search ${noun}`}
            />
          </InputGroup>
        </div>
        <TabsContent value="library" className="flex flex-col gap-10">
          <LibraryPart {...part} />
        </TabsContent>
        <TabsContent value="discover" className="flex flex-col gap-10">
          <DiscoverPart {...part} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/** Which profile the page shows and adds to; All profiles is the whole library with each item's profiles. */
/** The profile the page shows; `hasAll` adds the whole library, for pages whose content isn't per profile. */
export function ScopePicker({ hasAll = true }: { hasAll?: boolean }) {
  const profiles = useProfiles();
  const scope = useLibraryScope();
  const spaceId = useHarnessSelector((s) => s.spaceId);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="xs"
          aria-label={`Showing ${scope.profile?.name ?? 'all profiles'}`}
        >
          {scope.profile ? <SpaceIcon space={scope.profile} /> : <Users />}
          <span className="max-w-32 truncate">
            {scope.profile?.name ?? 'All profiles'}
          </span>
          <ChevronDown />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Show and add to</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={scope.id}
          onValueChange={setLibraryScope}
        >
          {profiles.map((p) => (
            <DropdownMenuRadioItem key={p.id} value={p.id}>
              <SpaceIcon space={p} className="size-3.5" />
              <span className="flex-1 truncate">{p.name}</span>
              {p.id === spaceId && (
                <span className="type-caption text-subtle-foreground">
                  Current
                </span>
              )}
            </DropdownMenuRadioItem>
          ))}
          {hasAll && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuRadioItem value={ALL_PROFILES}>
                <Users className="size-3.5" />
                All profiles
              </DropdownMenuRadioItem>
            </>
          )}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
