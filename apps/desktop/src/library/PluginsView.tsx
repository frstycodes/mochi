import { SkeletonRows } from '@/components/SkeletonRows';
import { useRef, useState } from 'react';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { ChevronDown, Globe, Plus, Trash, Upload } from '@/icons';
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
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { toast } from '@/toast/store';
import { host } from '../host';
import {
  SettingsCard,
  SettingsRow,
  SettingsSection,
  SettingsSelect,
} from '../settings/parts';
import { OverflowIcon } from '../ui';
import { FEATURED_MARKETPLACES, type MarketplaceCatalog } from './library';
import { NativeSections } from './NativeSections';
import { LibraryPage, type PagePart } from './LibraryPage';
import {
  ALL,
  CatalogErrorRow,
  CategoryChips,
  EmptyRow,
  filterBy,
  InstallControl,
  InstalledList,
  LibraryRow,
  PAGE,
} from './LibraryParts';
import { PluginDropZone, UploadPluginDialog } from './UploadPlugin';
import {
  installedEntry,
  useLoaded,
  useMarketplaces,
  type Library,
} from './useLibrary';

/** Settings › Plugins: the plugins installed, which profiles get each, and the marketplaces to add more from. */
export function PluginsView() {
  return (
    <PluginDropZone>
      <LibraryPage
        id="pluginsLibrary"
        noun="plugins"
        description="Installed once and unpacked into skills, agents, hooks and servers, then handed to the profiles that should have them. Claude’s own plugin system never sees them."
        count={({ entries }) =>
          entries?.filter((e) => e.kind === 'plugin').length ?? 0
        }
        actions={({ library, showDiscover }) => (
          <AddPluginMenu library={library} onMarketplaceAdded={showDiscover} />
        )}
        library={InstalledPlugins}
        discover={PluginCatalog}
      />
    </PluginDropZone>
  );
}

function InstalledPlugins({
  library,
  query,
  showDiscover,
}: Parameters<PagePart>[0]) {
  return (
    <>
      <SettingsSection title="In Mochi">
        <InstalledList
          entries={library.entries?.filter((e) => e.kind === 'plugin')}
          library={library}
          query={query}
          empty={
            <SettingsRow
              label="No plugins yet"
              description="A plugin bundles skills, agents, hooks and servers. Mochi unpacks it into this profile’s threads. Drop a .plugin, .zip or .tgz file here to upload one."
              control={
                <Button variant="outline" size="sm" onClick={showDiscover}>
                  Discover plugins
                </Button>
              }
            />
          }
        />
      </SettingsSection>
      <NativeSections kinds={['plugin']} query={query} />
    </>
  );
}

// {MARKETPLACE CHOICE}

// Shared by the header's Add marketplace (which picks the one it added) and the catalog showing it.
const marketplaceStore = createStore<{ picked: string }>(() => ({
  picked: FEATURED_MARKETPLACES[0].name,
}));

function pickMarketplace(name: string) {
  marketplaceStore.setState({ picked: name });
}

function usePickedMarketplace() {
  return useStore(marketplaceStore, (s) => s.picked);
}

// {CATALOG}

function PluginCatalog({ library, query }: Parameters<PagePart>[0]) {
  const name = usePickedMarketplace();
  const { marketplaces, remove } = useMarketplaces(name);
  const { state, retry } = useLoaded(name, () =>
    host.library.marketplaceCatalog(name),
  );
  const isFeatured = FEATURED_MARKETPLACES.some((m) => m.name === name);
  return (
    <SettingsSection
      title="Marketplace"
      action={
        <div className="flex items-center gap-1">
          <SettingsSelect
            aria-label="Marketplace"
            value={name}
            options={(marketplaces ?? FEATURED_MARKETPLACES).map((m) => ({
              value: m.name,
              label: m.name,
            }))}
            onChange={pickMarketplace}
            className="w-56"
          />
          {!isFeatured && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`${name} actions`}
                >
                  <OverflowIcon />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() =>
                    void remove(name).then(() =>
                      pickMarketplace(FEATURED_MARKETPLACES[0].name),
                    )
                  }
                >
                  <Trash />
                  Remove {name}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      }
    >
      {state.status === 'loading' && (
        <SettingsCard>
          <SkeletonRows count={5} />
        </SettingsCard>
      )}
      {state.status === 'error' && (
        <SettingsCard>
          <CatalogErrorRow
            what={name}
            message={state.message}
            onRetry={retry}
          />
        </SettingsCard>
      )}
      {state.status === 'done' && (
        <PluginList
          key={name}
          catalog={state.value}
          marketplace={name}
          library={library}
          query={query}
        />
      )}
    </SettingsSection>
  );
}

function PluginList({
  catalog,
  marketplace,
  library,
  query,
}: {
  catalog: MarketplaceCatalog;
  marketplace: string;
  library: Library;
  query: string;
}) {
  const [category, setCategory] = useState(ALL);
  const [limit, setLimit] = useState(PAGE);
  const categories = [
    ...new Set(
      catalog.plugins.flatMap((p) => (p.category ? [p.category] : [])),
    ),
  ].sort();
  // A search looks through every category.
  const inCategory =
    category === ALL || query
      ? catalog.plugins
      : catalog.plugins.filter((p) => p.category === category);
  const matches = filterBy(inCategory, query, (p) => [
    p.name,
    p.title,
    p.description,
    p.author,
    p.category,
  ]);
  return (
    <>
      {categories.length > 1 && !query && (
        <CategoryChips
          categories={categories}
          value={category}
          onChange={setCategory}
        />
      )}
      <SettingsCard>
        {!matches.length && (
          <EmptyRow
            text={
              query
                ? `No plugin in ${catalog.displayName} matches “${query}”`
                : `${catalog.displayName} lists no plugins here`
            }
          />
        )}
        {matches.slice(0, limit).map((plugin) => (
          <LibraryRow
            key={plugin.name}
            name={plugin.title ?? plugin.name}
            icon={plugin.icon}
            description={plugin.description}
            meta={[
              plugin.author,
              plugin.category,
              plugin.version && `v${plugin.version}`,
            ]
              .filter(Boolean)
              .join(' · ')}
            actions={
              <InstallControl
                entry={installedEntry(library.entries, 'plugin', plugin.name)}
                name={plugin.title ?? plugin.name}
                install={() => library.installPlugin(marketplace, plugin)}
              />
            }
          />
        ))}
        {matches.length > limit && (
          <SettingsRow
            label={
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setLimit((n) => n + PAGE)}
              >
                Show more ({matches.length - limit} left)
              </Button>
            }
          />
        )}
      </SettingsCard>
    </>
  );
}

// {ADD PLUGIN}

/** One header action for both ways in: a marketplace to browse under Discover, or a plugin file from this computer. */
function AddPluginMenu({
  library,
  onMarketplaceAdded,
}: {
  library: Library;
  onMarketplaceAdded: () => void;
}) {
  const [isMarketplaceOpen, setMarketplaceOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="xs">
            <Plus />
            Add plugin
            <ChevronDown data-icon="inline-end" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          {ADD_SOURCES.map(({ id, icon: Icon, title, description }) => (
            <DropdownMenuItem
              key={id}
              className="items-start"
              onSelect={() =>
                id === 'file'
                  ? fileInput.current?.click()
                  : setMarketplaceOpen(true)
              }
            >
              <Icon
                aria-hidden
                className="mt-0.5 size-4 shrink-0 text-muted-foreground"
              />
              <span className="flex flex-col gap-0.5">
                <span className="type-body font-medium">{title}</span>
                <span className="type-meta text-pretty text-muted-foreground">
                  {description}
                </span>
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <UploadPluginDialog library={library} fileInput={fileInput} />
      <Dialog open={isMarketplaceOpen} onOpenChange={setMarketplaceOpen}>
        <DialogContent className="sm:max-w-md">
          <AddMarketplaceForm
            onCancel={() => setMarketplaceOpen(false)}
            onAdded={(name) => {
              setMarketplaceOpen(false);
              pickMarketplace(name);
              onMarketplaceAdded();
            }}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

const ADD_SOURCES = [
  {
    id: 'marketplace',
    icon: Globe,
    title: 'From a marketplace',
    description:
      'A GitHub repository or marketplace.json link. Its plugins show up under Discover.',
  },
  {
    id: 'file',
    icon: Upload,
    title: 'From a file',
    description:
      'A .plugin, .zip or .tgz on this computer. You review what it adds before it installs.',
  },
] as const;

// Inside the dialog's content, which unmounts on close, so each opening starts empty.
function AddMarketplaceForm({
  onCancel,
  onAdded,
}: {
  onCancel: () => void;
  onAdded: (name: string) => void;
}) {
  const [source, setSource] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isAdding, setAdding] = useState(false);
  const submit = () => {
    setAdding(true);
    setError(null);
    host.library.addMarketplace(source.trim()).then(
      (list) => {
        const added = list.at(-1)!.name;
        toast.success(`Added ${added}`);
        onAdded(added);
      },
      (e: Error) => {
        setError(e.message);
        setAdding(false);
      },
    );
  };
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (source.trim() && !isAdding) submit();
      }}
    >
      <DialogHeader>
        <DialogTitle>Add a marketplace</DialogTitle>
        <DialogDescription>
          Its plugins show up under Discover, and Mochi keeps installed ones up
          to date from it.
        </DialogDescription>
      </DialogHeader>
      <Field data-invalid={!!error || undefined}>
        <FieldLabel htmlFor="marketplace-source">Repository or link</FieldLabel>
        <Input
          id="marketplace-source"
          autoFocus
          placeholder="owner/repo"
          value={source}
          onChange={(e) => setSource(e.target.value)}
          aria-invalid={!!error}
        />
        {error ? (
          <FieldError>{error}</FieldError>
        ) : (
          <FieldDescription>
            A GitHub repository with .claude-plugin/marketplace.json (or
            Codex’s), or a link to a marketplace.json.
          </FieldDescription>
        )}
      </Field>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={!source.trim() || isAdding}>
          {isAdding && <Spinner data-icon="inline-start" />}
          Add marketplace
        </Button>
      </DialogFooter>
    </form>
  );
}
