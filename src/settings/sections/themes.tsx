import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Brush, ClipboardText, DocumentCode, Download, Edit2, Import, SearchNormal, TickCircle, Trash3 } from 'reicon-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { host } from '../../host';
import { customizedThemeText } from '../../themes/custom';
import { themeTokens } from '../../themes/map';
import { MOCHI_THEME_ID, slotOf, type ColorTheme, type ThemeSlot } from '../../themes/model';
import type { MarketplaceExtension } from '../../themes/openVsx';
import { refreshThemes, setThemePreview, useColorTheme, useThemesState } from '../../themes/store';
import { installExtension, useApplyTheme, useInspectedThemes, useMarketplaceSearch, useSeen } from '../../themes/useMarketplace';
import { usePrefs } from '../prefs';
import { TooltipIconButton } from '../../ui';
import { SettingsGroup, SettingsRow, settingControlId } from '../parts';
import { ThemeVariableEditor } from './ThemeVariableEditor';

export function ThemesSection() {
  // Leaving the section mid-hover must not leave a preview painted.
  useEffect(() => () => setThemePreview(null), []);
  return (
    <div className="flex flex-col gap-8">
      <SettingsGroup id="colorTheme" footer="System switches between these with your system's appearance. Hover a theme to preview it; nothing changes until you pick one.">
        <SettingsRow id="lightTheme" label="Light" control={<SlotSelect slot="light" />} />
        <SettingsRow id="darkTheme" label="Dark" control={<SlotSelect slot="dark" />} />
      </SettingsGroup>
      <InstalledGroup />
      <MarketplaceGroup />
    </div>
  );
}

const MOCHI_VALUE = MOCHI_THEME_ID;

function SlotSelect({ slot }: { slot: ThemeSlot }) {
  const prefs = usePrefs();
  const { installed } = useThemesState();
  const apply = useApplyTheme();
  const options = installed.filter((t) => slotOf(t.kind) === slot);
  const chosen = slot === 'light' ? prefs.lightTheme : prefs.darkTheme;
  const value = options.some((t) => t.id === chosen) ? chosen : MOCHI_VALUE;
  const choose = (id: string) => apply(options.find((t) => t.id === id) ?? null, slot);
  return (
    <Select value={value} onValueChange={choose} onOpenChange={(isOpen) => !isOpen && setThemePreview(null)}>
      <SelectTrigger id={settingControlId(`${slot}Theme`)} size="sm" className="w-56">
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end">
        <SelectItem value={MOCHI_VALUE} onFocus={() => setThemePreview(null)}>
          <ThemeSwatch theme={null} slot={slot} />
          Mochi
        </SelectItem>
        {options.map((theme) => (
          <SelectItem key={theme.id} value={theme.id} onFocus={() => setThemePreview(theme)}>
            <ThemeSwatch theme={theme} slot={slot} />
            <span className="truncate">{theme.label}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function InstalledGroup() {
  const { installed, isLoaded } = useThemesState();
  const apply = useApplyTheme();
  const [draft, setDraft] = useState<{ file?: string; text: string } | null>(null);
  const [editingFile, setEditingFile] = useState<string | null>(null);
  const importFile = () =>
    host.themes.importFile().then(
      (theme) => theme && void refreshThemes().then(() => toast.success(`Imported ${theme.label}`)),
      (error: Error) => toast.error('Could not import the theme', { description: error.message }),
    );
  const editJson = (file: string) =>
    (host.isDesktop ? host.themes.openCustom(file) : host.themes.readCustom(file).then((text) => setDraft({ file, text }))).catch((error: Error) =>
      toast.error('Could not open the theme', { description: error.message }),
    );
  const customize = (theme: ColorTheme) =>
    host.themes
      .saveCustom(customizedThemeText(theme))
      .then(async (copy) => {
        await refreshThemes();
        apply(copy);
        if (copy.source.kind === 'custom') setEditingFile(copy.source.file);
      })
      .catch((error: Error) => toast.error('Could not copy the theme', { description: error.message }));
  const isEmpty = isLoaded && installed.length === 0;
  return (
    <SettingsGroup
      id="installedThemes"
      title="Installed"
      footer="Custom themes are VS Code color theme files (.json or .jsonc). Customize copies a theme with every Mochi color it maps to, ready to edit here or in its file. PR states and other status colors stay Mochi's unless you set them."
    >
      {!isLoaded && <SkeletonRows count={2} />}
      {isEmpty && <SettingsRow label={<span className="text-muted-foreground">No themes yet. Install one from Open VSX below, or import your own.</span>} />}
      {installed.map((theme) => {
        const { source } = theme;
        const isEditing = source.kind === 'custom' && source.file === editingFile;
        return (
          <InstalledRow key={theme.id} theme={theme} isEditing={isEditing} onEdit={(file) => setEditingFile(isEditing ? null : file)} onEditJson={(file) => void editJson(file)} onCustomize={() => void customize(theme)}>
            {isEditing && source.kind === 'custom' && <ThemeVariableEditor theme={theme} onEditJson={() => void editJson(source.file)} onDone={() => setEditingFile(null)} />}
          </InstalledRow>
        );
      })}
      <SettingsRow
        id="customTheme"
        label="Custom theme"
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
      </SettingsRow>
    </SettingsGroup>
  );
}

function InstalledRow({
  theme,
  isEditing,
  onEdit,
  onEditJson,
  onCustomize,
  children,
}: {
  theme: ColorTheme;
  isEditing: boolean;
  onEdit: (file: string) => void;
  onEditJson: (file: string) => void;
  onCustomize: () => void;
  children?: ReactNode;
}) {
  const prefs = usePrefs();
  const apply = useApplyTheme();
  const slot = slotOf(theme.kind);
  const isUsed = (slot === 'light' ? prefs.lightTheme : prefs.darkTheme) === theme.id;
  const { source } = theme;
  const remove = () => {
    if (isUsed) apply(null, slot);
    const removing = source.kind === 'custom' ? host.themes.removeCustom(source.file) : source.kind === 'marketplace' ? host.themes.uninstall(source.namespace, source.name) : Promise.resolve();
    void removing.then(refreshThemes).catch((error: Error) => toast.error('Could not remove the theme', { description: error.message }));
  };
  return (
    <SettingsRow
      label={
        <span className="flex min-w-0 items-center gap-2.5">
          <ThemeSwatch theme={theme} slot={slot} />
          <span className="truncate">{theme.label}</span>
        </span>
      }
      description={<span className="block truncate pl-[2.625rem]">{[sourceLabel(theme), KIND_LABELS[theme.kind]].join(' · ')}</span>}
      // While its editor is open the edits are on screen; hovering the row must not swap them for the saved file.
      onPointerEnter={() => !isEditing && setThemePreview(theme)}
      onPointerLeave={() => setThemePreview(null)}
      control={
        <div className="flex items-center gap-1" onFocus={() => !isEditing && setThemePreview(theme)} onBlur={() => setThemePreview(null)}>
          {isUsed ? (
            <span className="flex h-6 items-center gap-1 px-2.5 type-meta text-muted-foreground">
              <TickCircle aria-hidden className="size-3.5 text-success" />
              In use
            </span>
          ) : (
            <Button variant="outline" size="sm" onClick={() => apply(theme)}>
              Use
            </Button>
          )}
          {source.kind === 'custom' ? (
            <>
              <TooltipIconButton label="Edit colors" hint="Set Mochi's colors for this theme, previewed as you go" onClick={() => onEdit(source.file)} aria-expanded={isEditing}>
                <Edit2 />
              </TooltipIconButton>
              <TooltipIconButton label="Edit JSON" hint={host.isDesktop ? 'Opens the theme file in your JSON editor' : 'Edit the theme JSON here'} onClick={() => onEditJson(source.file)}>
                <DocumentCode />
              </TooltipIconButton>
            </>
          ) : (
            <TooltipIconButton label="Customize" hint="Copies it as a custom theme with every color it maps to filled in" onClick={onCustomize}>
              <Brush />
            </TooltipIconButton>
          )}
          {source.kind !== 'mochi' && (
            <TooltipIconButton
              label={source.kind === 'custom' ? 'Delete' : 'Uninstall'}
              hint={source.kind === 'custom' ? 'Deletes the theme file' : `Removes every ${source.displayName} theme`}
              onClick={remove}
            >
              <Trash3 />
            </TooltipIconButton>
          )}
        </div>
      }
    >
      {children}
    </SettingsRow>
  );
}

const KIND_LABELS = { light: 'Light', dark: 'Dark', 'hc-light': 'High contrast light', 'hc-dark': 'High contrast dark' } satisfies Record<ColorTheme['kind'], string>;

function sourceLabel({ source }: ColorTheme) {
  if (source.kind === 'marketplace') return `${source.displayName} by ${source.publisher}`;
  if (source.kind === 'custom') return `Custom · ${source.file}`;
  return 'Built in';
}

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
        placeholder={'{\n  "name": "My theme",\n  "type": "dark",\n  "mochi": { "success": "#3fb950" },\n  "colors": { "editor.background": "#1e1e1e" },\n  "tokenColors": []\n}'}
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

function extensionMeta({ namespace, downloadCount, themes }: MarketplaceExtension) {
  const count = THEME_COUNT.select(themes.length) === 'one' ? '1 theme' : `${themes.length} themes`;
  return `${namespace} · ${DOWNLOADS.format(downloadCount)} downloads · ${count}`;
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
