import type { ComponentType } from 'react';
import { Brush, Clock, Compass, Cpu, Database, Devices, Globe, Hierarchy2, Info, Keyboard, MagicStar, Notification, Users, Settings, ShieldCheck, Stars, Terminal, type IconComponent } from '@/icons';
import { getProfiles } from '../../profiles';
import { ALERT_KINDS } from '../../notify/model';
import { COMMANDS } from '../../keymap';
import { HARNESS_IDS, HARNESSES } from '../harnesses';
import { UTILITY_TASK_LABELS, UTILITY_TASKS } from '../../utility/prompts';
import { IDLE_ALERTS } from '../settingOptions';
import { AboutSection } from './about';
import { AccessSection, toolRowId } from './access';
import { TOOL_NAMES } from '../../runtime/toolTable';
import { TOOL_GUIDE } from '../toolGuide';
import { AppearanceSection } from './appearance';
import { BrowserSection } from './browser';
import { DataSection } from './data';
import { GeneralSection } from './general';
import { GitSection } from './git';
import { GoalsSection } from './goals';
import { HarnessesSection } from './harnesses';
import { KeyboardSection, shortcutRowId, shownCommands } from './keyboard';
import { ModelsSection } from './models';
import { NotificationsSection } from './notifications';
import { ProfilesSection } from './profiles';
import { RemoteSection } from './remote';
import { SchedulesSection } from './schedules';
import { SimplifySection } from './simplify';
import { TerminalSection } from './terminal';
import { ANIMATIONS } from '../settingOptions';

export const SECTION_GROUPS = ['Mochi', 'Agents', 'Workspace', 'System'] as const;

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
    group: 'Mochi',
    title: 'General',
    icon: Settings,
    component: GeneralSection,
    settings: [
      { id: 'agent', label: 'Agent', keywords: 'harness claude codex new thread default' },
      { id: 'permissions', label: 'Permissions', keywords: 'manual ask auto edit full access bypass plan' },
      { id: 'whileWorking', label: 'While the agent is working, new messages', keywords: 'queue steer send message interrupt busy' },
      { id: 'concurrency', label: 'Agents running at once', keywords: 'concurrency limit parallel' },
      { id: 'usageLimit', label: 'When a usage limit hits', keywords: 'rate limit pause reset quota' },
      { id: 'projectsFolder', label: 'Projects folder', keywords: 'path open folder directory' },
      { id: 'restoreLayout', label: 'Restore layout on launch', keywords: 'splits views startup' },
    ],
  },
  {
    id: 'appearance',
    group: 'Mochi',
    title: 'Appearance',
    icon: Brush,
    component: AppearanceSection,
    settings: [
      { id: 'theme', label: 'Theme', keywords: 'appearance dark light system mode' },
      { id: 'reduceMotion', label: 'Reduce motion', keywords: 'animation accessibility' },
      { id: 'appIcon', label: 'App icon', keywords: 'dock icon logo variant' },
      ...Object.entries(ANIMATIONS).flatMap(([area, { label, items }]) => [
        { id: `animations${area[0]!.toUpperCase()}${area.slice(1)}`, label, keywords: 'animation motion transition slide' },
        ...items.map((item) => ({ id: `animation-${item.value}`, label: item.label, keywords: `${label} animation motion` })),
      ]),
      { id: 'lightTheme', label: 'Light theme', keywords: 'color theme vs code' },
      { id: 'darkTheme', label: 'Dark theme', keywords: 'color theme vs code' },
      { id: 'installedThemes', label: 'Installed themes', keywords: 'uninstall remove color theme' },
      { id: 'customTheme', label: 'Custom theme', keywords: 'import paste json jsonc vs code color theme file' },
      { id: 'themeMarketplace', label: 'Open VSX themes', keywords: 'marketplace browse install vs code color theme one dark catppuccin github dracula' },
    ],
  },
  {
    id: 'notifications',
    group: 'Mochi',
    title: 'Notifications',
    icon: Notification,
    component: NotificationsSection,
    settings: [
      ...Object.entries(ALERT_KINDS).map(([kind, label]) => ({ id: `alert-${kind}`, label: `${label} alerts`, keywords: 'system notification background' })),
      { id: 'watchedToasts', label: 'Toasts for watched threads', keywords: 'notification popup watch' },
      { id: 'dockBadge', label: 'App icon badge counts', keywords: 'badge icon needs you' },
      ...IDLE_ALERTS.map(({ value, label }) => ({ id: `idleAlert${value[0].toUpperCase()}${value.slice(1)}`, label: `Notify when idle with ${label.toLowerCase()}`, keywords: 'idle verdict notification alert gaps stalled done' })),
      { id: 'quietHours', label: 'Quiet hours', keywords: 'do not disturb night silence' },
      { id: 'mutedThreads', label: 'Muted threads', keywords: 'mute unmute silence' },
    ],
  },
  {
    id: 'keyboard',
    group: 'Mochi',
    title: 'Keyboard shortcuts',
    icon: Keyboard,
    component: KeyboardSection,
    get settings() {
      return shownCommands(getProfiles().length).map((id) => ({ id: shortcutRowId(id), label: COMMANDS[id].title, keywords: `shortcut key keybinding ${COMMANDS[id].group}` }));
    },
  },
  {
    id: 'profiles',
    group: 'Mochi',
    title: 'Profiles',
    icon: Users,
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
    id: 'harnesses',
    group: 'Agents',
    title: 'Harnesses',
    icon: Cpu,
    component: HarnessesSection,
    settings: HARNESS_IDS.flatMap((id) => {
      const { name, apiKey } = HARNESSES[id];
      return [
        { id: `${id}Install`, label: `${name} install`, keywords: 'version path detected check' },
        { id: `${id}Path`, label: `${name} custom path`, keywords: 'executable binary' },
        { id: `${id}Accounts`, label: `${name} accounts`, keywords: 'login sign in plan config folder add rename remove' },
        { id: `${id}Profiles`, label: `${name} account per profile`, keywords: 'space link' },
        ...(apiKey ? [{ id: `${id}ApiKey`, label: apiKey.label, keywords: 'key billing keychain' }] : []),
      ];
    }),
  },
  {
    id: 'models',
    group: 'Agents',
    title: 'Models',
    icon: MagicStar,
    component: ModelsSection,
    settings: [
      { id: 'starredModels', label: 'Starred models', keywords: 'favorite star dock model claude codex opus sonnet haiku gpt' },
      { id: 'effort', label: 'Default effort', keywords: 'reasoning thinking' },
      { id: 'speed', label: 'Default speed', keywords: 'fast mode service tier priority' },
      ...HARNESS_IDS.flatMap((id) => {
        const { name } = HARNESSES[id];
        return [
          { id: `${id}Model`, label: `${name} default model`, keywords: 'model' },
          { id: `${id}SecondOpinionModel`, label: `${name} second opinion model`, keywords: 'model review verdict' },
        ];
      }),
      { id: 'sideChatModel', label: 'Side chat model', keywords: 'aside question claude codex gpt sonnet opus haiku' },
      { id: 'imageGen', label: 'Image generation', keywords: 'image picture generate codex gpt-image draw' },
      { id: 'backgroundModel', label: 'Background model', keywords: 'background utility cheap model haiku luna every task all' },
      ...UTILITY_TASKS.map((task) => ({ id: `utility-${task}`, label: `${UTILITY_TASK_LABELS[task]} model`, keywords: 'background utility cheap model haiku luna generate draft title goal outcome criteria commit pull request pr goal steps handoff summary audit transcript verdict' })),
    ],
  },
  {
    id: 'goals',
    group: 'Agents',
    title: 'Goals and checks',
    icon: Compass,
    component: GoalsSection,
    settings: [
      { id: 'driftGuard', label: 'Drift guard', keywords: 'off-goal check classify turn off disable' },
      { id: 'branchFrom', label: 'Off-goal work branches from', keywords: 'drift branch base current' },
      { id: 'proposedGoals', label: 'Agent-proposed goals', keywords: 'propose goal accept apply undo agent writes criteria' },
      { id: 'idleChecks', label: 'Run criterion checks', keywords: 'idle verdict check test turn end' },
      { id: 'prGaps', label: 'Gaps when opening a pull request', keywords: 'open_pr gate block critical warn open anyway' },
    ],
  },
  {
    id: 'simplify',
    group: 'Agents',
    title: 'Simplify',
    icon: Stars,
    component: SimplifySection,
    settings: [
      { id: 'simplifyLength', label: 'Length', keywords: 'simplify bullets summary short detailed' },
      { id: 'simplifyNeedsFirst', label: 'Put what needs you first', keywords: 'simplify question decision' },
      { id: 'simplifyRules', label: 'Your rules', keywords: 'simplify custom instructions rules' },
      { id: 'simplifyAuto', label: 'Simplify long replies automatically', keywords: 'simplify auto automatic' },
      { id: 'simplifyAutoWords', label: 'Long means more than (words)', keywords: 'simplify threshold words length' },
    ],
  },
  {
    id: 'access',
    group: 'Agents',
    title: 'Mochi access',
    icon: ShieldCheck,
    component: AccessSection,
    settings: [
      { id: 'agentControl', label: 'Agents can change Mochi', keywords: 'tools permissions read only changes settings confirm approve mcp control browser delete' },
      { id: 'threadModels', label: 'Models for threads agents start', keywords: 'tools model effort cheaper start thread' },
      ...TOOL_NAMES.map((name) => ({ id: toolRowId(name), label: TOOL_GUIDE[name].label, keywords: `${name} ${TOOL_GUIDE[name].group} tool allow ask approval off agent` })),
    ],
  },
  {
    id: 'schedules',
    group: 'Agents',
    title: 'Schedules',
    icon: Clock,
    component: SchedulesSection,
    settings: [{ id: 'schedules', label: 'Scheduled and background threads', keywords: 'cron nightly trigger pull request pause resume run' }],
  },
  {
    id: 'git',
    group: 'Workspace',
    title: 'Git and worktrees',
    icon: Hierarchy2,
    component: GitSection,
    settings: [
      { id: 'worktreeRoot', label: 'Worktrees folder', keywords: 'worktree path directory' },
      { id: 'workspaceMode', label: 'New threads work in', keywords: 'worktree project folder local checkout workspace' },
      { id: 'worktreeCleanup', label: 'Remove settled worktrees', keywords: 'worktree cleanup delete settled' },
      { id: 'prepareWorktrees', label: 'Prepare worktrees before starting', keywords: 'worktree setup install dependencies' },
      { id: 'worktreeInclude', label: 'Ignored files to copy', keywords: 'worktreeinclude env gitignore copy' },
      { id: 'branchPrefix', label: 'Branch prefix', keywords: 'branch name' },
      { id: 'prDrafts', label: 'Open pull requests as drafts', keywords: 'pr github draft' },
      { id: 'diffStyle', label: 'Diffs', keywords: 'unified split side by side changes' },
    ],
  },
  {
    id: 'terminal',
    group: 'Workspace',
    title: 'Terminal',
    icon: Terminal,
    component: TerminalSection,
    settings: [
      { id: 'shell', label: 'Shell', keywords: 'zsh bash fish' },
      { id: 'restoreTerminals', label: 'Restore terminals on launch', keywords: 'startup tabs' },
      { id: 'terminalFontSize', label: 'Terminal font size', keywords: 'text size' },
      { id: 'terminalScrollback', label: 'Scrollback lines', keywords: 'history buffer' },
    ],
  },
  {
    id: 'browser',
    group: 'Workspace',
    title: 'Browser and simulator',
    icon: Globe,
    component: BrowserSection,
    settings: [
      { id: 'searchEngine', label: 'Search engine', keywords: 'duckduckgo google bing kagi address bar' },
      { id: 'addressHistory', label: 'Clear address history', keywords: 'browser urls suggestions' },
      { id: 'simulator', label: 'Default simulator', keywords: 'ios iphone ipad device' },
    ],
  },
  {
    id: 'remote',
    group: 'System',
    title: 'Remote access',
    icon: Devices,
    component: RemoteSection,
    settings: [
      { id: 'remoteEnabled', label: 'Let devices control this computer', keywords: 'remote control phone laptop server connect' },
      { id: 'remoteNetwork', label: 'Allow devices on this network', keywords: 'lan tailscale wifi firewall remote' },
      { id: 'keepAwake', label: 'Keep this computer awake', keywords: 'sleep power battery lid caffeinate remote' },
      { id: 'machineName', label: 'Computer name', keywords: 'machine host name remote' },
      { id: 'remoteAnywhere', label: 'Reach this computer from anywhere', keywords: 'relay internet away remote account' },
      { id: 'members', label: 'Your computers', keywords: 'remove trusted devices members approve connected scopes pair' },
      { id: 'otherComputers', label: 'Join your computers', keywords: 'join pair computer machine account relay code' },
    ],
  },
  {
    id: 'data',
    group: 'System',
    title: 'Data and storage',
    icon: Database,
    component: DataSection,
    settings: [
      { id: 'storage', label: 'Storage used', keywords: 'disk space size' },
      { id: 'clearPins', label: 'Clear pins', keywords: 'reset delete' },
      { id: 'clearSideChats', label: 'Clear side chats', keywords: 'reset delete' },
      { id: 'clearTerminals', label: 'Clear terminal history', keywords: 'reset delete scrollback' },
      { id: 'clearEverything', label: 'Clear everything', keywords: 'reset delete factory' },
      { id: 'demoData', label: 'Show demo data', keywords: 'sample example fixture threads prototype' },
      { id: 'recordReplays', label: 'Record threads for replay', keywords: 'replay recording session playback demo debug events' },
      { id: 'clearReplays', label: 'Clear replay recordings', keywords: 'replay recording delete disk space' },
    ],
  },
  {
    id: 'about',
    group: 'System',
    title: 'About',
    icon: Info,
    component: AboutSection,
    settings: [{ id: 'about', label: 'About Mochi', keywords: 'version electron chromium docs' }],
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
