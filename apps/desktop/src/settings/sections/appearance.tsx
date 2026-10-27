import { Card } from '@/components/ui/card';
import { SkeletonRows } from '@/components/SkeletonRows';
import { useEffect, useState, type ReactNode } from 'react';
import {
  ChevronDown,
  ClipboardText,
  Download,
  Edit,
  Import,
  Search,
  Star,
  CheckCircle,
  Trash,
} from '@/icons';
import { toast } from '@/toast/store';
import { Button } from '@/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@/components/ui/input-group';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { plural } from '@mochi/domain/lib/format';
import { host } from '../../host';
import {
  filterPackages,
  groupThemes,
  type PackageGroup,
} from '../../themes/groups';
import {
  MOCHI_THEME_ID,
  slotOf,
  type ColorTheme,
  type ThemeKind,
  type ThemeSlot,
} from '@mochi/domain/themes/model';
import type { MarketplaceExtension } from '@mochi/domain/themes/openVsx';
import {
  refreshThemes,
  setThemePreview,
  useColorTheme,
  useThemesState,
} from '../../themes/store';
import {
  installExtension,
  removeCustomTheme,
  uninstallPackage,
  useApplyTheme,
  useInspectedThemes,
  useMarketplaceSearch,
  useSeen,
} from '../../themes/useMarketplace';
import { OverflowIcon, TooltipIconButton } from '../../ui';
import { CatalogRow } from '../CatalogRow';
import { FontSettings } from '../FontSettings';
import { useLinkedTab } from '../../routes/nav';
import {
  ListIcon,
  SettingsCard,
  SettingsGroup,
  SettingsRow,
  SettingsSection,
  settingControlId,
} from '../parts';
import { setPrefs, toggleStar, usePrefs } from '../prefs';
import { ANIMATIONS, type AnimationArea } from '../settingOptions';
import {
  ThemePicker,
  ThemeSwatch,
  useChosenTheme,
  themeColorsOf,
} from '../ThemePicker';

export function AppearanceSection() {
  // Leaving the page mid-hover must not leave a preview painted.
  useEffect(() => () => setThemePreview(null), []);
  return (
    <div className="flex flex-col gap-10">
      <SettingsGroup title="Mode">
        <CatalogRow settingKey="theme" />
        <CatalogRow settingKey="reduceMotion" />
      </SettingsGroup>
      <SettingsGroup title="App icon">
        <CatalogRow settingKey="appIcon" label="Dock icon" />
      </SettingsGroup>
      <FontSettings />
      <SettingsSection
        id="animations"
        title="Animations"
        footer="Off until you turn them on. Reduce motion stops these too."
      >
        <div className="flex flex-col gap-3">
          {(Object.keys(ANIMATIONS) as AnimationArea[]).map((area) => (
            <AnimationAreaCard key={area} area={area} />
          ))}
        </div>
      </SettingsSection>
      <SettingsSection
        id="colorTheme"
        title="Color theme"
        footer="Arrow through or hover a theme to preview it; nothing changes until you pick one."
      >
        <div className="@container">
          <div className="grid gap-3 @md:grid-cols-2">
            <SlotCard slot="light" />
            <SlotCard slot="dark" />
          </div>
        </div>
      </SettingsSection>
      <ThemesTabs />
    </div>
  );
}

/** An area's switch for all its animations, with one switch per animation folded under it (open when a deep link names one). */
function AnimationAreaCard({ area }: { area: AnimationArea }) {
  const { items } = ANIMATIONS[area];
  const [disclosure, setDisclosure] = useLinkedTab(
    (settingId) =>
      items.some((item) => settingId === `animation-${item.value}`)
        ? 'open'
        : undefined,
    'closed',
  );
  const isOpen = disclosure === 'open';
  return (
    <SettingsCard>
      <CatalogRow settingKey={`animations.${area}`} />
      <Collapsible
        open={isOpen}
        onOpenChange={(open) => setDisclosure(open ? 'open' : 'closed')}
        className="relative before:absolute before:inset-x-4 before:top-0 before:h-px before:bg-border"
      >
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex w-full items-center gap-1.5 px-4 py-2.5 type-meta text-muted-foreground outline-none hover:text-foreground focus-visible:text-foreground"
          >
            <ChevronDown
              aria-hidden
              className={cn(
                'size-3.5 transition-transform duration-200',
                !isOpen && '-rotate-90',
              )}
            />
            Choose each animation
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          {items.map((item) => (
            <CatalogRow
              key={item.value}
              settingKey={`animation.${item.value}`}
            />
          ))}
        </CollapsibleContent>
      </Collapsible>
    </SettingsCard>
  );
}

/** One appearance's theme as a small painted app; the whole card opens the picker. */
function SlotCard({ slot }: { slot: ThemeSlot }) {
  const chosen = useChosenTheme(slot);
  const colorTheme = useColorTheme();
  const isOnScreen = colorTheme.mode === slot;
  return (
    <ThemePicker slot={slot}>
      <Card
        asChild
        className="gap-3 p-3 text-left transition-colors duration-700 hover:bg-accent/60 hover:duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 data-flash:bg-accent data-[state=open]:border-foreground/20"
      >
        <button
          type="button"
          id={settingControlId(`${slot}Theme`)}
          data-setting-id={`${slot}Theme`}
        >
          <ThemeMock theme={colorTheme[slot]} slot={slot} />
          <span className="flex items-center gap-2 px-1">
            <span className="min-w-0 flex-1">
              <span className="block type-body font-medium">
                {slot === 'light' ? 'Light' : 'Dark'}
              </span>
              <span className="block truncate type-meta text-muted-foreground">
                {chosen?.label ?? 'Mochi'}
              </span>
            </span>
            {isOnScreen && (
              <span className="shrink-0 type-caption text-muted-foreground">
                On screen
              </span>
            )}
            <ChevronDown
              aria-hidden
              className="size-4 shrink-0 text-muted-foreground"
            />
          </span>
        </button>
      </Card>
    </ThemePicker>
  );
}

/** A theme painted as a tiny Mochi window: sidebar, a message, a line of prose, a line of code and the send button. */
function ThemeMock({
  theme,
  slot,
}: {
  theme: ColorTheme | null;
  slot: ThemeSlot;
}) {
  const c = themeColorsOf(theme, slot);
  return (
    <span
      aria-hidden
      className="flex h-24 overflow-hidden rounded-lg shadow-[inset_0_0_0_1px_var(--border)]"
      style={{ background: c.background }}
    >
      <span
        className="flex w-1/4 flex-col gap-1.5 p-2.5"
        style={{ background: c.sidebar }}
      >
        {['70%', '50%', '60%'].map((width) => (
          <span
            key={width}
            className="h-1.5 rounded-full opacity-30"
            style={{ width, background: c.foreground }}
          />
        ))}
      </span>
      <span className="flex flex-1 flex-col gap-2 p-2.5">
        <span
          className="ml-auto h-3.5 w-2/5 rounded-md"
          style={{ background: c.muted }}
        />
        <span
          className="h-1.5 w-4/5 rounded-full opacity-60"
          style={{ background: c.foreground }}
        />
        <span className="flex gap-1">
          <span
            className="h-1.5 w-1/6 rounded-full"
            style={{ background: c.keyword }}
          />
          <span
            className="h-1.5 w-1/3 rounded-full"
            style={{ background: c.string }}
          />
          <span
            className="h-1.5 w-1/6 rounded-full opacity-40"
            style={{ background: c.foreground }}
          />
        </span>
        <span
          className="mt-auto ml-auto size-4 rounded-full"
          style={{ background: c.primary }}
        />
      </span>
    </span>
  );
}

type ThemesTab = 'library' | 'marketplace';

const TAB_OF_ROW: Record<string, ThemesTab> = {
  installedThemes: 'library',
  customTheme: 'library',
  themeMarketplace: 'marketplace',
};

/** What you have and what you could get, as two tabs; a deep link to either opens its tab. */
function ThemesTabs() {
  const [tab, setTab] = useLinkedTab(
    (settingId) => TAB_OF_ROW[settingId],
    'library',
  );
  return (
    <Tabs
      value={tab}
      onValueChange={(v) => setTab(v as ThemesTab)}
      className="gap-0"
    >
      <SettingsSection
        id="installedThemes"
        title="Themes"
        action={
          <TabsList>
            <TabsTrigger value="library">Library</TabsTrigger>
            <TabsTrigger value="marketplace">Marketplace</TabsTrigger>
          </TabsList>
        }
      >
        <TabsContent value="library" className="flex flex-col gap-2.5">
          <Library />
        </TabsContent>
        <TabsContent value="marketplace" className="flex flex-col gap-2.5">
          <Marketplace />
        </TabsContent>
      </SettingsSection>
    </Tabs>
  );
}

// Past this many packages, the library gets a filter.
const FILTER_FROM = 5;

/** Installed themes, one row per package that opens to its themes; Mochi first, your own files last. */
function Library() {
  const { installed, isLoaded } = useThemesState();
  const [query, setQuery] = useState('');
  const { packages, custom } = groupThemes(installed);
  const q = query.trim().toLowerCase();
  const matches = (text: string) => text.toLowerCase().includes(q);
  const shownPackages = filterPackages(packages, query);
  const shownCustom = q ? custom.filter((t) => matches(t.label)) : custom;
  const isMochiShown = !q || matches('mochi');
  const isEmpty =
    !!q && !isMochiShown && !shownPackages.length && !shownCustom.length;
  return (
    <>
      {packages.length >= FILTER_FROM && (
        <InputGroup>
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
          <InputGroupInput
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter installed themes"
            aria-label="Filter installed themes"
          />
        </InputGroup>
      )}
      <SettingsCard>
        {isMochiShown && <MochiPackage />}
        {!isLoaded && <SkeletonRows count={2} />}
        {shownPackages.map(({ group, themes }) => (
          <PackageRow
            key={group.id}
            group={group}
            themes={themes}
            isOpen={!!q || undefined}
          />
        ))}
        {(!q || shownCustom.length > 0) && (
          <CustomPackage
            themes={shownCustom}
            isLoaded={isLoaded}
            isFiltered={!!q}
          />
        )}
        {isEmpty && (
          <SettingsRow
            label={
              <span className="text-muted-foreground">
                No installed theme matches “{query.trim()}”
              </span>
            }
          />
        )}
      </SettingsCard>
    </>
  );
}

const MOCHI_SLOTS = ['light', 'dark'] satisfies ThemeSlot[];

function MochiPackage() {
  return (
    <PackageShell
      name="Mochi"
      publisher="Built in"
      meta={themeCount(MOCHI_SLOTS.length)}
      swatches={MOCHI_SLOTS.map((slot) => ({ theme: null, slot }))}
      usedCount={useUsedCount(null)}
    >
      {MOCHI_SLOTS.map((slot) => (
        <ThemeRow
          key={slot}
          theme={null}
          slot={slot}
          label={`Mochi ${KIND_LABELS[slot]}`}
          kind={slot}
        />
      ))}
    </PackageShell>
  );
}

/** `themes` are the ones a filter shows; removing always takes the whole package. */
function PackageRow({
  group,
  themes,
  isOpen,
}: {
  group: PackageGroup;
  themes: ColorTheme[];
  isOpen?: boolean;
}) {
  const total = group.themes.length;
  const [isRemoving, setRemoving] = useState(false);
  const consequence = `${group.displayName} · ${themeCount(total)}`;
  const remove = () => {
    setRemoving(true);
    uninstallPackage(group).then(
      () => toast.success(`Removed ${consequence}`),
      (error: Error) => {
        setRemoving(false);
        toast.error(`Could not remove ${group.displayName}`, {
          description: error.message,
        });
      },
    );
  };
  return (
    <PackageShell
      name={group.displayName}
      publisher={group.publisher}
      meta={`${themes.length < total ? `${themes.length} of ${themeCount(total)}` : themeCount(total)} · v${group.version}`}
      swatches={themes.map((theme) => ({ theme, slot: slotOf(theme.kind) }))}
      usedCount={useUsedCount(group.themes)}
      isOpen={isOpen}
      menu={
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`More for ${group.displayName}`}
              disabled={isRemoving}
            >
              {isRemoving ? <Spinner /> : <OverflowIcon />}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem variant="destructive" onSelect={remove}>
              <Trash />
              Remove {consequence}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      }
    >
      {themes.map((theme) => (
        <ThemeRow
          key={theme.id}
          theme={theme}
          slot={slotOf(theme.kind)}
          label={theme.label}
          kind={theme.kind}
        />
      ))}
    </PackageShell>
  );
}

function CustomPackage({
  themes,
  isLoaded,
  isFiltered,
}: {
  themes: ColorTheme[];
  isLoaded: boolean;
  isFiltered: boolean;
}) {
  const [draft, setDraft] = useState<{ file?: string; text: string } | null>(
    null,
  );
  const importFile = () =>
    host.themes.importFile().then(
      (theme) =>
        theme &&
        void refreshThemes().then(() =>
          toast.success(`Imported ${theme.label}`),
        ),
      (error: Error) =>
        toast.error('Could not import the theme', {
          description: error.message,
        }),
    );
  const isEmpty = isLoaded && themes.length === 0;
  return (
    <PackageShell
      id="customTheme"
      name="Custom"
      publisher="Your own files"
      meta={
        isEmpty
          ? 'VS Code color theme files (.json or .jsonc)'
          : themeCount(themes.length)
      }
      swatches={themes.map((theme) => ({ theme, slot: slotOf(theme.kind) }))}
      usedCount={useUsedCount(themes)}
      isOpen={isFiltered || !!draft || undefined}
      menu={
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              Add theme
              <ChevronDown data-icon="inline-end" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => void importFile()}>
              <Import />
              Import file
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setDraft({ text: '' })}>
              <ClipboardText />
              Paste JSON
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      }
      isExpandable={themes.length > 0}
    >
      {!!draft && (
        <div className="px-4 py-3">
          <ThemeJsonEditor
            key={draft.file ?? 'new'}
            draft={draft}
            onDone={() => setDraft(null)}
          />
        </div>
      )}
      {themes.map((theme) => (
        <ThemeRow
          key={theme.id}
          theme={theme}
          slot={slotOf(theme.kind)}
          label={theme.label}
          kind={theme.kind}
        >
          {theme.source.kind === 'custom' && (
            <CustomThemeActions
              theme={theme}
              file={theme.source.file}
              onEdit={(file, text) => setDraft({ file, text })}
            />
          )}
        </ThemeRow>
      ))}
    </PackageShell>
  );
}

/**
 * A package's row: its first theme's swatch, name, publisher and what's in use; the chevron opens its themes inside the
 * same card. `isOpen` forces it open (a filter or an editor is showing), otherwise it's yours to toggle.
 */
function PackageShell({
  id,
  name,
  publisher,
  meta,
  swatches,
  usedCount,
  menu,
  isOpen,
  isExpandable = true,
  children,
}: {
  id?: string;
  name: string;
  publisher: string;
  meta: string;
  swatches: { theme: ColorTheme | null; slot: ThemeSlot }[];
  usedCount: number;
  menu?: ReactNode;
  isOpen?: boolean;
  isExpandable?: boolean;
  children: ReactNode;
}) {
  const [isOpenByYou, setOpen] = useState(false);
  const isExpanded = isOpen ?? isOpenByYou;
  return (
    <Collapsible
      open={isExpanded}
      onOpenChange={setOpen}
      className="relative not-first:before:absolute not-first:before:inset-x-4 not-first:before:top-0 not-first:before:h-px not-first:before:bg-border"
    >
      <SettingsRow
        id={id}
        label={
          <span className="flex min-w-0 items-center gap-3">
            <PackageSwatch swatch={swatches[0]} />
            <span className="flex min-w-0 flex-col">
              <span className="flex min-w-0 items-baseline gap-1.5">
                <span className="truncate font-medium">{name}</span>
                <span className="shrink-0 truncate type-meta text-muted-foreground">
                  {publisher}
                </span>
              </span>
              <span className="truncate type-meta text-muted-foreground">
                {meta}
                {usedCount > 0 &&
                  ` · ${usedCount === 1 ? 'In use' : 'Both in use'}`}
              </span>
            </span>
          </span>
        }
        control={
          <div className="flex items-center gap-1">
            {menu}
            {isExpandable && (
              <CollapsibleTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={
                    isExpanded ? `Hide ${name} themes` : `Show ${name} themes`
                  }
                >
                  <ChevronDown
                    className={cn(
                      'transition-transform duration-200',
                      isExpanded && 'rotate-180',
                    )}
                  />
                </Button>
              </CollapsibleTrigger>
            )}
          </div>
        }
      />
      <CollapsibleContent className="border-t bg-muted/30">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}

/** A package's first theme, or a dashed slot while it has none. */
function PackageSwatch({
  swatch,
}: {
  swatch?: { theme: ColorTheme | null; slot: ThemeSlot };
}) {
  if (!swatch)
    return (
      <span
        aria-hidden
        className="h-5 w-8 shrink-0 rounded-sm border border-dashed"
      />
    );
  return <ThemeSwatch theme={swatch.theme} slot={swatch.slot} />;
}

/** How many appearances use one of `themes` now; null counts Mochi. */
function useUsedCount(themes: ColorTheme[] | null) {
  const { lightTheme, darkTheme } = usePrefs();
  const { installed } = useThemesState();
  const isMochi = (id: string, slot: ThemeSlot) =>
    id === MOCHI_THEME_ID ||
    !installed.some((t) => t.id === id && slotOf(t.kind) === slot);
  const chosen = [
    { id: lightTheme, slot: 'light' as const },
    { id: darkTheme, slot: 'dark' as const },
  ];
  return chosen.filter(({ id, slot }) =>
    themes ? themes.some((t) => t.id === id) : isMochi(id, slot),
  ).length;
}

function ThemeRow({
  theme,
  slot,
  label,
  kind,
  children,
}: {
  theme: ColorTheme | null;
  slot: ThemeSlot;
  label: string;
  kind: ThemeKind;
  children?: ReactNode;
}) {
  const apply = useApplyTheme();
  const isUsed = useIsChosen(theme?.id ?? MOCHI_THEME_ID, slot);
  return (
    <SettingsRow
      label={
        <span className="flex min-w-0 items-center gap-2.5">
          <ThemeSwatch theme={theme} slot={slot} />
          <span className="truncate">{label}</span>
        </span>
      }
      description={
        <span className="block truncate pl-[2.625rem]">
          {KIND_LABELS[kind]}
        </span>
      }
      onPointerEnter={() => setThemePreview(theme)}
      onPointerLeave={() => setThemePreview(null)}
      control={
        <div
          className="flex items-center gap-1"
          onFocus={() => setThemePreview(theme)}
          onBlur={() => setThemePreview(null)}
        >
          {isUsed ? (
            <span className="flex h-6 items-center gap-1 px-2.5 type-meta text-muted-foreground">
              <CheckCircle aria-hidden className="size-3.5 text-success" />
              In use
            </span>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => apply(theme, slot)}
            >
              Use
            </Button>
          )}
          {!!theme && <StarButton theme={theme} />}
          {children}
        </div>
      }
    />
  );
}

/** Starred themes come first in the Light and Dark pickers and show up in ⌘K. */
function StarButton({ theme }: { theme: ColorTheme }) {
  const { starredThemes } = usePrefs();
  const isStarred = starredThemes.includes(theme.id);
  return (
    <TooltipIconButton
      label={isStarred ? `Unstar ${theme.label}` : `Star ${theme.label}`}
      hint={
        isStarred
          ? undefined
          : 'Starred themes come first in the theme pickers and in ⌘K'
      }
      aria-pressed={isStarred}
      onClick={() =>
        setPrefs({ starredThemes: toggleStar(starredThemes, theme.id) })
      }
      className={
        isStarred
          ? 'text-warning! [&_*]:text-warning!'
          : 'text-muted-foreground'
      }
    >
      <Star filled={isStarred} />
    </TooltipIconButton>
  );
}

function useIsChosen(id: string, slot: ThemeSlot) {
  const prefs = usePrefs();
  return (slot === 'light' ? prefs.lightTheme : prefs.darkTheme) === id;
}

function CustomThemeActions({
  theme,
  file,
  onEdit,
}: {
  theme: ColorTheme;
  file: string;
  onEdit: (file: string, text: string) => void;
}) {
  const edit = () =>
    (host.isDesktop
      ? host.themes.openCustom(file)
      : host.themes.readCustom(file).then((text) => onEdit(file, text))
    ).catch((error: Error) =>
      toast.error('Could not open the theme', { description: error.message }),
    );
  const remove = () =>
    removeCustomTheme(theme, file).catch((error: Error) =>
      toast.error('Could not delete the theme', { description: error.message }),
    );
  return (
    <>
      <TooltipIconButton
        label="Edit"
        hint={
          host.isDesktop
            ? 'Opens the theme file in your JSON editor'
            : 'Edit the theme JSON here'
        }
        onClick={() => void edit()}
      >
        <Edit />
      </TooltipIconButton>
      <TooltipIconButton
        label="Delete"
        hint={`Deletes ${file}`}
        onClick={() => void remove()}
      >
        <Trash />
      </TooltipIconButton>
    </>
  );
}

const KIND_LABELS = {
  light: 'Light',
  dark: 'Dark',
  'hc-light': 'High contrast light',
  'hc-dark': 'High contrast dark',
} satisfies Record<ThemeKind, string>;

/** Pasting a new theme, or editing a custom one in the web build (which has no files to open). */
function ThemeJsonEditor({
  draft,
  onDone,
}: {
  draft: { file?: string; text: string };
  onDone: () => void;
}) {
  const [text, setText] = useState(draft.text);
  const [error, setError] = useState<string | null>(null);
  const save = () =>
    host.themes.saveCustom(text, draft.file).then(
      (theme) => {
        void refreshThemes();
        toast.success(`Saved ${theme.label}`);
        onDone();
      },
      (e: Error) => setError(e.message),
    );
  return (
    <div className="flex flex-col gap-2">
      <Textarea
        autoFocus
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setError(null);
        }}
        placeholder={
          '{\n  "name": "My theme",\n  "type": "dark",\n  "colors": { "editor.background": "#1e1e1e" },\n  "tokenColors": []\n}'
        }
        spellCheck={false}
        aria-label="Theme JSON"
        aria-invalid={!!error}
        aria-describedby={error ? 'theme-json-error' : undefined}
        className="h-48 font-mono type-meta"
      />
      {!!error && (
        <p id="theme-json-error" className="type-meta text-destructive">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onDone}>
          Cancel
        </Button>
        <Button size="sm" onClick={() => void save()} disabled={!text.trim()}>
          Save theme
        </Button>
      </div>
    </div>
  );
}

function Marketplace() {
  const [query, setQuery] = useState('');
  const { state, more, hasMore, retry } = useMarketplaceSearch(query);
  const isEmpty = state.status === 'done' && state.extensions.length === 0;
  return (
    <>
      <InputGroup data-setting-id="themeMarketplace">
        <InputGroupAddon>
          <Search />
        </InputGroupAddon>
        <InputGroupInput
          id={settingControlId('themeSearch')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search Open VSX themes"
          aria-label="Search Open VSX themes"
        />
      </InputGroup>
      <SettingsCard>
        {state.status === 'loading' && <SkeletonRows count={4} />}
        {state.status === 'error' && (
          <SettingsRow
            label="Couldn't reach Open VSX"
            description={state.message}
            control={
              <Button variant="outline" size="sm" onClick={retry}>
                Try again
              </Button>
            }
          />
        )}
        {isEmpty && (
          <SettingsRow
            label={
              <span className="text-muted-foreground">
                No color themes match "{query}"
              </span>
            }
          />
        )}
        {state.status === 'done' &&
          state.extensions.map((extension) => (
            <ExtensionRow
              key={`${extension.namespace}.${extension.name}`}
              extension={extension}
            />
          ))}
        {hasMore && state.status === 'done' && (
          <SettingsRow
            label={
              <Button
                variant="ghost"
                size="sm"
                onClick={more}
                disabled={state.isLoadingMore}
              >
                {state.isLoadingMore && <Spinner data-icon="inline-start" />}
                Show more
              </Button>
            }
          />
        )}
      </SettingsCard>
      <p className="px-1 type-caption text-muted-foreground">
        Color themes from open-vsx.org, most downloaded first. Installing reads
        only each package's theme files; nothing in it runs.
      </p>
    </>
  );
}

function ExtensionRow({ extension }: { extension: MarketplaceExtension }) {
  const [ref, isSeen] = useSeen<HTMLSpanElement>();
  const inspected = useInspectedThemes(extension, isSeen);
  const { installed } = useThemesState();
  const { mode } = useColorTheme();
  const apply = useApplyTheme();
  const [isInstalling, setInstalling] = useState(false);
  const isInstalled = installed.some(
    (t) =>
      t.source.kind === 'marketplace' &&
      t.source.namespace === extension.namespace &&
      t.source.name === extension.name,
  );
  const themes = inspected.status === 'done' ? inspected.themes : [];
  // Hovering the row previews the theme for the appearance on screen, so it doesn't flip light and dark under you.
  const rowPreview =
    themes.find((t) => slotOf(t.kind) === mode) ?? themes[0] ?? null;
  const install = (use?: ColorTheme) => {
    setInstalling(true);
    void installExtension(extension)
      .then((found) => {
        const theme = use && found.find((t) => t.id === use.id);
        if (theme) apply(theme);
        toast.success(
          theme ? `Using ${theme.label}` : `Installed ${extension.displayName}`,
        );
      })
      .catch((error: Error) =>
        toast.error(`Could not install ${extension.displayName}`, {
          description: error.message,
        }),
      )
      .finally(() => setInstalling(false));
  };
  return (
    <SettingsRow
      label={
        <span ref={ref} className="flex min-w-0 items-center gap-2.5">
          <ListIcon url={extension.iconUrl} />
          <span className="truncate">{extension.displayName}</span>
        </span>
      }
      description={
        <span className="block truncate pl-[2.625rem]">
          {extensionMeta(extension)}
        </span>
      }
      onPointerEnter={() => setThemePreview(rowPreview)}
      onPointerLeave={() => setThemePreview(null)}
      control={
        <div className="flex items-center gap-2">
          <Swatches
            extension={extension}
            inspected={inspected}
            isInstalled={isInstalled}
            onPreview={(t) => setThemePreview(t ?? rowPreview)}
            onUse={(t) =>
              isInstalled
                ? apply(installed.find((i) => i.id === t.id) ?? t)
                : install(t)
            }
          />
          {isInstalled ? (
            <span className="flex h-6 w-20 items-center justify-end gap-1 type-meta text-muted-foreground">
              <CheckCircle aria-hidden className="size-3.5 text-success" />
              Installed
            </span>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="w-20"
              onClick={() => install()}
              disabled={isInstalling}
            >
              {isInstalling ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <Download data-icon="inline-start" />
              )}
              Install
            </Button>
          )}
        </div>
      }
    />
  );
}

const DOWNLOADS = new Intl.NumberFormat(undefined, {
  notation: 'compact',
  maximumFractionDigits: 1,
});
const themeCount = (count: number) =>
  plural(count, '1 theme', `${count} themes`);

function extensionMeta({
  namespace,
  downloadCount,
  themes,
}: MarketplaceExtension) {
  return `${namespace} · ${DOWNLOADS.format(downloadCount)} downloads · ${themeCount(themes.length)}`;
}

const MAX_SWATCHES = 4;

function Swatches({
  extension,
  inspected,
  isInstalled,
  onPreview,
  onUse,
}: {
  extension: MarketplaceExtension;
  isInstalled: boolean;
  inspected: ReturnType<typeof useInspectedThemes>;
  onPreview: (theme: ColorTheme | null) => void;
  onUse: (theme: ColorTheme) => void;
}) {
  if (inspected.status === 'error')
    return (
      <span className="type-caption text-muted-foreground">
        Preview unavailable
      </span>
    );
  if (inspected.status !== 'done')
    return (
      <SwatchSkeletons
        count={Math.min(extension.themes.length, MAX_SWATCHES)}
      />
    );
  const hidden = inspected.themes.length - MAX_SWATCHES;
  return (
    <div
      className="flex items-center gap-1"
      onPointerLeave={() => onPreview(null)}
    >
      {inspected.themes.slice(0, MAX_SWATCHES).map((theme) => (
        <Tooltip key={theme.id}>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={`Use ${theme.label}`}
              onPointerEnter={() => onPreview(theme)}
              onFocus={() => onPreview(theme)}
              onBlur={() => onPreview(null)}
              onClick={() => onUse(theme)}
              className="rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              <ThemeSwatch theme={theme} slot={slotOf(theme.kind)} />
            </button>
          </TooltipTrigger>
          <TooltipContent className="max-w-60 flex-col items-start gap-0.5">
            <span className="block font-medium">{theme.label}</span>
            <span className="block opacity-80">
              {isInstalled ? 'Use this theme' : 'Install and use this theme'}
            </span>
          </TooltipContent>
        </Tooltip>
      ))}
      {hidden > 0 && (
        <span className="type-caption text-muted-foreground tabular-nums">
          +{hidden}
        </span>
      )}
    </div>
  );
}

function SwatchSkeletons({ count }: { count: number }) {
  return (
    <div className="flex items-center gap-1">
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} className="h-5 w-8 rounded-sm" />
      ))}
    </div>
  );
}
