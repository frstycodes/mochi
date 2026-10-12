import type { ComponentType } from 'react';
import { BranchUp, Compass, Cpu, Database, Global, Keyboard, Notification, People, Setting2, Setting4, TerminalSquare, type IconComponent } from 'reicon-react';
import { getProfiles } from '../../profiles';
import { ALERT_KINDS } from '../../notify/model';
import { HARNESS_IDS, HARNESSES } from '../harnesses';
import { BrowserSection } from './browser';
import { DataSection } from './data';
import { DefaultsSection } from './defaults';
import { GeneralSection } from './general';
import { GitSection } from './git';
import { GoalsSection } from './goals';
import { HarnessesSection } from './harnesses';
import { KeyboardSection, SHORTCUTS, shortcutSettingId } from './keyboard';
import { NotificationsSection } from './notifications';
import { ProfilesSection } from './profiles';
import { TerminalSection } from './terminal';

export const SECTION_GROUPS = ['App', 'Agents', 'Workspace'] as const;

export interface SettingsSection {
  id: string;
  group: (typeof SECTION_GROUPS)[number];
  title: string;
  icon: IconComponent;
  component: ComponentType;
  /** Every row's id and label, for search and deep links; the section renders the rows. Rows that need the desktop app say so in the section. */
  settings: { id: string; label: string; keywords?: string }[];
}

/** The settings page in sidebar order (SETTINGS.md). */
export const SETTINGS_SECTIONS = [
  {
    id: 'general',
    group: 'App',
    title: 'General',
    icon: Setting2,
    component: GeneralSection,
    settings: [
      { id: 'theme', label: 'Theme', keywords: 'appearance dark light system mode' },
      { id: 'reduceMotion', label: 'Reduce motion', keywords: 'animation accessibility' },
      { id: 'projectsFolder', label: 'Projects folder', keywords: 'path open folder directory' },
      { id: 'restoreLayout', label: 'Restore layout on launch', keywords: 'splits views startup' },
    ],
  },
  {
    id: 'notifications',
    group: 'App',
    title: 'Notifications',
    icon: Notification,
    component: NotificationsSection,
    settings: [
      ...Object.entries(ALERT_KINDS).map(([kind, label]) => ({ id: `alert-${kind}`, label: `${label} alerts`, keywords: 'system notification background' })),
      { id: 'watchedToasts', label: 'Toasts for watched threads', keywords: 'notification popup watch' },
      { id: 'dockBadge', label: 'Dock badge counts', keywords: 'badge icon needs you' },
      { id: 'quietHours', label: 'Quiet hours', keywords: 'do not disturb night silence' },
      { id: 'mutedThreads', label: 'Muted threads', keywords: 'mute unmute silence' },
    ],
  },
  {
    id: 'keyboard',
    group: 'App',
    title: 'Keyboard',
    icon: Keyboard,
    component: KeyboardSection,
    get settings() {
      return SHORTCUTS.filter((a) => a.exists?.() ?? true).map((a) => ({ id: shortcutSettingId(a), label: a.title, keywords: `shortcut key ${a.keywords ?? ''}` }));
    },
  },
  {
    id: 'harnesses',
    group: 'Agents',
    title: 'Harnesses',
    icon: Cpu,
    component: HarnessesSection,
    settings: [
      ...HARNESS_IDS.flatMap((id) => {
        const { name, apiKey } = HARNESSES[id];
        return [
          { id: `${id}Install`, label: `${name} install`, keywords: 'version path detected check' },
          { id: `${id}Path`, label: `${name} custom path`, keywords: 'executable binary' },
          { id: `${id}Model`, label: `${name} default model`, keywords: 'model' },
          { id: `${id}Accounts`, label: `${name} accounts`, keywords: 'login sign in plan config folder add rename remove' },
          { id: `${id}Profiles`, label: `${name} account per profile`, keywords: 'space link' },
          ...(apiKey ? [{ id: `${id}ApiKey`, label: apiKey.label, keywords: 'key billing keychain' }] : []),
        ];
      }),
      { id: 'starredModels', label: 'Starred models', keywords: 'favorite star dock model claude codex opus sonnet haiku gpt' },
      { id: 'effort', label: 'Default effort', keywords: 'reasoning thinking' },
    ],
  },
  {
    id: 'defaults',
    group: 'Agents',
    title: 'Defaults for new threads',
    icon: Setting4,
    component: DefaultsSection,
    settings: [
      { id: 'agent', label: 'Agent', keywords: 'harness claude codex new thread' },
      { id: 'permissions', label: 'Permissions', keywords: 'ask auto edit full access' },
      { id: 'runsOn', label: 'Runs on', keywords: 'device machine cloud sandbox' },
      { id: 'sideChatModel', label: 'Side chat model', keywords: 'aside question claude codex gpt sonnet opus haiku' },
      { id: 'concurrency', label: 'Agents running at once', keywords: 'concurrency limit parallel' },
      { id: 'usageLimit', label: 'When a usage limit hits', keywords: 'rate limit pause reset quota' },
    ],
  },
  {
    id: 'goals',
    group: 'Agents',
    title: 'Goals and drift',
    icon: Compass,
    component: GoalsSection,
    settings: [
      { id: 'driftThreshold', label: 'Drift sensitivity', keywords: 'off-goal threshold scope' },
      { id: 'branchFrom', label: 'Off-goal work branches from', keywords: 'drift branch base current' },
      { id: 'stepSize', label: 'New step size', keywords: 'points progress eta small medium large' },
    ],
  },
  {
    id: 'profiles',
    group: 'Workspace',
    title: 'Profiles',
    icon: People,
    component: ProfilesSection,
    // A getter: the rows follow the profiles, so search finds "Personal GitHub account" right after a rename.
    get settings() {
      return [
        ...getProfiles().flatMap(({ id, name }) => [
          { id: `${id}-name`, label: `${name} name`, keywords: 'profile space rename' },
          { id: `${id}-icon`, label: `${name} icon`, keywords: 'profile space symbol' },
          { id: `${id}-github`, label: `${name} GitHub account`, keywords: 'profile gh user' },
          { id: `${id}-browsing`, label: `${name} browsing data`, keywords: 'profile cookies logins clear browser' },
        ]),
        { id: 'addProfile', label: 'Add profile', keywords: 'new space' },
      ];
    },
  },
  {
    id: 'git',
    group: 'Workspace',
    title: 'Git',
    icon: BranchUp,
    component: GitSection,
    settings: [
      { id: 'worktreeRoot', label: 'Worktrees folder', keywords: 'worktree path directory' },
      { id: 'branchPrefix', label: 'Branch prefix', keywords: 'branch name' },
      { id: 'prDrafts', label: 'Open pull requests as drafts', keywords: 'pr github draft' },
      { id: 'diffStyle', label: 'Diffs', keywords: 'unified split side by side changes' },
    ],
  },
  {
    id: 'terminal',
    group: 'Workspace',
    title: 'Terminal',
    icon: TerminalSquare,
    component: TerminalSection,
    settings: [
      { id: 'shell', label: 'Shell', keywords: 'zsh bash fish' },
      { id: 'terminalFontSize', label: 'Terminal font size', keywords: 'text size' },
      { id: 'terminalScrollback', label: 'Scrollback lines', keywords: 'history buffer' },
      { id: 'restoreTerminals', label: 'Restore terminals on launch', keywords: 'startup tabs' },
    ],
  },
  {
    id: 'browser',
    group: 'Workspace',
    title: 'Browser and devices',
    icon: Global,
    component: BrowserSection,
    settings: [
      { id: 'searchEngine', label: 'Search engine', keywords: 'duckduckgo google bing kagi address bar' },
      { id: 'addressHistory', label: 'Clear address history', keywords: 'browser urls suggestions' },
      { id: 'simulator', label: 'Default simulator', keywords: 'ios iphone ipad device' },
    ],
  },
  {
    id: 'data',
    group: 'Workspace',
    title: 'Data',
    icon: Database,
    component: DataSection,
    settings: [
      { id: 'demoData', label: 'Show demo data', keywords: 'sample example fixture threads prototype' },
      { id: 'storage', label: 'Storage used', keywords: 'disk space size' },
      { id: 'clearPins', label: 'Clear pins', keywords: 'reset delete' },
      { id: 'clearSideChats', label: 'Clear side chats', keywords: 'reset delete' },
      { id: 'clearTerminals', label: 'Clear terminal history', keywords: 'reset delete scrollback' },
      { id: 'clearEverything', label: 'Clear everything', keywords: 'reset delete factory' },
      { id: 'about', label: 'About Mochi', keywords: 'version electron chromium docs' },
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
