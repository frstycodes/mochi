import { useState, type ReactNode } from 'react';
import { ChevronDown } from '@/icons';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { groupThemes, splitStarred } from '../themes/groups';
import { themeTokens } from '../themes/map';
import {
  MOCHI_THEME_ID,
  slotOf,
  type ColorTheme,
  type ThemeSlot,
} from '../themes/model';
import { setThemePreview, useThemesState } from '../themes/store';
import { useApplyTheme } from '../themes/useMarketplace';
import { settingControlId } from './parts';
import { usePrefs } from './prefs';

/**
 * Picks the color theme one appearance uses: search, then Starred, Mochi, each installed package and your custom files.
 * The highlighted theme previews live; closing without picking puts the current one back. `children` replaces the
 * default select-style trigger.
 */
export function ThemePicker({
  slot,
  children,
}: {
  slot: ThemeSlot;
  children?: ReactNode;
}) {
  const [isOpen, setOpen] = useState(false);
  const chosen = useChosenTheme(slot);
  const toggle = (next: boolean) => {
    setOpen(next);
    if (!next) setThemePreview(null);
  };
  return (
    <Popover open={isOpen} onOpenChange={toggle}>
      <PopoverTrigger asChild>
        {children ?? (
          <Button
            id={settingControlId(`${slot}Theme`)}
            variant="outline"
            size="sm"
            className="w-56 justify-start"
          >
            <ThemeSwatch theme={chosen} slot={slot} />
            <span className="min-w-0 flex-1 truncate text-left">
              {chosen?.label ?? 'Mochi'}
            </span>
            <ChevronDown data-icon="inline-end" />
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-0">
        <ThemeList slot={slot} onPicked={() => toggle(false)} />
      </PopoverContent>
    </Popover>
  );
}

// Starred themes show twice (Starred and their package), and cmdk needs every item's value unique.
const STARRED_PREFIX = 'starred:';

function ThemeList({
  slot,
  onPicked,
}: {
  slot: ThemeSlot;
  onPicked: () => void;
}) {
  const { starredThemes } = usePrefs();
  const { installed } = useThemesState();
  const apply = useApplyTheme();
  const chosenId = useChosenTheme(slot)?.id ?? MOCHI_THEME_ID;
  const options = installed.filter((t) => slotOf(t.kind) === slot);
  const { starred } = splitStarred(options, starredThemes);
  const { packages, custom } = groupThemes(options);
  const byId = new Map(options.map((t) => [t.id, t]));
  const pick = (theme: ColorTheme | null) => {
    apply(theme, slot);
    onPicked();
  };
  // Controlled: cmdk reports the highlighted item only then, and the list opens on the theme in use.
  const [highlighted, setHighlighted] = useState(chosenId);
  const highlight = (value: string) => {
    setHighlighted(value);
    setThemePreview(byId.get(value.replace(STARRED_PREFIX, '')) ?? null);
  };
  return (
    <Command value={highlighted} onValueChange={highlight}>
      <CommandInput placeholder={`Search ${slot} themes`} />
      <CommandList className="max-h-80">
        <CommandEmpty>No {slot} theme matches.</CommandEmpty>
        {starred.length > 0 && (
          <CommandGroup heading="Starred">
            {starred.map((theme) => (
              <ThemeItem
                key={theme.id}
                value={STARRED_PREFIX + theme.id}
                theme={theme}
                slot={slot}
                isChecked={theme.id === chosenId}
                onPick={pick}
              />
            ))}
          </CommandGroup>
        )}
        <CommandGroup heading="Built in">
          <ThemeItem
            value={MOCHI_THEME_ID}
            theme={null}
            slot={slot}
            isChecked={chosenId === MOCHI_THEME_ID}
            onPick={pick}
          />
        </CommandGroup>
        {packages.map((group) => (
          <CommandGroup key={group.id} heading={group.displayName}>
            {group.themes.map((theme) => (
              <ThemeItem
                key={theme.id}
                value={theme.id}
                keywords={[group.displayName, group.publisher]}
                theme={theme}
                slot={slot}
                isChecked={theme.id === chosenId}
                onPick={pick}
              />
            ))}
          </CommandGroup>
        ))}
        {custom.length > 0 && (
          <CommandGroup heading="Custom">
            {custom.map((theme) => (
              <ThemeItem
                key={theme.id}
                value={theme.id}
                keywords={['custom']}
                theme={theme}
                slot={slot}
                isChecked={theme.id === chosenId}
                onPick={pick}
              />
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </Command>
  );
}

function ThemeItem({
  value,
  keywords = [],
  theme,
  slot,
  isChecked,
  onPick,
}: {
  value: string;
  keywords?: string[];
  theme: ColorTheme | null;
  slot: ThemeSlot;
  isChecked: boolean;
  onPick: (theme: ColorTheme | null) => void;
}) {
  const label = theme?.label ?? 'Mochi';
  const isHighContrast = theme?.kind.startsWith('hc-');
  return (
    <CommandItem
      value={value}
      keywords={[label, ...keywords]}
      data-checked={isChecked}
      onSelect={() => onPick(theme)}
    >
      <ThemeSwatch theme={theme} slot={slot} />
      <span className="min-w-0 truncate">{label}</span>
      {isHighContrast && (
        <span className="shrink-0 type-caption text-muted-foreground">
          High contrast
        </span>
      )}
    </CommandItem>
  );
}

/** The installed theme an appearance uses, or null for Mochi (also when the saved one was uninstalled). */
export function useChosenTheme(slot: ThemeSlot) {
  const prefs = usePrefs();
  const { installed } = useThemesState();
  const id = slot === 'light' ? prefs.lightTheme : prefs.darkTheme;
  return installed.find((t) => t.id === id && slotOf(t.kind) === slot) ?? null;
}

// Mochi's own values from index.css, which a preview can't read while another theme overrides the tokens on <html>.
const MOCHI_COLORS = {
  light: {
    background: 'oklch(0.975 0.003 285)',
    foreground: 'oklch(0.2 0.01 285)',
    sidebar: 'oklch(0.99 0.002 285)',
    muted: 'oklch(0.96 0.004 285)',
    primary: 'oklch(0.22 0.01 285)',
    keyword: '#cf222e',
    string: '#0a3069',
  },
  dark: {
    background: 'oklch(0.145 0.006 285)',
    foreground: 'oklch(0.965 0.003 285)',
    sidebar: 'oklch(0.175 0.007 285)',
    muted: 'oklch(0.215 0.007 285)',
    primary: 'oklch(0.965 0.003 285)',
    keyword: '#ff7b72',
    string: '#a5d6ff',
  },
} satisfies Record<ThemeSlot, Record<string, string>>;

type ThemeColors = (typeof MOCHI_COLORS)[ThemeSlot];

const themeColors = new WeakMap<ColorTheme, ThemeColors>();

/** The handful of colors a preview paints with, read once per theme; null is Mochi. */
export function themeColorsOf(
  theme: ColorTheme | null,
  slot: ThemeSlot,
): ThemeColors {
  if (!theme) return MOCHI_COLORS[slot];
  const cached = themeColors.get(theme);
  if (cached) return cached;
  const tokens = themeTokens(theme.theme, theme.kind);
  const fallback = MOCHI_COLORS[slotOf(theme.kind)];
  const colors = {
    background: tokens['--background'] ?? fallback.background,
    foreground: tokens['--foreground'] ?? fallback.foreground,
    sidebar: tokens['--sidebar'] ?? tokens['--background'] ?? fallback.sidebar,
    muted: tokens['--muted'] ?? fallback.muted,
    primary: tokens['--primary'] ?? fallback.primary,
    keyword: tokens['--syntax-keyword'] ?? fallback.keyword,
    string: tokens['--syntax-string'] ?? fallback.string,
  };
  themeColors.set(theme, colors);
  return colors;
}

/** A theme in 32×20: its editor background, an "Aa" in its foreground, and a stripe of its primary, keyword and string colors. */
export function ThemeSwatch({
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
      className="relative flex h-5 w-8 shrink-0 items-center overflow-hidden rounded-sm pl-1 text-[9px]/none font-semibold shadow-[inset_0_0_0_1px_var(--border)]"
      style={{ background: c.background, color: c.foreground }}
    >
      Aa
      <span className="absolute inset-x-0 bottom-0 flex h-1">
        <span className="flex-1" style={{ background: c.primary }} />
        <span className="flex-1" style={{ background: c.keyword }} />
        <span className="flex-1" style={{ background: c.string }} />
      </span>
    </span>
  );
}
