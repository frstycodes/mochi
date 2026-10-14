import { slotOf, type ColorTheme, type ThemeSlot } from './model.ts';

export interface PackageGroup {
  id: string;
  namespace: string;
  name: string;
  displayName: string;
  publisher: string;
  version: string;
  themes: ColorTheme[];
}

/** Installed themes by where they came from: one group per Open VSX package (by display name), then the custom files. */
export function groupThemes(installed: ColorTheme[]) {
  const packages = new Map<string, PackageGroup>();
  const custom: ColorTheme[] = [];
  for (const theme of installed) {
    const { source } = theme;
    if (source.kind === 'custom') custom.push(theme);
    if (source.kind !== 'marketplace') continue;
    const id = `${source.namespace}.${source.name}`;
    const group = packages.get(id) ?? { id, namespace: source.namespace, name: source.name, displayName: source.displayName, publisher: source.publisher, version: source.version, themes: [] };
    group.themes.push(theme);
    packages.set(id, group);
  }
  return { packages: [...packages.values()].sort((a, b) => a.displayName.localeCompare(b.displayName)), custom };
}

/** The slots whose chosen theme is one of `themes`, so removing them can hand those slots back to Mochi. */
export function slotsUsing(themes: ColorTheme[], chosen: Record<`${ThemeSlot}Theme`, string>) {
  return themes.filter((t) => chosen[`${slotOf(t.kind)}Theme`] === t.id).map((t) => slotOf(t.kind));
}
