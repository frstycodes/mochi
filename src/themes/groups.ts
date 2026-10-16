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

/**
 * The packages a library filter shows, each with the themes to list: all of them when the package's name matches,
 * otherwise only the themes whose label does. An empty query shows everything.
 */
export function filterPackages(packages: PackageGroup[], query: string) {
  const q = query.trim().toLowerCase();
  const matches = (text: string) => text.toLowerCase().includes(q);
  return packages.flatMap((group) => {
    const themes = !q || matches(group.displayName) ? group.themes : group.themes.filter((t) => matches(t.label));
    return themes.length ? [{ group, themes }] : [];
  });
}

/** The starred themes that are installed, in the order you starred them, and every other theme in its own order. */
export function splitStarred(themes: ColorTheme[], starred: string[]) {
  const byId = new Map(themes.map((t) => [t.id, t]));
  return { starred: starred.flatMap((id) => byId.get(id) ?? []), rest: themes.filter((t) => !starred.includes(t.id)) };
}

/** The slots whose chosen theme is one of `themes`, so removing them can hand those slots back to Mochi. */
export function slotsUsing(themes: ColorTheme[], chosen: Record<`${ThemeSlot}Theme`, string>) {
  return themes.filter((t) => chosen[`${slotOf(t.kind)}Theme`] === t.id).map((t) => slotOf(t.kind));
}
