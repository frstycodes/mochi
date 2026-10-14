import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ClipboardText, Download, Edit2, Import, SearchNormal, Star, TickCircle, Trash3 } from 'reicon-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { host } from '../../host';
import { themeTokens } from '../../themes/map';
import { groupThemes, splitStarred, type PackageGroup } from '../../themes/groups';
import { MOCHI_THEME_ID, slotOf, type ColorTheme, type ThemeKind, type ThemeSlot } from '../../themes/model';
import type { MarketplaceExtension } from '../../themes/openVsx';
import { refreshThemes, setThemePreview, useColorTheme, useThemesState } from '../../themes/store';
import { installExtension, removeCustomTheme, uninstallPackage, useApplyTheme, useInspectedThemes, useMarketplaceSearch, useSeen } from '../../themes/useMarketplace';
import { setPrefs, toggleStar, usePrefs } from '../prefs';
import { TooltipIconButton } from '../../ui';
import { SettingsGroup, SettingsRow, settingControlId } from '../parts';

export function ThemesSection() {
  // Leaving the section mid-hover must not leave a preview painted.
  useEffect(() => () => setThemePreview(null), []);
  return (
    <div className="flex flex-col gap-8">
      <SettingsGroup id="colorTheme" footer="System switches between these with your system's appearance. Hover a theme to preview it; nothing changes until you pick one.">
        <SettingsRow id="lightTheme" label="Light" control={<SlotSelect slot="light" />} />
        <SettingsRow id="darkTheme" label="Dark" control={<SlotSelect slot="dark" />} />
      </SettingsGroup>
      <InstalledGroups />
      <MarketplaceGroup />
    </div>
  );
}

const MOCHI_VALUE = MOCHI_THEME_ID;

export function SlotSelect({ slot }: { slot: ThemeSlot }) {
  const prefs = usePrefs();
  const { installed } = useThemesState();
  const apply = useApplyTheme();
  const options = installed.filter((t) => slotOf(t.kind) === slot);
  const { starred, rest } = splitStarred(options, prefs.starredThemes);
  const chosen = slot === 'light' ? prefs.lightTheme : prefs.darkTheme;
  const value = options.some((t) => t.id === chosen) ? chosen : MOCHI_VALUE;
  const choose = (id: string) => apply(options.find((t) => t.id === id) ?? null, slot);
  return (
    <Select value={value} onValueChange={choose} onOpenChange={(isOpen) => !isOpen && setThemePreview(null)}>
      <SelectTrigger id={settingControlId(`${slot}Theme`)} size="sm" className="w-56">
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end">
        {starred.length > 0 && (
          <>
            <SelectGroup>
              <SelectLabel>Starred</SelectLabel>
              {starred.map((theme) => (
                <ThemeOption key={theme.id} theme={theme} slot={slot} />
              ))}
            </SelectGroup>
            <SelectSeparator />
          </>
        )}
        <SelectGroup>
          {starred.length > 0 && <SelectLabel>All themes</SelectLabel>}
          <SelectItem value={MOCHI_VALUE} onFocus={() => setThemePreview(null)}>
            <ThemeSwatch theme={null} slot={slot} />
            Mochi
          </SelectItem>
          {rest.map((theme) => (
            <ThemeOption key={theme.id} theme={theme} slot={slot} />
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

function ThemeOption({ theme, slot }: { theme: ColorTheme; slot: ThemeSlot }) {
  return (
    <SelectItem value={theme.id} onFocus={() => setThemePreview(theme)}>
      <ThemeSwatch theme={theme} slot={slot} />
      <span className="truncate">{theme.label}</span>
    </SelectItem>
  );
}

function InstalledGroups() {
  const { installed, isLoaded } = useThemesState();
  const { packages, custom } = useMemo(() => groupThemes(installed), [installed]);
  return (
    <div className="flex flex-col gap-3">
      <BuiltInGroup />
      {!isLoaded && (
        <SettingsGroup>
          <SkeletonRows count={2} />
        </SettingsGroup>
      )}
      {packages.map((group) => (
        <PackageThemes key={group.id} group={group} />
      ))}
      <CustomThemes themes={custom} isLoaded={isLoaded} />
    </div>
  );
}

const MOCHI_SLOTS = ['light', 'dark'] satisfies ThemeSlot[];

function BuiltInGroup() {
  return (
    <SettingsGroup id="installedThemes" title="Installed">
      <GroupHeader name="Mochi" publisher="Built in" meta={themeCount(MOCHI_SLOTS.length)} />
      {MOCHI_SLOTS.map((slot) => (
        <ThemeRow key={slot} theme={null} slot={slot} label={`Mochi ${KIND_LABELS[slot]}`} kind={slot} />
      ))}
    </SettingsGroup>
  );
}

function PackageThemes({ group }: { group: PackageGroup }) {
  const [isRemoving, setRemoving] = useState(false);
  const consequence = `${group.displayName} · ${themeCount(group.themes.length)}`;
  const remove = () => {
    setRemoving(true);
    uninstallPackage(group).then(
      () => toast.success(`Removed ${consequence}`),
      (error: Error) => {
        setRemoving(false);
        toast.error(`Could not remove ${group.displayName}`, { description: error.message });
      },
    );
  };
  return (
    <SettingsGroup>
      <GroupHeader
        name={group.displayName}
        publisher={group.publisher}
        meta={`${themeCount(group.themes.length)} · v${group.version}`}
        control={
          <Button variant="outline" size="sm" className="max-w-full" onClick={remove} disabled={isRemoving}>
            {isRemoving ? <Spinner data-icon="inline-start" /> : <Trash3 data-icon="inline-start" />}
            <span className="truncate">Remove {consequence}</span>
          </Button>
        }
      />
      {group.themes.map((theme) => (
        <ThemeRow key={theme.id} theme={theme} slot={slotOf(theme.kind)} label={theme.label} kind={theme.kind} />
      ))}
    </SettingsGroup>
  );
}

function CustomThemes({ themes, isLoaded }: { themes: ColorTheme[]; isLoaded: boolean }) {
  const [draft, setDraft] = useState<{ file?: string; text: string } | null>(null);
  const importFile = () =>
    host.themes.importFile().then(
      (theme) => theme && void refreshThemes().then(() => toast.success(`Imported ${theme.label}`)),
      (error: Error) => toast.error('Could not import the theme', { description: error.message }),
    );
  const isEmpty = isLoaded && themes.length === 0;
  return (
    <SettingsGroup footer="Custom themes are VS Code color theme files (.json or .jsonc). Includes resolve next to an imported file; Edit opens it in your JSON editor and changes show when you come back.">
      <GroupHeader
        id="customTheme"
        name="Custom"
        publisher="Your own files"
        meta={isEmpty ? 'None yet. Import a theme file or paste its JSON.' : themeCount(themes.length)}
        control={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => void importFile()}>
              <Import data-icon="inline-start" />
              Import file
            </Button>
            <Button variant="outline" size="sm" onClick={() => setDraft({ text: '' })} aria-expanded={!!draft && !draft.file}>
              <ClipboardText data-icon="inline-start" />
              Paste JSON
            </Button>
          </div>
        }
      >
        {!!draft && <ThemeJsonEditor key={draft.file ?? 'new'} draft={draft} onDone={() => setDraft(null)} />}
      </GroupHeader>
      {themes.map((theme) => (
        <ThemeRow key={theme.id} theme={theme} slot={slotOf(theme.kind)} label={theme.label} kind={theme.kind}>
          {theme.source.kind === 'custom' && <CustomThemeActions theme={theme} file={theme.source.file} onEdit={(file, text) => setDraft({ file, text })} />}
        </ThemeRow>
      ))}
    </SettingsGroup>
  );
}

function GroupHeader({ id, name, publisher, meta, control, children }: { id?: string; name: string; publisher: string; meta: string; control?: ReactNode; children?: ReactNode }) {
  return (
    <SettingsRow
      id={id}
      label={
        <span className="flex min-w-0 items-baseline gap-1.5">
          <span className="truncate font-medium">{name}</span>
          <span className="shrink-0 truncate type-meta text-muted-foreground">{publisher}</span>
        </span>
      }
      description={meta}
      control={control}
    >
      {children}
    </SettingsRow>
  );
}

function ThemeRow({ theme, slot, label, kind, children }: { theme: ColorTheme | null; slot: ThemeSlot; label: string; kind: ThemeKind; children?: ReactNode }) {
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
      description={<span className="block truncate pl-[2.625rem]">{KIND_LABELS[kind]}</span>}
      onPointerEnter={() => setThemePreview(theme)}
      onPointerLeave={() => setThemePreview(null)}
      control={
        <div className="flex items-center gap-1" onFocus={() => setThemePreview(theme)} onBlur={() => setThemePreview(null)}>
          {isUsed ? (
            <span className="flex h-6 items-center gap-1 px-2.5 type-meta text-muted-foreground">
              <TickCircle aria-hidden className="size-3.5 text-success" />
              In use
            </span>
          ) : (
            <Button variant="outline" size="sm" onClick={() => apply(theme, slot)}>
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
      hint={isStarred ? undefined : 'Starred themes come first in the theme pickers and in ⌘K'}
      aria-pressed={isStarred}
      onClick={() => setPrefs({ starredThemes: toggleStar(starredThemes, theme.id) })}
      className={isStarred ? 'text-warning! [&_*]:text-warning!' : 'text-muted-foreground'}
    >
      <Star weight={isStarred ? 'Filled' : undefined} />
    </TooltipIconButton>
  );
}

function useIsChosen(id: string, slot: ThemeSlot) {
  const prefs = usePrefs();
  return (slot === 'light' ? prefs.lightTheme : prefs.darkTheme) === id;
}

function CustomThemeActions({ theme, file, onEdit }: { theme: ColorTheme; file: string; onEdit: (file: string, text: string) => void }) {
  const edit = () =>
    (host.isDesktop ? host.themes.openCustom(file) : host.themes.readCustom(file).then((text) => onEdit(file, text))).catch((error: Error) => toast.error('Could not open the theme', { description: error.message }));
  const remove = () => removeCustomTheme(theme, file).catch((error: Error) => toast.error('Could not delete the theme', { description: error.message }));
  return (
    <>
      <TooltipIconButton label="Edit" hint={host.isDesktop ? 'Opens the theme file in your JSON editor' : 'Edit the theme JSON here'} onClick={() => void edit()}>
        <Edit2 />
      </TooltipIconButton>
      <TooltipIconButton label="Delete" hint={`Deletes ${file}`} onClick={() => void remove()}>
        <Trash3 />
      </TooltipIconButton>
    </>
  );
}

const KIND_LABELS = { light: 'Light', dark: 'Dark', 'hc-light': 'High contrast light', 'hc-dark': 'High contrast dark' } satisfies Record<ThemeKind, string>;

/** Pasting a new theme, or editing a custom one in the web build (which has no files to open). */
function ThemeJsonEditor({ draft, onDone }: { draft: { file?: string; text: string }; onDone: () => void }) {
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
        placeholder={'{\n  "name": "My theme",\n  "type": "dark",\n  "colors": { "editor.background": "#1e1e1e" },\n  "tokenColors": []\n}'}
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

function MarketplaceGroup() {
  const [query, setQuery] = useState('');
  const { state, more, hasMore, retry } = useMarketplaceSearch(query);
  const isEmpty = state.status === 'done' && state.extensions.length === 0;
  return (
    <SettingsGroup id="themeMarketplace" title="Open VSX" footer="Color themes from open-vsx.org, most downloaded first. Installing reads only each package's theme files; nothing in it runs.">
      <SettingsRow
        label={
          <InputGroup className="h-7">
            <InputGroupAddon>
              <SearchNormal />
            </InputGroupAddon>
            <InputGroupInput id={settingControlId('themeSearch')} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search themes" aria-label="Search Open VSX themes" />
          </InputGroup>
        }
      />
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
      {isEmpty && <SettingsRow label={<span className="text-muted-foreground">No color themes match "{query}"</span>} />}
      {state.status === 'done' && state.extensions.map((extension) => <ExtensionRow key={`${extension.namespace}.${extension.name}`} extension={extension} />)}
      {hasMore && state.status === 'done' && (
        <SettingsRow
          label={
            <Button variant="ghost" size="sm" onClick={more} disabled={state.isLoadingMore}>
              {state.isLoadingMore && <Spinner data-icon="inline-start" />}
              Show more
            </Button>
          }
        />
      )}
    </SettingsGroup>
  );
}

function ExtensionRow({ extension }: { extension: MarketplaceExtension }) {
  const [ref, isSeen] = useSeen<HTMLSpanElement>();
  const inspected = useInspectedThemes(extension, isSeen);
  const { installed } = useThemesState();
  const { mode } = useColorTheme();
  const apply = useApplyTheme();
  const [isInstalling, setInstalling] = useState(false);
  const isInstalled = installed.some((t) => t.source.kind === 'marketplace' && t.source.namespace === extension.namespace && t.source.name === extension.name);
  const themes = inspected.status === 'done' ? inspected.themes : [];
  // Hovering the row previews the theme for the appearance on screen, so it doesn't flip light and dark under you.
  const rowPreview = themes.find((t) => slotOf(t.kind) === mode) ?? themes[0] ?? null;
  const install = (use?: ColorTheme) => {
    setInstalling(true);
    void installExtension(extension)
      .then((found) => {
        const theme = use && found.find((t) => t.id === use.id);
        if (theme) apply(theme);
        toast.success(theme ? `Using ${theme.label}` : `Installed ${extension.displayName}`);
      })
      .catch((error: Error) => toast.error(`Could not install ${extension.displayName}`, { description: error.message }))
      .finally(() => setInstalling(false));
  };
  return (
    <SettingsRow
      label={
        <span ref={ref} className="flex min-w-0 items-center gap-2.5">
          <ExtensionIcon url={extension.iconUrl} />
          <span className="truncate">{extension.displayName}</span>
        </span>
      }
      description={<span className="block truncate pl-[2.625rem]">{extensionMeta(extension)}</span>}
      onPointerEnter={() => setThemePreview(rowPreview)}
      onPointerLeave={() => setThemePreview(null)}
      control={
        <div className="flex items-center gap-2">
          <Swatches extension={extension} inspected={inspected} isInstalled={isInstalled} onPreview={(t) => setThemePreview(t ?? rowPreview)} onUse={(t) => (isInstalled ? apply(installed.find((i) => i.id === t.id) ?? t) : install(t))} />
          {isInstalled ? (
            <span className="flex h-6 w-20 items-center justify-end gap-1 type-meta text-muted-foreground">
              <TickCircle aria-hidden className="size-3.5 text-success" />
              Installed
            </span>
          ) : (
            <Button variant="outline" size="sm" className="w-20" onClick={() => install()} disabled={isInstalling}>
              {isInstalling ? <Spinner data-icon="inline-start" /> : <Download data-icon="inline-start" />}
              Install
            </Button>
          )}
        </div>
      }
    />
  );
}

const DOWNLOADS = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
const THEME_COUNT = new Intl.PluralRules();

const themeCount = (count: number) => (THEME_COUNT.select(count) === 'one' ? '1 theme' : `${count} themes`);

function extensionMeta({ namespace, downloadCount, themes }: MarketplaceExtension) {
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
  if (inspected.status === 'error') return <span className="type-caption text-muted-foreground">Preview unavailable</span>;
  if (inspected.status !== 'done') return <SwatchSkeletons count={Math.min(extension.themes.length, MAX_SWATCHES)} />;
  const hidden = inspected.themes.length - MAX_SWATCHES;
  return (
    <div className="flex items-center gap-1" onPointerLeave={() => onPreview(null)}>
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
              className="rounded-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <ThemeSwatch theme={theme} slot={slotOf(theme.kind)} />
            </button>
          </TooltipTrigger>
          <TooltipContent className="max-w-60 flex-col items-start gap-0.5">
            <span className="block font-medium">{theme.label}</span>
            <span className="block opacity-80">{isInstalled ? 'Use this theme' : 'Install and use this theme'}</span>
          </TooltipContent>
        </Tooltip>
      ))}
      {hidden > 0 && <span className="type-caption text-muted-foreground tabular-nums">+{hidden}</span>}
    </div>
  );
}

const swatchColors = new WeakMap<ColorTheme, Record<string, string>>();

// Mochi's own values from index.css, which the swatch can't read while another theme overrides the tokens on <html>.
const MOCHI_SWATCH = {
  light: { '--background': 'oklch(0.975 0.003 285)', '--foreground': 'oklch(0.2 0.01 285)', '--primary': 'oklch(0.22 0.01 285)', '--syntax-keyword': '#cf222e', '--syntax-string': '#0a3069' },
  dark: { '--background': 'oklch(0.145 0.006 285)', '--foreground': 'oklch(0.965 0.003 285)', '--primary': 'oklch(0.965 0.003 285)', '--syntax-keyword': '#ff7b72', '--syntax-string': '#a5d6ff' },
} satisfies Record<ThemeSlot, Record<string, string>>;

/** A theme in 32×20: its editor background, an "Aa" in its foreground, and a stripe of its primary, keyword and string colors. */
function ThemeSwatch({ theme, slot }: { theme: ColorTheme | null; slot: ThemeSlot }) {
  const tokens = useMemo<Record<string, string>>(() => {
    if (!theme) return MOCHI_SWATCH[slot];
    let cached = swatchColors.get(theme);
    if (!cached) swatchColors.set(theme, (cached = themeTokens(theme.theme, theme.kind)));
    return cached;
  }, [theme, slot]);
  const color = (token: string, fallback: string) => tokens[token] ?? fallback;
  return (
    <span
      aria-hidden
      className="relative flex h-5 w-8 shrink-0 items-center overflow-hidden rounded-sm pl-1 text-[9px]/none font-semibold shadow-[inset_0_0_0_1px_var(--border)]"
      style={{ background: color('--background', 'var(--background)'), color: color('--foreground', 'var(--foreground)') }}
    >
      Aa
      <span className="absolute inset-x-0 bottom-0 flex h-1">
        <span className="flex-1" style={{ background: color('--primary', 'var(--primary)') }} />
        <span className="flex-1" style={{ background: color('--syntax-keyword', 'var(--chart-5)') }} />
        <span className="flex-1" style={{ background: color('--syntax-string', 'var(--chart-3)') }} />
      </span>
    </span>
  );
}

function ExtensionIcon({ url }: { url?: string }) {
  const [isBroken, setBroken] = useState(false);
  if (!url || isBroken) return <span aria-hidden className="size-8 shrink-0 rounded-lg bg-muted" />;
  return <img src={url} alt="" loading="lazy" onError={() => setBroken(true)} className="size-8 shrink-0 rounded-lg object-contain" />;
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

const SKELETON_WIDTHS = ['w-40', 'w-28', 'w-48', 'w-32'];

function SkeletonRows({ count }: { count: number }) {
  return Array.from({ length: count }, (_, i) => (
    <SettingsRow
      key={i}
      label={
        <span className="flex items-center gap-2.5">
          <Skeleton className="size-8 rounded-lg" />
          <Skeleton className={`h-3 ${SKELETON_WIDTHS[i % SKELETON_WIDTHS.length]}`} />
        </span>
      }
    />
  ));
}
