import type { ComponentType } from 'react';
import { Cpu, Setting2, type IconComponent } from 'reicon-react';
import { SPACES } from '../../model';
import { HARNESS_IDS, HARNESSES } from '../harnesses';
import { DefaultsSection } from './defaults';
import { HarnessesSection } from './harnesses';

export const SECTION_GROUPS = ['App', 'Agents', 'Workspace'] as const;

export interface SettingsSection {
  id: string;
  group: (typeof SECTION_GROUPS)[number];
  title: string;
  icon: IconComponent;
  component: ComponentType;
  /** Every row's id and label, for search and deep links; the section renders the rows. */
  settings: { id: string; label: string; keywords?: string }[];
  /** Detection, accounts, the keychain: the web build shows a notice in place of the rows. */
  needsDesktop?: boolean;
}

/**
 * The settings page in sidebar order (SETTINGS.md). A section appears once its rows are wired; General, Notifications,
 * Keyboard, Goals and drift, Profiles, Git, Terminal, Browser and devices and Data join here as they are.
 */
export const SETTINGS_SECTIONS = [
  {
    id: 'harnesses',
    group: 'Agents',
    title: 'Harnesses',
    icon: Cpu,
    component: HarnessesSection,
    needsDesktop: true,
    settings: HARNESS_IDS.flatMap((id) => {
      const { name, apiKey } = HARNESSES[id];
      return [
        { id: `${id}Install`, label: `${name} install`, keywords: 'version path detected check' },
        { id: `${id}Path`, label: `${name} custom path`, keywords: 'executable binary' },
        { id: `${id}Model`, label: `${name} default model`, keywords: 'model' },
        { id: `${id}Accounts`, label: `${name} accounts`, keywords: 'login sign in plan config folder add rename remove' },
        { id: `${id}Profiles`, label: `${name} account per profile`, keywords: `space link ${SPACES.map((s) => s.name).join(' ')}` },
        ...(apiKey ? [{ id: `${id}ApiKey`, label: apiKey.label, keywords: 'key billing keychain' }] : []),
      ];
    }),
  },
  {
    id: 'defaults',
    group: 'Agents',
    title: 'Defaults for new threads',
    icon: Setting2,
    component: DefaultsSection,
    needsDesktop: true,
    settings: [
      { id: 'concurrency', label: 'Agents running at once', keywords: 'concurrency limit parallel' },
      { id: 'usageLimit', label: 'When a usage limit hits', keywords: 'rate limit pause reset quota' },
    ],
  },
] as const satisfies SettingsSection[];

export type SectionId = (typeof SETTINGS_SECTIONS)[number]['id'];

/** Sections whose title or any setting label or keyword contains the query, with the settings that matched. */
export function searchSettings(query: string) {
  const q = query.trim().toLowerCase();
  return SETTINGS_SECTIONS.flatMap((section) => {
    if (!q) return [{ section, settings: [] as SettingsSection['settings'] }];
    const settings = (section.settings as SettingsSection['settings']).filter((s) => `${s.label} ${s.keywords ?? ''}`.toLowerCase().includes(q));
    return settings.length || section.title.toLowerCase().includes(q) ? [{ section, settings }] : [];
  });
}
